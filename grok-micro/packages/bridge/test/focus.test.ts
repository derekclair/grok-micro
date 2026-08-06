import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTty } from "../src/focus";

test("terminal tty normalization accepts device names and rejects injection", () => {
  assert.equal(normalizeTty("ttys003"), "/dev/ttys003");
  assert.equal(normalizeTty("/dev/ttys004"), "/dev/ttys004");
  assert.equal(normalizeTty("bad\n\"tty"), null);
  assert.equal(normalizeTty("??"), null);
});
