import assert from "node:assert/strict";
import test from "node:test";
import { NativeInputInterpreter } from "../src/native-input";

test("Agent key first press selects; same slot and session double press focuses", () => {
  let now = 0;
  const input = new NativeInputInterpreter({ now: () => now });
  assert.deepEqual(input.key("AG00", 1, "a"), [{ action: "thread.select", slot: 0, sessionId: "a" }]);
  now = 300;
  assert.deepEqual(input.key("AG00", 1, "a"), [{ action: "thread.select", slot: 0, sessionId: "a" }, { action: "app.focus", slot: 0, sessionId: "a" }]);
  now = 500;
  input.key("AG00", 1, "b");
  now = 700;
  assert.deepEqual(input.key("AG00", 1, "a"), [{ action: "thread.select", slot: 0, sessionId: "a" }]);
});

test("factory action keys map exactly and ACT11 is ignored", () => {
  const input = new NativeInputInterpreter();
  assert.equal(input.key("ACT06", 1)[0]?.action, "composer.toggleFastMode");
  assert.equal(input.key("ACT07", 1)[0]?.action, "approval.approve");
  assert.equal(input.key("ACT08", 1)[0]?.action, "approval.decline");
  assert.equal(input.key("ACT09", 1)[0]?.action, "thread.fork");
  assert.deepEqual(input.key("ACT11", 1), []);
  assert.equal(input.key("ACT12", 1)[0]?.action, "composer.submit");
});

test("encoder detents and 500ms click hold match native behavior", () => {
  let now = 0;
  const input = new NativeInputInterpreter({ now: () => now });
  assert.equal(input.key("ENC_CW", 2)[0]?.action, "composer.previous");
  assert.equal(input.key("ENC_CC", 2)[0]?.action, "composer.next");
  input.key("ENC_CLK", 1);
  now = 499;
  assert.equal(input.key("ENC_CLK", 0)[0]?.action, "composer.activate");
  input.key("ENC_CLK", 1);
  now = 1_000;
  assert.equal(input.tick()[0]?.action, "settings.codexMicro");
  assert.deepEqual(input.key("ENC_CLK", 0), []);
});

test("encoder click is mode-specific and custom mode exposes four bindings", () => {
  let now = 0;
  const reasoning = new NativeInputInterpreter({ now: () => now, encoderMode: "reasoning" });
  reasoning.key("ENC_CLK", 1);
  assert.equal(reasoning.key("ENC_CLK", 0)[0]?.action, "reasoning.options");
  const scroll = new NativeInputInterpreter({ now: () => now, encoderMode: "conversation-scroll" });
  scroll.key("ENC_CLK", 1);
  assert.equal(scroll.key("ENC_CLK", 0)[0]?.action, "conversation.scrollBottom");
  const custom = new NativeInputInterpreter({
    now: () => now,
    encoderMode: "custom",
    encoderCustom: { left: "navigation.back", right: "navigation.forward", click: "composer.submit", longPress: "sidebar.toggle" },
  });
  assert.equal(custom.key("ENC_CW", 2)[0]?.action, "navigation.back");
  assert.equal(custom.key("ENC_CC", 2)[0]?.action, "navigation.forward");
  custom.key("ENC_CLK", 1);
  assert.equal(custom.key("ENC_CLK", 0)[0]?.action, "composer.submit");
  custom.key("ENC_CLK", 1);
  now = 500;
  assert.equal(custom.tick()[0]?.action, "sidebar.toggle");
});

test("joystick changes direction once above .5 and rearms below .5", () => {
  const input = new NativeInputInterpreter();
  assert.deepEqual(input.joystick(0.75, 0.49), []);
  assert.equal(input.joystick(0.75, 0.5)[0]?.action, "composer.togglePlanMode");
  assert.deepEqual(input.joystick(0.76, 1), []);
  assert.equal(input.joystick(0.5, 1)[0]?.action, "navigation.back");
  input.joystick(0, 0);
  assert.equal(input.joystick(0.5, 0.5)[0]?.action, "navigation.back");
});

test("MIC quick double tap latches; next press stops and suppresses bounce", () => {
  let now = 0;
  const input = new NativeInputInterpreter({ now: () => now });
  assert.equal(input.key("ACT10", 1)[0]?.action, "voice.pushToTalk.start");
  now = 100;
  assert.deepEqual(input.key("ACT10", 0), []);
  now = 200;
  assert.equal(input.key("ACT10", 1)[0]?.action, "voice.pushToTalk.latch");
  now = 1_000;
  assert.equal(input.key("ACT10", 1)[0]?.action, "voice.pushToTalk.stop");
  now = 1_100;
  assert.deepEqual(input.key("ACT10", 1), []);
});

test("MIC single quick tap stops at the 350ms deadline", () => {
  let now = 0;
  const input = new NativeInputInterpreter({ now: () => now });
  input.key("ACT10", 1);
  now = 100;
  input.key("ACT10", 0);
  now = 349;
  assert.deepEqual(input.tick(), []);
  now = 350;
  assert.equal(input.tick()[0]?.action, "voice.pushToTalk.stop");
});
