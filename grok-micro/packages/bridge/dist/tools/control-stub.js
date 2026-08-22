// tools/control-stub.ts
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { randomBytes } from "crypto";
var controlDir = process.env.GROK_MICRO_CONTROL_DIR ?? path.join(os.homedir(), ".grok", "control");
var pid = process.pid;
var token = randomBytes(32).toString("hex");
var sessionId = "slot-1";
var socketPath = path.join(os.tmpdir(), `grok-control-${pid}.sock`);
var registrationPath = path.join(controlDir, `${pid}.json`);
var createdAt = (/* @__PURE__ */ new Date()).toISOString();
var sessions = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `slot-${n}`,
  title: `Slot ${n}`,
  mode: "agent",
  updatedAt: createdAt
}));
fs.mkdirSync(controlDir, { recursive: true, mode: 448 });
fs.chmodSync(controlDir, 448);
fs.rmSync(socketPath, { force: true });
function send(socket, message) {
  socket.write(`${JSON.stringify(message)}
`);
}
var replay = [
  { type: "session.opened", sessionId, cwd: process.cwd(), mode: "agent" },
  { type: "session.catalog", sessionId, sessions }
];
var seq = 0;
var server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let authed = false;
  let buf = "";
  socket.on("error", () => {
  });
  socket.on("data", (chunk) => {
    buf += chunk;
    let newline = buf.indexOf("\n");
    while (newline >= 0) {
      const line = buf.slice(0, newline).trim();
      buf = buf.slice(newline + 1);
      if (line) handleLine(socket, line, () => {
        authed = true;
      }, () => authed);
      newline = buf.indexOf("\n");
    }
  });
});
function handleLine(socket, line, markAuthed, isAuthed) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!isAuthed()) {
    if (msg.type !== "authenticate" || msg.token !== token) {
      socket.destroy();
      return;
    }
    markAuthed();
    send(socket, { version: 1, type: "ready" });
    for (const event of replay) send(socket, { version: 1, type: "event", seq: ++seq, event });
    return;
  }
  if (msg.type !== "action") return;
  const actionType = msg.action?.type ?? "";
  process.stderr.write(`control-stub action ${actionType}
`);
  if (actionType === "composer.toggleFastMode") {
    send(socket, {
      version: 1,
      type: "result",
      id: msg.id,
      ok: false,
      error: { code: "unsupported", message: "FAST is unsupported on Grok." }
    });
    return;
  }
  send(socket, { version: 1, type: "result", id: msg.id, ok: true, data: { ok: true } });
}
function shutdown() {
  fs.rmSync(registrationPath, { force: true });
  fs.rmSync(socketPath, { force: true });
  process.exit(0);
}
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 384);
  const record = {
    protocolVersion: 1,
    pid,
    sessionId,
    cwd: process.cwd(),
    socketPath,
    token,
    createdAt,
    sessions,
    terminal: { termProgram: process.env.TERM_PROGRAM ?? null, tmuxPane: process.env.TMUX_PANE ?? null, tty: null }
  };
  fs.writeFileSync(registrationPath, `${JSON.stringify(record, null, 2)}
`, { mode: 384 });
  fs.chmodSync(registrationPath, 384);
  process.stderr.write(`control-stub listening (${sessions.length} slots). Tokens stay in the 0600 discovery record.
`);
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
