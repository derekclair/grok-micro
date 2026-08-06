import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  CONTROL_PROTOCOL_VERSION,
  type ControlAction,
  ControlActionError,
  type ControlActionHandler,
  type ControlErrorCode,
  type ControlEvent,
  type ControlRegistration,
  type ControlSessionSummary,
  type ControlTerminalMetadata,
  type ServerMessage,
} from "./types";

interface LocalControlServerOptions {
  sessionId: string;
  cwd: string;
  pid?: number;
  token?: string;
  socketDirectory?: string;
  registrationDirectory?: string;
  maxMessageBytes?: number;
  replayLimit?: number;
  sessions?: ControlSessionSummary[];
  terminal?: Partial<ControlTerminalMetadata>;
}

interface ClientState {
  authenticated: boolean;
  buffer: string;
  queue: Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function constantTimeTokenMatch(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class LocalControlServer {
  readonly token: string;
  readonly pid: number;
  readonly socketPath: string;
  readonly registrationPath: string;

  private sessionId: string;
  private cwd: string;
  private sessions: ControlSessionSummary[];
  private readonly terminal: ControlTerminalMetadata;
  private readonly maxMessageBytes: number;
  private readonly replayLimit: number;
  private readonly server: net.Server;
  private readonly clients = new Map<net.Socket, ClientState>();
  private readonly replay: ServerMessage[] = [];
  private actionHandler: ControlActionHandler | null = null;
  private sequence = 0;
  private started = false;
  private closed = false;
  private readonly createdAt = new Date().toISOString();

  constructor(options: LocalControlServerOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.pid = options.pid ?? process.pid;
    this.token = options.token ?? randomBytes(32).toString("hex");
    this.maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
    this.replayLimit = options.replayLimit ?? 128;
    this.sessions = options.sessions ? [...options.sessions] : [];
    this.terminal = {
      termProgram:
        options.terminal?.termProgram === undefined ? (process.env.TERM_PROGRAM ?? null) : options.terminal.termProgram,
      tmuxPane: options.terminal?.tmuxPane === undefined ? (process.env.TMUX_PANE ?? null) : options.terminal.tmuxPane,
      tty: options.terminal?.tty === undefined ? (process.env.TTY ?? null) : options.terminal.tty,
    };

    const id = randomBytes(6).toString("hex");
    const socketDirectory = options.socketDirectory ?? (process.platform === "darwin" ? "/private/tmp" : os.tmpdir());
    const registrationDirectory = options.registrationDirectory ?? path.join(os.homedir(), ".grok", "control");
    this.socketPath = path.join(socketDirectory, `grok-control-${this.pid}-${id}.sock`);
    this.registrationPath = path.join(registrationDirectory, `${this.pid}.json`);
    this.server = net.createServer((socket) => this.accept(socket));
  }

  async start(): Promise<ControlRegistration> {
    if (this.started) return this.registration();
    if (this.closed) throw new Error("Control server is closed.");

    fs.mkdirSync(path.dirname(this.registrationPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(this.registrationPath), 0o700);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.socketPath);
    });
    fs.chmodSync(this.socketPath, 0o600);
    this.started = true;
    this.writeRegistration();
    return this.registration();
  }

  setActionHandler(handler: ControlActionHandler): () => void {
    this.actionHandler = handler;
    return () => {
      if (this.actionHandler === handler) this.actionHandler = null;
    };
  }

  emitEvent(event: ControlEvent): void {
    const message: ServerMessage = {
      version: CONTROL_PROTOCOL_VERSION,
      type: "event",
      seq: ++this.sequence,
      event,
    };
    this.replay.push(message);
    if (this.replay.length > this.replayLimit) this.replay.shift();
    for (const [socket, state] of this.clients) {
      if (state.authenticated) this.send(socket, message);
    }
  }

  updateSession(sessionId: string, cwd: string): void {
    this.sessionId = sessionId;
    this.cwd = cwd;
    if (this.started && !this.closed) this.writeRegistration();
  }

