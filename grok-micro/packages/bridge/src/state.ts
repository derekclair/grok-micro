export const GROK_SESSION_STATES = [
  "off",
  "idle",
  "working",
  "unread",
  "awaiting-approval",
  "awaiting-response",
  "error",
] as const;

export type GrokSessionState = (typeof GROK_SESSION_STATES)[number];

export interface ControlRoute {
  socketPath: string;
  token: string;
  pid?: number;
  cwd?: string;
  terminal?: { termProgram: string | null; tmuxPane: string | null; tty: string | null };
}

export interface GrokSession {
  sessionId: string;
  state: GrokSessionState;
  selected: boolean;
  pulsing: boolean;
  updatedAt: number;
  route: ControlRoute | null;
}

const STATE_ALIASES: Readonly<Record<string, GrokSessionState>> = Object.freeze({
  complete: "unread",
  completed: "unread",
  done: "unread",
  waiting: "awaiting-response",
  approval: "awaiting-approval",
  failed: "error",
});

export function normalizeSessionState(value: unknown): GrokSessionState | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if ((GROK_SESSION_STATES as readonly string[]).includes(normalized)) return normalized as GrokSessionState;
  return STATE_ALIASES[normalized] ?? null;
}

/**
 * Maps Grok-native events and a deliberately small generic hook fallback onto
 * the factory status vocabulary. Unknown events do not change the light.
 */
export function stateForEvent(event: Record<string, unknown>): GrokSessionState | null {
  const direct = normalizeSessionState(event.state);
  if (direct) return direct;
  const name = String(event.event ?? event.type ?? event.hook_event_name ?? "").toLowerCase();
  if (["session.opened", "session.changed"].includes(name)) return "idle";
  if (["turn.started", "tool.started", "tool.finished"].includes(name)) return "working";
  if (name === "turn.completed") return String(event.outcome ?? "").toLowerCase() === "failed" ? "error" : "unread";
  if (name === "input.requested") {
    return String(event.inputType ?? event.kind ?? "").toLowerCase().includes("approval")
      ? "awaiting-approval"
      : "awaiting-response";
  }
  if (name === "input.resolved") return "working";
  if (name === "session.closed") return "off";
  if (["sessionstart", "session_start", "idle"].includes(name)) return "idle";
  if (["userpromptsubmit", "prompt_submit", "turn_start", "generation_start", "tool_start", "pretooluse", "posttooluse"].includes(name)) return "working";
  if (["permissionrequest", "permission_request", "approval_requested"].includes(name)) return "awaiting-approval";
  if (["input_required", "ask_user", "awaiting_response"].includes(name)) return "awaiting-response";
  if (["stop", "turn_complete", "completed"].includes(name)) return "unread";
  if (["error", "failed", "turn_error"].includes(name)) return "error";
  if (["sessionend", "session_end", "closed"].includes(name)) return "off";
  return null;
}

/** Applies native status precedence while an input panel remains outstanding. */
export function transitionSessionState(
  previous: GrokSessionState | null,
  event: Record<string, unknown>,
): GrokSessionState | null {
  const next = stateForEvent(event);
  if (!next) return null;
  const name = String(event.event ?? event.type ?? event.hook_event_name ?? "").toLowerCase();
  if (next === "error" || next === "off" || name === "input.requested" || name === "input.resolved") return next;
  if (previous === "awaiting-approval" || previous === "awaiting-response") return previous;
  return next;
}

export interface RegistryOptions {
  capacity?: number;
  now?: () => number;
}

/** Six stable physical slots backed by least-recently-used replacement. */
export class RecentSessionRegistry {
  #slots: Array<GrokSession | null>;
  #capacity: number;
  #now: () => number;

  constructor(sessions: Array<Partial<GrokSession>> = [], { capacity = 6, now = Date.now }: RegistryOptions = {}) {
    this.#capacity = capacity;
    this.#now = now;
    this.#slots = Array.from({ length: capacity }, () => null);
    const seen = new Set<string>();
    for (let index = 0; index < Math.min(capacity, sessions.length); index += 1) {
      const session = sessions[index];
      const sessionId = typeof session?.sessionId === "string" ? session.sessionId : "";
      const state = normalizeSessionState(session?.state);
      if (!sessionId || !state || seen.has(sessionId)) continue;
      seen.add(sessionId);
      this.#slots[index] = {
        sessionId,
        state,
        selected: session.selected === true,
        pulsing: session.pulsing === true,
        updatedAt: typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt) ? session.updatedAt : 0,
        // Authentication material is intentionally never restored from disk.
        route: null,
      };
    }
  }

  upsert(input: Omit<Partial<GrokSession>, "sessionId"> & { sessionId: string }): number {
    const now = this.#now();
    const state = normalizeSessionState(input.state) ?? "idle";
    let slot = this.#slots.findIndex((entry) => entry?.sessionId === input.sessionId);
    if (slot < 0) {
      slot = this.#slots.findIndex((entry) => entry === null);
      if (slot < 0) {
        slot = this.#slots.reduce((oldest, entry, index, all) =>
          (entry?.updatedAt ?? Infinity) < (all[oldest]?.updatedAt ?? Infinity) ? index : oldest, 0);
      }
    }
    if (input.selected === true) {
      for (const entry of this.#slots) if (entry) entry.selected = false;
    }
    const previous = this.#slots[slot];
    this.#slots[slot] = {
      sessionId: input.sessionId,
      state,
      selected: input.selected ?? previous?.selected ?? false,
      pulsing: input.pulsing ?? previous?.pulsing ?? false,
      updatedAt: typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : now,
      route: input.route === undefined ? (previous?.route ?? null) : input.route,
    };
    return slot;
  }

  remove(sessionId: string): void {
    const slot = this.#slots.findIndex((entry) => entry?.sessionId === sessionId);
    if (slot >= 0) this.#slots[slot] = null;
  }

  selectSlot(slot: number): GrokSession | null {
    const selected = this.#slots[slot] ?? null;
    if (!selected) return null;
    for (const entry of this.#slots) if (entry) entry.selected = entry === selected;
    selected.updatedAt = this.#now();
    return { ...selected, route: selected.route ? { ...selected.route } : null };
  }

  setRoute(sessionId: string, route: ControlRoute | null): void {
    const session = this.#slots.find((entry) => entry?.sessionId === sessionId);
    if (session) session.route = route;
  }

  active(): GrokSession | null {
    const populated = this.#slots.filter((entry): entry is GrokSession => entry !== null);
    const selected = populated.find((entry) => entry.selected);
    const session = selected ?? populated.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
    return session ? { ...session, route: session.route ? { ...session.route } : null } : null;
  }

  at(slot: number): GrokSession | null {
    const session = this.#slots[slot] ?? null;
    return session ? { ...session, route: session.route ? { ...session.route } : null } : null;
  }

  entries(): Array<GrokSession | null> {
    return this.#slots.map((session) => session ? { ...session, route: session.route ? { ...session.route } : null } : null);
  }

  get capacity(): number {
    return this.#capacity;
  }
}
