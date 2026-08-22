import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { defaultRuntimeDir, resolveRuntimeFile, vendorInterfaceHint } from "../src/runtime-paths";

test("runtime dir is /private/tmp on macOS and os.tmpdir elsewhere", () => {
  assert.equal(defaultRuntimeDir("darwin", "/tmp"), "/private/tmp");
  assert.equal(defaultRuntimeDir("linux", "/tmp"), "/tmp");
  assert.equal(defaultRuntimeDir("win32", "C:\\Temp"), "C:\\Temp");
});

test("explicit GROK_MICRO_* paths win over the platform default", () => {
  const env = { GROK_MICRO_SOCKET: "/run/grok-micro.sock", GROK_MICRO_HEALTH: "/run/health.json" };
  assert.equal(resolveRuntimeFile("socket", env, "darwin", "/tmp"), "/run/grok-micro.sock");
  assert.equal(resolveRuntimeFile("health", env, "linux", "/tmp"), "/run/health.json");
  assert.equal(resolveRuntimeFile("slots", env, "linux", "/tmp"), path.join("/tmp", "grok-micro-slots.json"));
  assert.equal(resolveRuntimeFile("lock", {}, "darwin", "/tmp"), "/private/tmp/grok-micro-device.lock");
});

test("GROK_MICRO_RUNTIME_DIR relocates every default file", () => {
  const env = { GROK_MICRO_RUNTIME_DIR: "/var/run/grok-micro" };
  assert.equal(resolveRuntimeFile("socket", env, "linux", "/tmp"), "/var/run/grok-micro/grok-micro.sock");
});

test("vendor-interface doctor hint is platform-specific", () => {
  assert.match(vendorInterfaceHint("darwin"), /Input Monitoring/);
  assert.match(vendorInterfaceHint("linux"), /udev/);
  assert.doesNotMatch(vendorInterfaceHint("linux"), /Input Monitoring/);
});
