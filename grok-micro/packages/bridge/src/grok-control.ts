import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { NativeAction } from "./native-input";
import type { ControlRoute } from "./state";

export interface DiscoveryRecord {
  protocolVersion: 1;
  pid: number;
  sessionId: string;
  cwd: string;
  socketPath: string;
  token: string;
  createdAt: number;
  sessions?: Array<{ id: string; title?: string; mode?: string; updatedAt?: number }>;
  terminal?: { termProgram: string | null; tmuxPane: string | null; tty: string | null };
}

export type GrokWireAction =
  | { type: "composer.submit" }
  | { type: "composer.togglePlanMode" }
  | { type: "approval.respond"; decision: "approve" | "decline" }
  | { type: "thread.select"; sessionId: string }
  | { type: "thread.fork" }
  | { type: "reasoning.adjust"; direction: "increase" | "decrease" }
  | { type: "conversation.scroll"; direction: "up" | "down" | "bottom" }
  | { type: "voice.pushToTalk.start" }
  | { type: "voice.pushToTalk.stop" }
  | { type: "voice.pushToTalk.latch" };

export class UnsupportedActionError extends Error {
  readonly code = "unsupported";
  constructor(readonly action: NativeAction) {
    super(`Grok CLI has no exact control action for Codex Micro action '${action}'.`);
    this.name = "UnsupportedActionError";
  }
}

export class ControlProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ControlProtocolError";
  }
}

export function wireActionFor(action: NativeAction, sessionId?: string): GrokWireAction {
  if (action === "composer.submit") return { type: "composer.submit" };
  if (action === "composer.togglePlanMode") return { type: "composer.togglePlanMode" };
  if (action === "approval.approve") return { type: "approval.respond", decision: "approve" };
  if (action === "approval.decline") return { type: "approval.respond", decision: "decline" };
  if (action === "thread.fork") return { type: "thread.fork" };
  if (action === "reasoning.increase") return { type: "reasoning.adjust", direction: "increase" };
  if (action === "reasoning.decrease") return { type: "reasoning.adjust", direction: "decrease" };
  if (action === "conversation.scrollUp") return { type: "conversation.scroll", direction: "up" };
  if (action === "conversation.scrollDown") return { type: "conversation.scroll", direction: "down" };
  if (action === "conversation.scrollBottom") return { type: "conversation.scroll", direction: "bottom" };
  if (action === "thread.select" && sessionId) return { type: "thread.select", sessionId };
  if (action === "voice.pushToTalk.start") return { type: "voice.pushToTalk.start" };
  if (action === "voice.pushToTalk.stop") return { type: "voice.pushToTalk.stop" };
  if (action === "voice.pushToTalk.latch") return { type: "voice.pushToTalk.latch" };
  throw new UnsupportedActionError(action);
}

function secureMode(stat: fs.Stats, expected: number): boolean {
  return (stat.mode & 0o777) === expected;
}

function sameOwner(stat: fs.Stats): boolean {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}

/** Reads Grok CLI's 0600 discovery files from its 0700 control directory. */
export function discoverControlRoutes(controlDirectory = process.env.GROK_MICRO_CONTROL_DIR ?? path.join(os.homedir(), ".grok", "control")): Map<string, ControlRoute> {
  const routes = new Map<string, ControlRoute>();
  let directoryStat: fs.Stats;
  try {
    directoryStat = fs.lstatSync(controlDirectory);
  } catch {
    return routes;
  }
  if (!directoryStat.isDirectory() || !sameOwner(directoryStat) || !secureMode(directoryStat, 0o700)) return routes;
  for (const name of fs.readdirSync(controlDirectory)) {
    if (!name.endsWith(".json")) continue;
    const recordPath = path.join(controlDirectory, name);
    try {
      const stat = fs.lstatSync(recordPath);
      if (!stat.isFile() || !sameOwner(stat) || !secureMode(stat, 0o600)) continue;
      const value = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Partial<DiscoveryRecord>;
      if (value.protocolVersion !== 1 || !Number.isInteger(value.pid) || typeof value.sessionId !== "string") continue;
      if (typeof value.socketPath !== "string" || !path.isAbsolute(value.socketPath)) continue;
      if (typeof value.token !== "string" || value.token.length < 16) continue;
      const socketStat = fs.lstatSync(value.socketPath);
      if (!socketStat.isSocket() || !sameOwner(socketStat) || !secureMode(socketStat, 0o600)) continue;
      try {
        process.kill(value.pid as number, 0);
      } catch {
        continue;
      }
      routes.set(value.sessionId, {
        socketPath: value.socketPath,
        token: value.token,
        pid: value.pid,
        cwd: typeof value.cwd === "string" ? value.cwd : undefined,
        terminal: value.terminal && typeof value.terminal === "object" ? {
          termProgram: typeof value.terminal.termProgram === "string" ? value.terminal.termProgram : null,
          tmuxPane: typeof value.terminal.tmuxPane === "string" ? value.terminal.tmuxPane : null,
          tty: typeof value.terminal.tty === "string" ? value.terminal.tty : null,
        } : undefined,
      });
      for (const session of Array.isArray(value.sessions) ? value.sessions : []) {
        if (typeof session?.id === "string" && session.id) routes.set(session.id, routes.get(value.sessionId)!);
      }
    } catch {
      // A process may disappear while its discovery record is being read.
    }
  }
  return routes;
}

