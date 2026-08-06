import assert from "node:assert/strict";
import test from "node:test";
import { connectedTransition, failedTransition, failureCode, INITIAL_DEVICE_STATE } from "../src/device-health";

test("public device state starts with the exact native vocabulary", () => {
  assert.deepEqual({
    status: INITIAL_DEVICE_STATE.status,
    transport: INITIAL_DEVICE_STATE.transport,
    model: INITIAL_DEVICE_STATE.model,
    error: INITIAL_DEVICE_STATE.error,
    battery: INITIAL_DEVICE_STATE.battery,
  }, { status: "not-detected", transport: "unknown", model: null, error: null, battery: null });
});

test("device failures and lifecycle transitions distinguish discovery, initial connect, and loss", () => {
  assert.equal(failureCode(true, false), "discovery-failed");
  assert.equal(failureCode(false, false), "connection-failed");
  assert.equal(failureCode(false, true), "transport-unavailable");
  assert.equal(connectedTransition(false), "connected");
  assert.equal(connectedTransition(true), "reconnected");
  assert.equal(failedTransition(false), "connection-failed");
  assert.equal(failedTransition(true), "connection-lost");
});
