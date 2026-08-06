import type { ControlEvent } from "./types";

/** Tracks the plan-question panel without emitting duplicate render events. */
export class ResponseInputTracker {
  private activeSessionId: string | null = null;

  transition(open: boolean, currentSessionId: string | null): ControlEvent[] {
    const events: ControlEvent[] = [];

    if (this.activeSessionId && (!open || currentSessionId !== this.activeSessionId)) {
      events.push({ type: "input.resolved", sessionId: this.activeSessionId, kind: "response" });
      this.activeSessionId = null;
    }

    if (open && currentSessionId && this.activeSessionId !== currentSessionId) {
      this.activeSessionId = currentSessionId;
      events.push({ type: "input.requested", sessionId: currentSessionId, kind: "response" });
    }

    return events;
  }
}
