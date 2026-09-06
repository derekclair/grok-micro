import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { findCodexMicros } from "./micro";
import { discoverControlRoutes } from "./grok-control";
import { resolveRuntimeFile, vendorInterfaceHint } from "./runtime-paths";

const socketPath = resolveRuntimeFile("socket");
const healthPath = resolveRuntimeFile("health");
const settingsPath = process.env.GROK_SETTINGS_PATH ?? path.join(os.homedir(), ".grok", "user-settings.json");
let failed = false;
function report(ok: boolean, label: string, detail = ""): void {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

report(Number(process.versions.node.split(".")[0]) >= 20, "Node.js 20+", process.version);
const devices = findCodexMicros();
report(devices.length > 0, "Codex Micro vendor interface", devices.length ? `${devices.length} detected` : vendorInterfaceHint());
const routes = discoverControlRoutes();
report(routes.size > 0, "Authenticated Grok control sessions", routes.size ? `${routes.size} available` : "start Grok CLI with the control adapter");

let settings: Record<string, unknown> = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>; } catch {}
const hooks = settings.hooks && typeof settings.hooks === "object" ? Object.keys(settings.hooks as object).length : 0;
report(hooks > 0 || routes.size > 0, "Grok event source", routes.size ? "native control adapter" : hooks ? "fallback hooks" : "run pnpm run install-hooks");

interface HealthSnapshot {
  state?: string;
  updatedAt?: string;
}

let health: HealthSnapshot | null = null;
try { health = JSON.parse(fs.readFileSync(healthPath, "utf8")) as HealthSnapshot; } catch {}
report(Boolean(health), "Daemon health", health ? `${health.state} at ${health.updatedAt}` : "not started");

const probe = await new Promise<{ state?: string } | null>((resolve) => {
  const client = net.createConnection(socketPath);
  let body = "";
  const timer = setTimeout(() => { client.destroy(); resolve(null); }, 750);
  client.once("connect", () => client.end(JSON.stringify({ op: "grok-micro.health" })));
  client.setEncoding("utf8");
  client.on("data", (chunk: string) => body += chunk);
  client.once("end", () => {
    clearTimeout(timer);
    try {
      const parsed = JSON.parse(body) as { ok?: boolean; state?: string };
      resolve(parsed.ok ? parsed : null);
    } catch { resolve(null); }
  });
  client.once("error", () => { clearTimeout(timer); resolve(null); });
});
report(Boolean(probe), "Daemon socket", probe ? `${socketPath} (${probe.state})` : "run pnpm start");
if (failed) process.exitCode = 1;
