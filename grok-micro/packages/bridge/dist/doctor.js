import {
  discoverControlRoutes
} from "./chunk-BED3SB6Q.js";
import {
  findCodexMicros
} from "./chunk-NMGE7OG4.js";

// src/doctor.ts
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
var socketPath = process.env.GROK_MICRO_SOCKET ?? "/private/tmp/grok-micro.sock";
var healthPath = process.env.GROK_MICRO_HEALTH ?? "/private/tmp/grok-micro-health.json";
var settingsPath = process.env.GROK_SETTINGS_PATH ?? path.join(os.homedir(), ".grok", "user-settings.json");
var failed = false;
function report(ok, label, detail = "") {
  console.log(`${ok ? "\u2713" : "\u2717"} ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  if (!ok) failed = true;
}
report(Number(process.versions.node.split(".")[0]) >= 20, "Node.js 20+", process.version);
var devices = findCodexMicros();
report(devices.length > 0, "Codex Micro vendor interface", devices.length ? `${devices.length} detected` : "connect the pad and grant Input Monitoring");
var routes = discoverControlRoutes();
report(routes.size > 0, "Authenticated Grok control sessions", routes.size ? `${routes.size} available` : "start Grok CLI with the control adapter");
var settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
} catch {
}
var hooks = settings.hooks && typeof settings.hooks === "object" ? Object.keys(settings.hooks).length : 0;
report(hooks > 0 || routes.size > 0, "Grok event source", routes.size ? "native control adapter" : hooks ? "fallback hooks" : "run pnpm run install-hooks");
var health = null;
try {
  health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
} catch {
}
report(Boolean(health), "Daemon health", health ? `${health.state} at ${health.updatedAt}` : "not started");
var probe = await new Promise((resolve) => {
  const client = net.createConnection(socketPath);
  let body = "";
  const timer = setTimeout(() => {
    client.destroy();
    resolve(null);
  }, 750);
  client.once("connect", () => client.end(JSON.stringify({ op: "grok-micro.health" })));
  client.setEncoding("utf8");
  client.on("data", (chunk) => body += chunk);
  client.once("end", () => {
    clearTimeout(timer);
    try {
      const parsed = JSON.parse(body);
      resolve(parsed.ok ? parsed : null);
    } catch {
      resolve(null);
    }
  });
  client.once("error", () => {
    clearTimeout(timer);
    resolve(null);
  });
});
report(Boolean(probe), "Daemon socket", probe ? `${socketPath} (${probe.state})` : "run pnpm start");
if (failed) process.exitCode = 1;
