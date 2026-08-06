import assert from "node:assert/strict";
import test from "node:test";
import { LightingEffect } from "codex-micro-protocol";
import { agentKeyLighting, boardLighting, FACTORY_COLORS, sessionForLighting } from "../src/status-lighting";
import type { GrokSession } from "../src/state";

function session(state: GrokSession["state"], selected = false, pulsing = false): GrokSession {
  return { sessionId: "s", state, selected, pulsing, updatedAt: 1, route: null };
}

test("factory status colors are exact", () => {
  assert.deepEqual(FACTORY_COLORS, {
    off: 0x000000, idle: 0xffffff, working: 0x304ffe, unread: 0x00ff4c,
    "awaiting-approval": 0xff6d00, "awaiting-response": 0xff6d00, error: 0xff0033,
  });
});

test("agent keys are solid unless selected or explicitly pulsing", () => {
  const working = agentKeyLighting(0, session("working"));
  assert.equal(working.e, LightingEffect.solid);
  assert.equal(working.sk, 0);
  assert.equal(working.sa, 0);
  assert.equal(agentKeyLighting(0, session("idle", true)).e, LightingEffect.breath);
  assert.equal(agentKeyLighting(0, session("unread", false, true)).e, LightingEffect.breath);
  assert.equal(agentKeyLighting(0, null).b, 0);
});

test("selected working session keeps snake ambient during four-second accent", () => {
  const lighting = boardLighting(session("working", true), { selectionFlash: true });
  assert.equal(lighting.ambient.e, LightingEffect.snake);
  assert.equal(lighting.ambient.s, 0.4);
  assert.equal(lighting.keys.e, LightingEffect.solid);
  assert.equal(lighting.keys.c, FACTORY_COLORS.working);
});

test("non-working ambient is off outside selection accent", () => {
  const lighting = boardLighting(session("unread", true));
  assert.equal(lighting.ambient.b, 0);
  assert.equal(lighting.keys.b, 0);
});

test("focused selected unread renders as acknowledged idle", () => {
  assert.equal(sessionForLighting(session("unread", true), true)?.state, "idle");
  assert.equal(sessionForLighting(session("unread", true), false)?.state, "unread");
  assert.equal(sessionForLighting(session("unread", false), true)?.state, "unread");
});

test("voice and dim overrides follow factory effects", () => {
  const recording = boardLighting(null, { voice: "recording" });
  assert.equal(recording.ambient.e, LightingEffect.snake);
  assert.equal(recording.keys.c, 0x2e8b57);
  assert.equal(recording.keys.e, LightingEffect.solid);
  assert.equal(boardLighting(null, { voice: "completed" }).ambient.e, LightingEffect.solid);
  assert.equal(boardLighting(null, { voice: "recording", dimmed: true }).ambient.b, 0);
  const override = boardLighting(session("working", true), { voice: "recording", snakingAmbientStatus: "error" });
  assert.equal(override.ambient.c, FACTORY_COLORS.error);
  assert.equal(override.ambient.e, LightingEffect.snake);
  assert.equal(override.keys.e, LightingEffect.off);
});
