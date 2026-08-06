import { describe, expect, it } from "vitest";
import { ResponseInputTracker } from "./response-input";

describe("ResponseInputTracker", () => {
  it("emits one request and one resolution per plan-panel transition", () => {
    const tracker = new ResponseInputTracker();

    expect(tracker.transition(false, "one")).toEqual([]);
    expect(tracker.transition(true, "one")).toEqual([{ type: "input.requested", sessionId: "one", kind: "response" }]);
    expect(tracker.transition(true, "one")).toEqual([]);
    expect(tracker.transition(false, "one")).toEqual([{ type: "input.resolved", sessionId: "one", kind: "response" }]);
    expect(tracker.transition(false, "one")).toEqual([]);
  });

  it("resolves the owning session before requesting input for a replacement", () => {
    const tracker = new ResponseInputTracker();
    tracker.transition(true, "one");

    expect(tracker.transition(true, "two")).toEqual([
      { type: "input.resolved", sessionId: "one", kind: "response" },
      { type: "input.requested", sessionId: "two", kind: "response" },
    ]);
  });
});
