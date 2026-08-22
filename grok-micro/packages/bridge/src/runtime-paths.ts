import os from "node:os";
import path from "node:path";

export type RuntimeFile = "socket" | "slots" | "health" | "lock";

const FILES: Record<RuntimeFile, { env: string; name: string }> = {
  socket: { env: "GROK_MICRO_SOCKET", name: "grok-micro.sock" },
  slots: { env: "GROK_MICRO_SLOTS", name: "grok-micro-slots.json" },
  health: { env: "GROK_MICRO_HEALTH", name: "grok-micro-health.json" },
  lock: { env: "GROK_MICRO_DEVICE_LOCK", name: "grok-micro-device.lock" },
};

/** macOS keeps the historical `/private/tmp` paths; Linux/Windows use `os.tmpdir()`. */
export function defaultRuntimeDir(platform = process.platform, tmpdir = os.tmpdir()): string {
  return platform === "darwin" ? "/private/tmp" : tmpdir;
}

export function resolveRuntimeFile(
  kind: RuntimeFile,
  env: NodeJS.Dict<string> = process.env,
  platform = process.platform,
  tmpdir = os.tmpdir(),
): string {
  const spec = FILES[kind];
  const explicit = env[spec.env];
  if (explicit) return explicit;
  const dir = env.GROK_MICRO_RUNTIME_DIR || defaultRuntimeDir(platform, tmpdir);
  return path.join(dir, spec.name);
}

export function vendorInterfaceHint(platform = process.platform): string {
  if (platform === "linux") return "connect the pad and install linux/99-grok-micro.rules (udev)";
  return "connect the pad and grant Input Monitoring";
}
