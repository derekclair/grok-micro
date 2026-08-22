// Local Grok control v1 stand-in for hardware smoke when the full Grok CLI TUI
// is not running. Publishes ~/.grok/control/<pid>.json (0600) and a Unix socket.
// Does not log tokens, prompts, or host identifiers.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const controlDir = process.env.GROK_MICRO_CONTROL_DIR ?? path.join(os.homedir(), ".grok", "control");
const pid = process.pid;
const token = randomBytes(32).toString("hex");
const sessionId = "slot-1";
const socketPath = path.join(os.tmpdir(), `grok-control-${pid}.sock`);
const registrationPath = path.join(controlDir, `${pid}.json`);
const createdAt = new Date().toISOString();
const sessions = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `slot-${n}`,
  title: `Slot ${n}`,
  mode: "agent",
  updatedAt: createdAt,
}));

fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });
fs.chmodSync(controlDir, 0o700);
fs.rmSync(socketPath, { force: true });

function send(socket: net.Socket, message: unknown): void {
  socket.write(`${JSON.stringify(message)}\n`);
}

const replay = [
  { type: "session.opened", sessionId, cwd: process.cwd(), mode: "agent" },
  { type: "session.catalog", sessionId, sessions },
];

let seq = 0;
const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let authed = false;
  let buf = "";
  socket.on("error", () => {});
  socket.on("data", (chunk: string) => {
    buf += chunk;
    let newline = buf.indexOf("\n");
    while (newline >= 0) {
      const line = buf.slice(0, newline).trim();
      buf = buf.slice(newline + 1);
      if (line) handleLine(socket, line, () => { authed = true; }, () => authed);
      newline = buf.indexOf("\n");
    }
  });
});

function handleLine(
  socket: net.Socket,
  line: string,
  markAuthed: () => void,
  isAuthed: () => boolean,
): void {
  let msg: { type?: string; token?: string; id?: string; action?: { type?: string } };
  try {
    msg = JSON.parse(line) as typeof msg;
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
  process.stderr.write(`control-stub action ${actionType}\n`);
  if (actionType === "composer.toggleFastMode") {
    send(socket, {
      version: 1,
      type: "result",
      id: msg.id,
      ok: false,
      error: { code: "unsupported", message: "FAST is unsupported on Grok." },
    });
    return;
  }
  send(socket, { version: 1, type: "result", id: msg.id, ok: true, data: { ok: true } });
}

function shutdown(): void {
  fs.rmSync(registrationPath, { force: true });
  fs.rmSync(socketPath, { force: true });
  process.exit(0);
}

server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600);
  const record = {
    protocolVersion: 1,
    pid,
    sessionId,
    cwd: process.cwd(),
    socketPath,
    token,
    createdAt,
    sessions,
    terminal: { termProgram: process.env.TERM_PROGRAM ?? null, tmuxPane: process.env.TMUX_PANE ?? null, tty: null },
  };
  fs.writeFileSync(registrationPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(registrationPath, 0o600);
  process.stderr.write(`control-stub listening (${sessions.length} slots). Tokens stay in the 0600 discovery record.\n`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