  updateSessions(sessions: ControlSessionSummary[]): void {
    this.sessions = sessions.slice(0, 100).map((session) => ({ ...session }));
    if (this.started && !this.closed) this.writeRegistration();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const socket of this.clients.keys()) socket.destroy();
    this.clients.clear();
    if (this.started) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
    this.removeOwnedFile(this.registrationPath);
    this.removeOwnedFile(this.socketPath);
  }

  private registration(): ControlRegistration {
    return {
      protocolVersion: CONTROL_PROTOCOL_VERSION,
      pid: this.pid,
      sessionId: this.sessionId,
      cwd: this.cwd,
      socketPath: this.socketPath,
      token: this.token,
      createdAt: this.createdAt,
      sessions: this.sessions.map((session) => ({ ...session })),
      terminal: { ...this.terminal },
    };
  }

  private writeRegistration(): void {
    const target = this.registrationPath;
    const temporary = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(this.registration(), null, 2)}\n`, { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  private removeOwnedFile(target: string): void {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // Cleanup is best effort and never blocks Grok shutdown.
    }
  }

  private accept(socket: net.Socket): void {
    socket.setEncoding("utf8");
    socket.setTimeout(30_000, () => socket.destroy());
    const state: ClientState = { authenticated: false, buffer: "", queue: Promise.resolve() };
    this.clients.set(socket, state);
    socket.on("error", () => {});
    socket.on("close", () => this.clients.delete(socket));
    socket.on("data", (chunk: string) => {
      state.buffer += chunk;
      let newline = state.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = state.buffer.slice(0, newline).trim();
        state.buffer = state.buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > this.maxMessageBytes) {
          this.protocolError(socket, "invalid_request", "Control message exceeds the size limit.");
          socket.destroy();
          return;
        }
        if (line) {
          state.queue = state.queue.then(() => this.processLine(socket, state, line)).catch(() => {});
        }
        newline = state.buffer.indexOf("\n");
      }
      if (Buffer.byteLength(state.buffer) > this.maxMessageBytes) {
        this.protocolError(socket, "invalid_request", "Control message exceeds the size limit.");
        socket.destroy();
      }
    });
  }

  private async processLine(socket: net.Socket, state: ClientState, line: string): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.protocolError(socket, "invalid_request", "Control message is not valid JSON.");
      return;
    }
    if (!isRecord(value)) {
      this.protocolError(socket, "invalid_request", "Control message must be an object.");
      return;
    }
    if (value.version !== CONTROL_PROTOCOL_VERSION) {
      this.protocolError(
        socket,
        "unsupported_version",
        `Expected control protocol version ${CONTROL_PROTOCOL_VERSION}.`,
      );
      return;
    }

    if (!state.authenticated) {
      if (value.type !== "authenticate" || typeof value.token !== "string") {
        this.protocolError(socket, "unauthorized", "Authenticate before sending control messages.");
        socket.destroy();
        return;
      }
      if (!constantTimeTokenMatch(value.token, this.token)) {
        this.protocolError(socket, "unauthorized", "Invalid control token.");
        socket.destroy();
        return;
      }
      state.authenticated = true;
      socket.setTimeout(0);
      this.send(socket, {
        version: CONTROL_PROTOCOL_VERSION,
        type: "ready",
        pid: this.pid,
        sessionId: this.sessionId,
        cwd: this.cwd,
      });
      for (const message of this.replay) this.send(socket, message);
      return;
    }

    if (
      value.type !== "action" ||
      typeof value.id !== "string" ||
      !isRecord(value.action) ||
      typeof value.action.type !== "string"
    ) {
      this.protocolError(socket, "invalid_request", "Expected an action with string id and action.type.");
      return;
    }

    const id = value.id;
    if (!this.actionHandler) {
      this.actionError(socket, id, "unavailable", "The interactive UI is not ready for control actions.");
      return;
    }
    try {
      const data = await this.actionHandler(value.action as ControlAction);
      this.send(socket, {
        version: CONTROL_PROTOCOL_VERSION,
        type: "result",
        id,
        ok: true,
        ...(data === undefined ? {} : { data }),
      });
    } catch (error) {
      if (error instanceof ControlActionError) {
        this.actionError(socket, id, error.code, error.message);
      } else {
        this.actionError(socket, id, "internal_error", "The control action failed.");
      }
    }
  }

  private actionError(socket: net.Socket, id: string, code: ControlErrorCode, message: string): void {
    this.send(socket, { version: CONTROL_PROTOCOL_VERSION, type: "result", id, ok: false, error: { code, message } });
  }

  private protocolError(socket: net.Socket, code: ControlErrorCode, message: string): void {
    this.send(socket, { version: CONTROL_PROTOCOL_VERSION, type: "protocol_error", error: { code, message } });
  }

  private send(socket: net.Socket, message: ServerMessage): void {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  }
}
