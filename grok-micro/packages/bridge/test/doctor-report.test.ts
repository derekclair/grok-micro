import assert from "node:assert/strict";
import test from "node:test";
import { describeDaemonHealth } from "../src/doctor-report";

test("live socket probe is healthy even with an older health file", () => {
  const report = describeDaemonHealth(
    { state: "connected", updatedAt: "2026-09-04T07:14:04.869Z", pid: 60028 },
    { state: "connected" },
  );
  assert.equal(report.ok, true);
  assert.equal(report.detail, "connected at 2026-09-04T07:14:04.869Z");
});

test("health JSON without a socket probe is a stale leftover, not a live daemon", () => {
  const report = describeDaemonHealth(
    { state: "connected", updatedAt: "2026-09-04T07:14:04.869Z", pid: 60028 },
    null,
  );
  assert.equal(report.ok, false);
  assert.match(report.detail, /stale connected snapshot/);
  assert.match(report.detail, /daemon not running/);
});

test("missing health file and missing socket is not started", () => {
  const report = describeDaemonHealth(null, null);
  assert.equal(report.ok, false);
  assert.equal(report.detail, "not started");
});

test("graceful stop is reported as stopped, not connected", () => {
  const report = describeDaemonHealth(
    { state: "stopped", updatedAt: "2026-09-05T12:00:00.000Z" },
    null,
  );
  assert.equal(report.ok, false);
  assert.match(report.detail, /stopped at 2026-09-05T12:00:00.000Z/);
});

test("live probe without a health file still counts as healthy", () => {
  const report = describeDaemonHealth(null, { state: "reconnecting" });
  assert.equal(report.ok, true);
  assert.equal(report.detail, "reconnecting");
});