interface WireLine { version?: number; type?: string; [key: string]: unknown }

export interface ControlSubscription {
  close(): void;
}

/** Authenticates and keeps a Grok control connection open for event replay/live events. */
export function subscribeControlRoute(
  route: ControlRoute,
  onEvent: (event: Record<string, unknown>) => void,
  onError: (error: Error) => void = () => {},
): ControlSubscription {
  const socket = net.createConnection(route.socketPath);
  socket.setEncoding("utf8");
  let pending = "";
  let ready = false;
  let closed = false;
  const fail = (error: Error) => {
    if (closed) return;
    closed = true;
    socket.destroy();
    onError(error);
  };
  socket.once("connect", () => socket.write(`${JSON.stringify({ version: 1, type: "authenticate", token: route.token })}\n`));
  socket.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      let message: WireLine;
      try { message = JSON.parse(line) as WireLine; }
      catch { return fail(new ControlProtocolError("invalid_response", "Grok event stream returned invalid JSON.")); }
      if (!ready) {
        if (message.version !== 1 || message.type !== "ready") return fail(new ControlProtocolError("unauthorized", "Grok event stream rejected authentication."));
        ready = true;
        continue;
      }
      if (message.version === 1 && message.type === "event" && message.event && typeof message.event === "object") {
        try { onEvent(message.event as Record<string, unknown>); }
        catch (error) { onError(error as Error); }
      }
    }
  });
  socket.once("error", (error) => fail(new ControlProtocolError("unavailable", error.message)));
  socket.once("end", () => fail(new ControlProtocolError("unavailable", "Grok event stream closed.")));
  return {
    close() {
      if (closed) return;
      closed = true;
      socket.destroy();
    },
  };
}

export async function sendControlAction(
  route: ControlRoute,
  action: NativeAction,
  { timeoutMs = 1_500, requestId = `${process.pid}-${Date.now()}`, sessionId }: { timeoutMs?: number; requestId?: string; sessionId?: string } = {},
): Promise<unknown> {
  const wireAction = wireActionFor(action, sessionId);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(route.socketPath);
    socket.setEncoding("utf8");
    let pending = "";
    let authenticated = false;
    let done = false;
    const finish = (error?: Error, data?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(data);
    };
    const timer = setTimeout(() => finish(new ControlProtocolError("timeout", `Grok control socket did not respond within ${timeoutMs}ms.`)), timeoutMs);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ version: 1, type: "authenticate", token: route.token })}\n`);
    });
    socket.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        let message: WireLine;
        try {
          message = JSON.parse(line) as WireLine;
        } catch {
          finish(new ControlProtocolError("invalid_response", "Grok control socket returned invalid JSON."));
          return;
        }
        if (!authenticated) {
          if (message.version !== 1 || message.type !== "ready") {
            finish(new ControlProtocolError("unauthorized", "Grok control socket rejected authentication."));
            return;
          }
          authenticated = true;
          socket.write(`${JSON.stringify({ version: 1, type: "action", id: requestId, action: wireAction })}\n`);
          continue;
        }
        if (message.type !== "result" || message.id !== requestId) continue;
        if (message.ok === true) finish(undefined, message.data);
        else {
          const error = message.error as { code?: unknown; message?: unknown } | undefined;
          finish(new ControlProtocolError(String(error?.code ?? "unavailable"), String(error?.message ?? "Grok action failed.")));
        }
      }
    });
    socket.once("error", (error) => finish(new ControlProtocolError("unavailable", error.message)));
    socket.once("end", () => finish(new ControlProtocolError("unavailable", "Grok control socket closed before returning a result.")));
  });
}
