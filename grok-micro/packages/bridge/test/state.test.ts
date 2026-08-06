import assert from "node:assert/strict";
import test from "node:test";
import { RecentSessionRegistry, normalizeSessionState, stateForEvent, transitionSessionState } from "../src/state";

test("normalizes native states and conservative aliases", () => {
  assert.equal(normalizeSessionState("awaiting-approval"), "awaiting-approval");
  assert.equal(normalizeSessionState("complete"), "unread");
  assert.equal(normalizeSessionState("mystery"), null);
});

test("maps Grok control events without inspecting prompt text", () => {
  assert.equal(stateForEvent({ event: "turn.started" }), "working");
  assert.equal(stateForEvent({ event: "turn.completed" }), "unread");
  assert.equal(stateForEvent({ event: "turn.completed", outcome: "failed" }), "error");
  assert.equal(stateForEvent({ event: "input.requested", inputType: "approval" }), "awaiting-approval");
  assert.equal(stateForEvent({ event: "input.requested", inputType: "question" }), "awaiting-response");
  assert.equal(stateForEvent({ event: "session.closed" }), "off");
  assert.equal(stateForEvent({ event: "notification", message: "permission please" }), null);
});

test("pending input outranks completion until it is explicitly resolved", () => {
  assert.equal(transitionSessionState("awaiting-response", { event: "turn.completed" }), "awaiting-response");
  assert.equal(transitionSessionState("awaiting-approval", { event: "turn.started" }), "awaiting-approval");
  assert.equal(transitionSessionState("awaiting-response", { event: "input.resolved", kind: "response" }), "working");
  assert.equal(transitionSessionState("awaiting-approval", { event: "turn.completed", outcome: "failed" }), "error");
});

test("six-session registry is stable and evicts the least recent session", () => {
  let now = 1;
  const registry = new RecentSessionRegistry([], { now: () => now++ });
  for (let index = 0; index < 6; index += 1) registry.upsert({ sessionId: `s${index}`, state: "idle" });
  assert.equal(registry.upsert({ sessionId: "s3", state: "working" }), 3);
  assert.equal(registry.upsert({ sessionId: "new", state: "idle" }), 0);
  assert.equal(registry.at(0)?.sessionId, "new");
  assert.equal(registry.at(3)?.sessionId, "s3");
});

test("selection is unique and route credentials are never restored", () => {
  const registry = new RecentSessionRegistry([{ sessionId: "a", state: "idle", selected: true, route: { socketPath: "/tmp/a", token: "secret" } }]);
  assert.equal(registry.at(0)?.route, null);
  registry.upsert({ sessionId: "b", state: "working", selected: true });
  assert.equal(registry.at(0)?.selected, false);
  assert.equal(registry.at(1)?.selected, true);
});
