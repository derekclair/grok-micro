/** Minimal fallback hook forwarder for Grok CLI builds without native events. */
import fs from "node:fs";
import net from "node:net";
import { resolveRuntimeFile } from "./runtime-paths";

const socketPath = resolveRuntimeFile("socket");
if (!fs.existsSync(socketPath)) process.exit(0);

let input = "";
for await (const chunk of process.stdin) input += chunk;
if (!input.trim()) process.exit(0);

let source: Record<string, unknown>;
try {
  source = JSON.parse(input) as Record<string, unknown>;
} catch {
  process.exit(0);
}

// Deliberately exclude prompts, model output, tool arguments, and transcript
// paths. Only fields that can change a light are forwarded.
const event: Record<string, unknown> = {};
for (const key of ["event", "type", "hook_event_name", "state", "selected", "pulsing", "inputType", "kind", "voice", "snakingAmbientStatus", "appFocused"]) {
  if (source[key] !== undefined) event[key] = source[key];
}
event.sessionId = source.sessionId ?? source.session_id ?? process.env.GROK_SESSION_ID;
if (typeof event.sessionId !== "string" || !event.sessionId) process.exit(0);

const timeoutMs = Number(process.env.GROK_MICRO_HOOK_TIMEOUT_MS ?? 1_500);
const client = net.createConnection(socketPath);
let finished = false;
const timer = setTimeout(() => finish(), timeoutMs);
function finish(): void {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  client.destroy();
}
client.once("connect", () => client.end(JSON.stringify(event)));
client.on("data", () => {});
client.once("end", finish);
client.once("error", finish);
