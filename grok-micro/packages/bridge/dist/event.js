// src/event.ts
import fs from "fs";
import net from "net";
var socketPath = process.env.GROK_MICRO_SOCKET ?? "/private/tmp/grok-micro.sock";
if (!fs.existsSync(socketPath)) process.exit(0);
var input = "";
for await (const chunk of process.stdin) input += chunk;
if (!input.trim()) process.exit(0);
var source;
try {
  source = JSON.parse(input);
} catch {
  process.exit(0);
}
var event = {};
for (const key of ["event", "type", "hook_event_name", "state", "selected", "pulsing", "inputType", "kind", "voice", "snakingAmbientStatus", "appFocused"]) {
  if (source[key] !== void 0) event[key] = source[key];
}
event.sessionId = source.sessionId ?? source.session_id ?? process.env.GROK_SESSION_ID;
if (typeof event.sessionId !== "string" || !event.sessionId) process.exit(0);
var timeoutMs = Number(process.env.GROK_MICRO_HOOK_TIMEOUT_MS ?? 1500);
var client = net.createConnection(socketPath);
var finished = false;
var timer = setTimeout(() => finish(), timeoutMs);
function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  client.destroy();
}
client.once("connect", () => client.end(JSON.stringify(event)));
client.on("data", () => {
});
client.once("end", finish);
client.once("error", finish);
