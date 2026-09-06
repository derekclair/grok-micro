// src/runtime-paths.ts
import os from "os";
import path from "path";
var FILES = {
  socket: { env: "GROK_MICRO_SOCKET", name: "grok-micro.sock" },
  slots: { env: "GROK_MICRO_SLOTS", name: "grok-micro-slots.json" },
  health: { env: "GROK_MICRO_HEALTH", name: "grok-micro-health.json" },
  lock: { env: "GROK_MICRO_DEVICE_LOCK", name: "grok-micro-device.lock" }
};
function defaultRuntimeDir(platform = process.platform, tmpdir = os.tmpdir()) {
  return platform === "darwin" ? "/private/tmp" : tmpdir;
}
function resolveRuntimeFile(kind, env = process.env, platform = process.platform, tmpdir = os.tmpdir()) {
  const spec = FILES[kind];
  const explicit = env[spec.env];
  if (explicit) return explicit;
  const dir = env.GROK_MICRO_RUNTIME_DIR || defaultRuntimeDir(platform, tmpdir);
  return path.join(dir, spec.name);
}
function vendorInterfaceHint(platform = process.platform) {
  if (platform === "linux") return "connect the pad and install linux/99-grok-micro.rules (udev)";
  return "connect the pad and grant Input Monitoring";
}

export {
  resolveRuntimeFile,
  vendorInterfaceHint
};
