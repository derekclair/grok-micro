import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_EVENTS, mergeFallbackHooks, removeFallbackHooks } from "../src/install";

test("fallback hook merge preserves existing matchers and is idempotent", () => {
  const existing = { hooks: { PreToolUse: [{ matcher: "special", hooks: [{ type: "command", command: "other" }] }] } };
  const once = mergeFallbackHooks(existing, "node /grok-micro/event.js");
  const twice = mergeFallbackHooks(once, "node /grok-micro/event.js");
  assert.deepEqual(twice, once);
  assert.equal((once.hooks as Record<string, unknown[]>).PreToolUse.length, 2);
  for (const event of FALLBACK_EVENTS) assert.ok(Array.isArray((once.hooks as Record<string, unknown>)[event]));
});

test("uninstall removes only the exact grok-micro command", () => {
  const command = "node /grok-micro/event.js";
  const installed = mergeFallbackHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "other" }] }] } }, command);
  const removed = removeFallbackHooks(installed, command);
  assert.deepEqual(removed, { hooks: { Stop: [{ hooks: [{ type: "command", command: "other" }] }] } });
});
