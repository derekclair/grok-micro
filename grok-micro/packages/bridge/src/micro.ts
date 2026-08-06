// node-hid transport. Wire encoding remains in codex-micro-protocol.
import { randomInt } from "node:crypto";
import { HIDAsync, devices, type Device } from "node-hid";
import {
  RpcMessageStream,
  codexMicroModelForProductId,
  encodeRequestPackets,
  isCodexMicroInterface,
  type CodexMicroModel,
} from "codex-micro-protocol";

type TransportDescriptor = Device & { transport?: string };
export type CodexMicroTransport = "usb" | "bluetooth" | "unknown";

export function transportForDescriptor(descriptor: Device): CodexMicroTransport {
  const transport = (descriptor as TransportDescriptor).transport?.toLowerCase();
  if (transport === "usb" || transport === "bluetooth") return transport;
  const markers = `${descriptor.path ?? ""} ${descriptor.product ?? ""}`;
  if (/bluetooth|\bble\b/i.test(markers)) return "bluetooth";
  if (/\busb\b/i.test(markers)) return "usb";
  return "unknown";
}

export function modelForDescriptor(descriptor: Device): CodexMicroModel | null {
  return codexMicroModelForProductId(descriptor.productId);
}

/** Native candidate preference: USB Codex, USB Creator, BLE Codex, BLE Creator. */
export function sortCodexMicroCandidates(candidates: Device[]): Device[] {
  return [...candidates].sort((left, right) => {
    const transportRank = (value: Device) => transportForDescriptor(value) === "usb" ? 0 : transportForDescriptor(value) === "bluetooth" ? 1 : 2;
    const modelRank = (value: Device) => modelForDescriptor(value) === "codex-micro" ? 0 : 1;
    return transportRank(left) - transportRank(right) || modelRank(left) - modelRank(right);
  });
}

export function findCodexMicros(): Device[] {
  return sortCodexMicroCandidates(devices().filter(isCodexMicroInterface));
}

interface PendingResponse {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexMicro {
  #device: HIDAsync;
  #writeTail: Promise<void> = Promise.resolve();
  #lastWriteStartedAt = 0;
  #pending = new Map<number, PendingResponse>();
  #stream = new RpcMessageStream();
  #inputListeners = new Set<(report: Buffer) => void>();
  #closed = false;
  readonly descriptor: Device;

  static async connect(): Promise<CodexMicro> {
    const [descriptor] = findCodexMicros();
    if (!descriptor?.path) throw new Error("Codex Micro vendor HID interface not found. Connect it and grant Input Monitoring.");
    return new CodexMicro(await HIDAsync.open(descriptor.path, { nonExclusive: true }), descriptor);
  }

  constructor(device: HIDAsync, descriptor: Device) {
    this.#device = device;
    this.descriptor = descriptor;
    this.#device.on("data", (report: Buffer) => {
      for (const message of this.#stream.pushHidPacket(new Uint8Array(report))) {
        if (message.type !== "response") continue;
        const pending = this.#pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.#pending.delete(message.id);
        const error = message.raw.error as { message?: unknown } | undefined;
        if (error) pending.reject(new Error(String(error.message ?? "Device RPC failed.")));
        else pending.resolve(message.result);
      }
      for (const listener of this.#inputListeners) listener(report);
    });
    this.#device.on("error", (error: Error) => this.#failPending(error));
  }

  /** Serialized call: random firmware id, 50ms spacing, correlated ACK, one immediate timeout retry. */
  async sendRequest(method: string, params: unknown): Promise<number> {
    return (await this.call(method, params)).id;
  }

  async call(method: string, params: unknown): Promise<{ id: number; result: unknown }> {
    let completed: { id: number; result: unknown } = { id: -1, result: null };
    const operation = this.#writeTail.then(async () => {
      const waitMs = 50 - (Date.now() - this.#lastWriteStartedAt);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          completed = await this.#sendAndWait(method, params);
          return;
        } catch (error) {
          if (!/timed out/i.test((error as Error).message) || attempt === 1) throw error;
        }
      }
    });
    this.#writeTail = operation.catch(() => {});
    await operation;
    return completed;
  }

  async #sendAndWait(method: string, params: unknown): Promise<{ id: number; result: unknown }> {
    if (this.#closed) throw new Error("Codex Micro is closed.");
    let requestId = randomInt(0, 999);
    while (this.#pending.has(requestId)) requestId = randomInt(0, 999);
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`${method} timed out after 10000ms`));
      }, 10_000);
      this.#pending.set(requestId, { resolve, reject, timer });
    });
    this.#lastWriteStartedAt = Date.now();
    try {
      for (const packet of encodeRequestPackets({ method, params, id: requestId })) {
        await this.#device.write(Buffer.from(packet));
      }
    } catch (error) {
      const pending = this.#pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(requestId);
        pending.reject(error as Error);
      }
    }
    return { id: requestId, result: await response };
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#failPending(new Error("Codex Micro closed."));
    await this.#device.close();
  }

  onInput(listener: (report: Buffer) => void): void {
    this.#inputListeners.add(listener);
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
