import assert from "node:assert/strict";
import test from "node:test";
import { focusAfterBackgroundSelection, routeIdentity } from "../src/focus-state";

test("background selection preserves focus only for the same terminal route", () => {
  const first = routeIdentity({ socketPath: "/tmp/a", token: "x", pid: 1, terminal: { termProgram: "Terminal.app", tmuxPane: null, tty: "ttys001" } });
  const second = routeIdentity({ socketPath: "/tmp/b", token: "y", pid: 2, terminal: { termProgram: "Terminal.app", tmuxPane: null, tty: "ttys002" } });
  assert.equal(focusAfterBackgroundSelection(true, first, first), true);
  assert.equal(focusAfterBackgroundSelection(true, first, second), false);
  assert.equal(focusAfterBackgroundSelection(false, first, first), false);
});
