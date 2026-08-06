// src/grok-control.ts
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
var UnsupportedActionError = class extends Error {
  constructor(action) {
    super(`Grok CLI has no exact control action for Codex Micro action '${action}'.`);
    this.action = action;
    this.name = "UnsupportedActionError";
  }
  action;
  code = "unsupported";
};
var ControlProtocolError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ControlProtocolError";
  }
  code;
};
function wireActionFor(action, sessionId) {
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
  throw new UnsupportedActionError(action);
}
function secureMode(stat, expected) {
  return (stat.mode & 511) === expected;
}
function sameOwner(stat) {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}
function discoverControlRoutes(controlDirectory = process.env.GROK_MICRO_CONTROL_DIR ?? path.join(os.homedir(), ".grok", "control")) {
  const routes = /* @__PURE__ */ new Map();
  let directoryStat;
  try {
    directoryStat = fs.lstatSync(controlDirectory);
  } catch {
    return routes;
  }
  if (!directoryStat.isDirectory() || !sameOwner(directoryStat) || !secureMode(directoryStat, 448)) return routes;
  for (const name of fs.readdirSync(controlDirectory)) {
    if (!name.endsWith(".json")) continue;
    const recordPath = path.join(controlDirectory, name);
    try {
      const stat = fs.lstatSync(recordPath);
      if (!stat.isFile() || !sameOwner(stat) || !secureMode(stat, 384)) continue;
      const value = JSON.parse(fs.readFileSync(recordPath, "utf8"));
      if (value.protocolVersion !== 1 || !Number.isInteger(value.pid) || typeof value.sessionId !== "string") continue;
      if (typeof value.socketPath !== "string" || !path.isAbsolute(value.socketPath)) continue;
      if (typeof value.token !== "string" || value.token.length < 16) continue;
      const socketStat = fs.lstatSync(value.socketPath);
      if (!socketStat.isSocket() || !sameOwner(socketStat) || !secureMode(socketStat, 384)) continue;
      try {
        process.kill(value.pid, 0);
      } catch {
        continue;
      }
      routes.set(value.sessionId, {
        socketPath: value.socketPath,
        token: value.token,
        pid: value.pid,
        cwd: typeof value.cwd === "string" ? value.cwd : void 0,
        terminal: value.terminal && typeof value.terminal === "object" ? {
          termProgram: typeof value.terminal.termProgram === "string" ? value.terminal.termProgram : null,
          tmuxPane: typeof value.terminal.tmuxPane === "string" ? value.terminal.tmuxPane : null,
          tty: typeof value.terminal.tty === "string" ? value.terminal.tty : null
        } : void 0
      });
      for (const session of Array.isArray(value.sessions) ? value.sessions : []) {
        if (typeof session?.id === "string" && session.id) routes.set(session.id, routes.get(value.sessionId));
      }
    } catch {
    }
  }
  return routes;
}
function subscribeControlRoute(route, onEvent, onError = () => {
}) {
  const socket = net.createConnection(route.socketPath);
  socket.setEncoding("utf8");
  let pending = "";
  let ready = false;
  let closed = false;
  const fail = (error) => {
    if (closed) return;
    closed = true;
    socket.destroy();
    onError(error);
  };
  socket.once("connect", () => socket.write(`${JSON.stringify({ version: 1, type: "authenticate", token: route.token })}
`));
  socket.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return fail(new ControlProtocolError("invalid_response", "Grok event stream returned invalid JSON."));
      }
      if (!ready) {
        if (message.version !== 1 || message.type !== "ready") return fail(new ControlProtocolError("unauthorized", "Grok event stream rejected authentication."));
        ready = true;
        continue;
      }
      if (message.version === 1 && message.type === "event" && message.event && typeof message.event === "object") {
        try {
          onEvent(message.event);
        } catch (error) {
          onError(error);
        }
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
    }
  };
}
async function sendControlAction(route, action, { timeoutMs = 1500, requestId = `${process.pid}-${Date.now()}`, sessionId } = {}) {
  const wireAction = wireActionFor(action, sessionId);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(route.socketPath);
    socket.setEncoding("utf8");
    let pending = "";
    let authenticated = false;
    let done = false;
    const finish = (error, data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(data);
    };
    const timer = setTimeout(() => finish(new ControlProtocolError("timeout", `Grok control socket did not respond within ${timeoutMs}ms.`)), timeoutMs);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ version: 1, type: "authenticate", token: route.token })}
`);
    });
    socket.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
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
          socket.write(`${JSON.stringify({ version: 1, type: "action", id: requestId, action: wireAction })}
`);
          continue;
        }
        if (message.type !== "result" || message.id !== requestId) continue;
        if (message.ok === true) finish(void 0, message.data);
        else {
          const error = message.error;
          finish(new ControlProtocolError(String(error?.code ?? "unavailable"), String(error?.message ?? "Grok action failed.")));
        }
      }
    });
    socket.once("error", (error) => finish(new ControlProtocolError("unavailable", error.message)));
    socket.once("end", () => finish(new ControlProtocolError("unavailable", "Grok control socket closed before returning a result.")));
  });
}

export {
  UnsupportedActionError,
  discoverControlRoutes,
  subscribeControlRoute,
  sendControlAction
};
