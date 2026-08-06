import {
  UnsupportedActionError,
  discoverControlRoutes,
  sendControlAction,
  subscribeControlRoute
} from "./chunk-BED3SB6Q.js";
import {
  AGENT_KEY_COUNT,
  CodexMicro,
  LightingEffect,
  RpcMessageStream,
  RpcMethod,
  encodeAgentKeyLighting,
  encodeLightingChannel,
  findCodexMicros,
  modelForDescriptor,
  parseDeviceEvent,
  transportForDescriptor
} from "./chunk-NMGE7OG4.js";

// src/daemon.ts
import fs from "fs";
import net from "net";
import path from "path";
import { execFile as execFile2 } from "child_process";

// src/state.ts
var GROK_SESSION_STATES = [
  "off",
  "idle",
  "working",
  "unread",
  "awaiting-approval",
  "awaiting-response",
  "error"
];
var STATE_ALIASES = Object.freeze({
  complete: "unread",
  completed: "unread",
  done: "unread",
  waiting: "awaiting-response",
  approval: "awaiting-approval",
  failed: "error"
});
function normalizeSessionState(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (GROK_SESSION_STATES.includes(normalized)) return normalized;
  return STATE_ALIASES[normalized] ?? null;
}
function stateForEvent(event) {
  const direct = normalizeSessionState(event.state);
  if (direct) return direct;
  const name = String(event.event ?? event.type ?? event.hook_event_name ?? "").toLowerCase();
  if (["session.opened", "session.changed"].includes(name)) return "idle";
  if (["turn.started", "tool.started", "tool.finished"].includes(name)) return "working";
  if (name === "turn.completed") return String(event.outcome ?? "").toLowerCase() === "failed" ? "error" : "unread";
  if (name === "input.requested") {
    return String(event.inputType ?? event.kind ?? "").toLowerCase().includes("approval") ? "awaiting-approval" : "awaiting-response";
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
function transitionSessionState(previous, event) {
  const next = stateForEvent(event);
  if (!next) return null;
  const name = String(event.event ?? event.type ?? event.hook_event_name ?? "").toLowerCase();
  if (next === "error" || next === "off" || name === "input.requested" || name === "input.resolved") return next;
  if (previous === "awaiting-approval" || previous === "awaiting-response") return previous;
  return next;
}
var RecentSessionRegistry = class {
  #slots;
  #capacity;
  #now;
  constructor(sessions = [], { capacity = 6, now = Date.now } = {}) {
    this.#capacity = capacity;
    this.#now = now;
    this.#slots = Array.from({ length: capacity }, () => null);
    const seen = /* @__PURE__ */ new Set();
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
        route: null
      };
    }
  }
  upsert(input2) {
    const now = this.#now();
    const state = normalizeSessionState(input2.state) ?? "idle";
    let slot = this.#slots.findIndex((entry) => entry?.sessionId === input2.sessionId);
    if (slot < 0) {
      slot = this.#slots.findIndex((entry) => entry === null);
      if (slot < 0) {
        slot = this.#slots.reduce((oldest, entry, index, all) => (entry?.updatedAt ?? Infinity) < (all[oldest]?.updatedAt ?? Infinity) ? index : oldest, 0);
      }
    }
    if (input2.selected === true) {
      for (const entry of this.#slots) if (entry) entry.selected = false;
    }
    const previous = this.#slots[slot];
    this.#slots[slot] = {
      sessionId: input2.sessionId,
      state,
      selected: input2.selected ?? previous?.selected ?? false,
      pulsing: input2.pulsing ?? previous?.pulsing ?? false,
      updatedAt: typeof input2.updatedAt === "number" && Number.isFinite(input2.updatedAt) ? input2.updatedAt : now,
      route: input2.route === void 0 ? previous?.route ?? null : input2.route
    };
    return slot;
  }
  remove(sessionId) {
    const slot = this.#slots.findIndex((entry) => entry?.sessionId === sessionId);
    if (slot >= 0) this.#slots[slot] = null;
  }
  selectSlot(slot) {
    const selected = this.#slots[slot] ?? null;
    if (!selected) return null;
    for (const entry of this.#slots) if (entry) entry.selected = entry === selected;
    selected.updatedAt = this.#now();
    return { ...selected, route: selected.route ? { ...selected.route } : null };
  }
  setRoute(sessionId, route) {
    const session = this.#slots.find((entry) => entry?.sessionId === sessionId);
    if (session) session.route = route;
  }
  active() {
    const populated = this.#slots.filter((entry) => entry !== null);
    const selected = populated.find((entry) => entry.selected);
    const session = selected ?? populated.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
    return session ? { ...session, route: session.route ? { ...session.route } : null } : null;
  }
  at(slot) {
    const session = this.#slots[slot] ?? null;
    return session ? { ...session, route: session.route ? { ...session.route } : null } : null;
  }
  entries() {
    return this.#slots.map((session) => session ? { ...session, route: session.route ? { ...session.route } : null } : null);
  }
  get capacity() {
    return this.#capacity;
  }
};

// src/status-lighting.ts
var FACTORY_COLORS = Object.freeze({
  off: 0,
  idle: 16777215,
  working: 3166206,
  unread: 65356,
  "awaiting-approval": 16739584,
  "awaiting-response": 16739584,
  error: 16711731
});
var VOICE_COLORS = Object.freeze({
  recording: 3050327,
  processing: 16777215,
  completed: 16777215
});
function sessionForLighting(session, appFocused2) {
  return session?.selected && session.state === "unread" && appFocused2 ? { ...session, state: "idle" } : session;
}
function agentKeyLighting(agentKeyIndex, session, brightness2 = 1) {
  if (!session || session.state === "off" || brightness2 <= 0) {
    return encodeAgentKeyLighting({
      agentKeyIndex,
      color: 0,
      brightness: 0,
      effect: LightingEffect.off,
      speed: 0,
      syncKeysLighting: false,
      syncAmbientLighting: false
    });
  }
  const animated = session.selected || session.pulsing;
  return encodeAgentKeyLighting({
    agentKeyIndex,
    color: FACTORY_COLORS[session.state],
    brightness: brightness2,
    effect: animated ? LightingEffect.breath : LightingEffect.solid,
    speed: animated ? 0.4 : 0,
    syncKeysLighting: false,
    syncAmbientLighting: false
  });
}
function channel(color, brightness2, effect, speed) {
  return encodeLightingChannel({ color, brightness: brightness2, effect, speed, mode: 0 });
}
function boardLighting(selected, { brightness: brightness2 = 1, selectionFlash = false, voice: voice2 = null, snakingAmbientStatus: snakingAmbientStatus2 = null, dimmed: dimmed2 = false } = {}) {
  const off = channel(0, 0, LightingEffect.off, 0);
  if (dimmed2) return { ambient: off, keys: off };
  if (snakingAmbientStatus2) {
    return { ambient: channel(FACTORY_COLORS[snakingAmbientStatus2], brightness2, LightingEffect.snake, 0.4), keys: off };
  }
  if (voice2) {
    const effect = voice2 === "completed" ? LightingEffect.solid : LightingEffect.snake;
    return {
      ambient: channel(VOICE_COLORS[voice2], brightness2, effect, voice2 === "completed" ? 0 : 0.4),
      keys: channel(VOICE_COLORS[voice2], brightness2, LightingEffect.solid, 0)
    };
  }
  if (selectionFlash && selected) {
    const selectedChannel = channel(FACTORY_COLORS[selected.state], brightness2, LightingEffect.solid, 0);
    const ambient = selected.state === "working" ? channel(FACTORY_COLORS.working, brightness2, LightingEffect.snake, 0.4) : selectedChannel;
    return { ambient, keys: selectedChannel };
  }
  if (selected?.state === "working") {
    return { ambient: channel(FACTORY_COLORS.working, brightness2, LightingEffect.snake, 0.4), keys: off };
  }
  return { ambient: off, keys: off };
}

// src/native-input.ts
var NativeInputInterpreter = class {
  #now;
  #encoderMode;
  #agentDoubleTapMs;
  #micTapMs;
  #holdMs;
  #singleTapFocus;
  #encoderCustom;
  #lastAgent = null;
  #encoderDownAt = null;
  #encoderHoldFired = false;
  #micDownAt = null;
  #micPendingUntil = null;
  #micLatched = false;
  #micSuppressUntil = 0;
  #joystickDirection = null;
  constructor({
    now = Date.now,
    encoderMode = "composer-navigation",
    agentDoubleTapMs = 350,
    micTapMs = 350,
    holdMs = 500,
    singleTapFocus = false,
    encoderCustom = {}
  } = {}) {
    this.#now = now;
    this.#encoderMode = encoderMode;
    this.#agentDoubleTapMs = agentDoubleTapMs;
    this.#micTapMs = micTapMs;
    this.#holdMs = holdMs;
    this.#singleTapFocus = singleTapFocus;
    this.#encoderCustom = encoderCustom;
  }
  key(keyName, actionCode, assignedSessionId = "") {
    const now = this.#now();
    const agent = /^AG0([0-5])$/.exec(keyName);
    if (agent && actionCode === 1) {
      const slot = Number(agent[1]);
      const doubleTap = this.#lastAgent?.slot === slot && this.#lastAgent.sessionId === assignedSessionId && now - this.#lastAgent.at <= this.#agentDoubleTapMs;
      this.#lastAgent = doubleTap ? null : { slot, sessionId: assignedSessionId, at: now };
      const actions2 = [{ action: "thread.select", slot, sessionId: assignedSessionId }];
      if (this.#singleTapFocus || doubleTap) actions2.push({ action: "app.focus", slot, sessionId: assignedSessionId });
      return actions2;
    }
    if (keyName === "ENC_CW" && actionCode === 2) {
      const action2 = this.#encoderAction(-1);
      return action2 ? [{ action: action2 }] : [];
    }
    if (keyName === "ENC_CC" && actionCode === 2) {
      const action2 = this.#encoderAction(1);
      return action2 ? [{ action: action2 }] : [];
    }
    if (keyName === "ENC_CLK") {
      if (actionCode === 1) {
        this.#encoderDownAt = now;
        this.#encoderHoldFired = false;
      }
      if (actionCode === 0 && this.#encoderDownAt !== null) {
        this.#encoderDownAt = null;
        if (this.#encoderHoldFired) return [];
        const action2 = this.#encoderClickAction();
        return action2 ? [{ action: action2 }] : [];
      }
      return [];
    }
    if (keyName === "ACT10") return this.#microphone(actionCode, now);
    if (keyName === "ACT11") return [];
    if (actionCode !== 1) return [];
    const actions = Object.freeze({
      ACT06: "composer.toggleFastMode",
      ACT07: "approval.approve",
      ACT08: "approval.decline",
      ACT09: "thread.fork",
      ACT12: "composer.submit"
    });
    const action = actions[keyName];
    return action ? [{ action }] : [];
  }
  joystick(angle, distance) {
    if (!Number.isFinite(angle) || !Number.isFinite(distance)) return [];
    if (distance < 0.5) {
      this.#joystickDirection = null;
      return [];
    }
    const normalized = (angle % 1 + 1) % 1;
    const direction = normalized >= 0.625 && normalized < 0.875 ? "up" : normalized >= 0.125 && normalized < 0.375 ? "down" : normalized >= 0.375 && normalized < 0.625 ? "left" : "right";
    if (direction === this.#joystickDirection) return [];
    this.#joystickDirection = direction;
    const action = {
      up: "composer.togglePlanMode",
      right: "navigation.forward",
      down: "sidebar.toggle",
      left: "navigation.back"
    };
    return [{ action: action[direction] }];
  }
  tick() {
    const now = this.#now();
    if (this.#encoderDownAt !== null && !this.#encoderHoldFired && now - this.#encoderDownAt >= this.#holdMs) {
      this.#encoderHoldFired = true;
      const action = this.#encoderMode === "custom" ? this.#encoderCustom.longPress ?? null : "settings.codexMicro";
      return action ? [{ action }] : [];
    }
    if (this.#micPendingUntil !== null && now >= this.#micPendingUntil) {
      this.#micPendingUntil = null;
      return [{ action: "voice.pushToTalk.stop", phase: "release" }];
    }
    return [];
  }
  reset() {
    this.#lastAgent = null;
    this.#encoderDownAt = null;
    this.#encoderHoldFired = false;
    this.#micDownAt = null;
    this.#micPendingUntil = null;
    this.#micLatched = false;
    this.#micSuppressUntil = 0;
    this.#joystickDirection = null;
  }
  #encoderAction(direction) {
    if (this.#encoderMode === "custom") return direction < 0 ? this.#encoderCustom.left ?? null : this.#encoderCustom.right ?? null;
    if (this.#encoderMode === "reasoning") return direction < 0 ? "reasoning.decrease" : "reasoning.increase";
    if (this.#encoderMode === "conversation-scroll") return direction < 0 ? "conversation.scrollUp" : "conversation.scrollDown";
    return direction < 0 ? "composer.previous" : "composer.next";
  }
  #encoderClickAction() {
    if (this.#encoderMode === "custom") return this.#encoderCustom.click ?? null;
    if (this.#encoderMode === "reasoning") return "reasoning.options";
    if (this.#encoderMode === "conversation-scroll") return "conversation.scrollBottom";
    return "composer.activate";
  }
  #microphone(actionCode, now) {
    if (now < this.#micSuppressUntil) return [];
    if (actionCode === 1) {
      if (this.#micLatched) {
        this.#micLatched = false;
        this.#micSuppressUntil = now + this.#micTapMs;
        return [{ action: "voice.pushToTalk.stop", phase: "release" }];
      }
      if (this.#micPendingUntil !== null && now < this.#micPendingUntil) {
        this.#micPendingUntil = null;
        this.#micLatched = true;
        return [{ action: "voice.pushToTalk.latch", phase: "latch" }];
      }
      this.#micDownAt = now;
      return [{ action: "voice.pushToTalk.start", phase: "press" }];
    }
    if (actionCode === 0 && this.#micDownAt !== null) {
      const pressedAt = this.#micDownAt;
      const heldFor = now - pressedAt;
      this.#micDownAt = null;
      if (heldFor >= this.#micTapMs) return [{ action: "voice.pushToTalk.stop", phase: "release" }];
      this.#micPendingUntil = pressedAt + this.#micTapMs;
    }
    return [];
  }
};

// src/focus.ts
import { execFile } from "child_process";
function run(command, args) {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message));
    else resolve(stdout.trim());
  }));
}
function normalizeTty(value) {
  const name = value.trim();
  if (!name || name === "??" || !/^[A-Za-z0-9._/-]{1,64}$/.test(name)) return null;
  return name.startsWith("/dev/") ? name : `/dev/${name}`;
}
async function focusTerminalRoute(route) {
  if (process.platform !== "darwin") throw Object.assign(new Error("Exact app focus is supported only on macOS."), { code: "unsupported" });
  if (!route.pid && !route.terminal?.tty) throw Object.assign(new Error("Grok control discovery did not publish a process id or tty."), { code: "unavailable" });
  const tty = normalizeTty(route.terminal?.tty ?? await run("/bin/ps", ["-o", "tty=", "-p", String(route.pid)]));
  if (!tty) throw Object.assign(new Error("The Grok process has no identifiable local terminal tty."), { code: "unavailable" });
  const script = `on run argv
  set wantedTTY to item 1 of argv
  if application "iTerm" is running then
    tell application "iTerm"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if (tty of s) is wantedTTY then
              select w
              select t
              select s
              activate
              return "focused"
            end if
          end repeat
        end repeat
      end repeat
    end tell
  end if
  if application "Terminal" is running then
    tell application "Terminal"
      repeat with w in windows
        repeat with t in tabs of w
          if tty of t is wantedTTY then
            set selected tab of w to t
            set index of w to 1
            activate
            return "focused"
          end if
        end repeat
      end repeat
    end tell
  end if
  error "No Terminal or iTerm tab matched tty " & wantedTTY
end run`;
  const result = await run("/usr/bin/osascript", ["-e", script, tty]);
  if (result !== "focused") throw Object.assign(new Error(`No terminal tab matched ${tty}.`), { code: "unavailable" });
}

// src/focus-state.ts
function routeIdentity(route) {
  return `${route.pid ?? ""}\0${route.socketPath}\0${route.terminal?.tmuxPane ?? ""}\0${route.terminal?.tty ?? ""}`;
}
function focusAfterBackgroundSelection(appFocused2, focusedIdentity, targetIdentity) {
  return appFocused2 && focusedIdentity !== null && focusedIdentity === targetIdentity;
}

// src/device-health.ts
var INITIAL_DEVICE_STATE = Object.freeze({
  status: "not-detected",
  transport: "unknown",
  model: null,
  error: null,
  battery: null,
  detected: false,
  connected: false,
  errorMessage: null,
  firmware: null
});
function failureCode(discoveryFailed, hasConnected2) {
  return discoveryFailed ? "discovery-failed" : hasConnected2 ? "transport-unavailable" : "connection-failed";
}
function connectedTransition(hasConnected2) {
  return hasConnected2 ? "reconnected" : "connected";
}
function failedTransition(hasConnected2) {
  return hasConnected2 ? "connection-lost" : "connection-failed";
}

// src/daemon.ts
var socketPath = process.env.GROK_MICRO_SOCKET ?? "/private/tmp/grok-micro.sock";
var slotsPath = process.env.GROK_MICRO_SLOTS ?? "/private/tmp/grok-micro-slots.json";
var healthPath = process.env.GROK_MICRO_HEALTH ?? "/private/tmp/grok-micro-health.json";
var deviceLockPath = process.env.GROK_MICRO_DEVICE_LOCK ?? "/private/tmp/grok-micro-device.lock";
var maxMessageBytes = Number(process.env.GROK_MICRO_MAX_MESSAGE_BYTES ?? 262144);
var brightness = Math.max(0, Math.min(1, Number(process.env.GROK_MICRO_BRIGHTNESS ?? 1)));
var inputQuietMs = Number(process.env.GROK_MICRO_INPUT_QUIET_MS ?? 100);
var autoOffMs = Number(process.env.GROK_MICRO_AUTO_OFF_MS ?? 18e4);
var selectionAccentMs = Number(process.env.GROK_MICRO_SELECTION_ACCENT_MS ?? 4e3);
var rpcTimeoutMs = Number(process.env.GROK_MICRO_RPC_TIMEOUT_MS ?? 1e4);
var reconnectDelays = [1e3, 2e3, 5e3, 1e4];
function atomicWrite(target, contents) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 448 });
  let handle;
  try {
    handle = fs.openSync(temporary, "wx", 384);
    fs.writeFileSync(handle, contents);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    fs.rmSync(temporary, { force: true });
    handle = fs.openSync(temporary, "wx", 384);
    fs.writeFileSync(handle, contents);
  } finally {
    if (handle !== void 0) fs.closeSync(handle);
  }
  fs.renameSync(temporary, target);
}
function removeSocket() {
  try {
    const stat = fs.lstatSync(socketPath);
    if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket path ${socketPath}.`);
    fs.unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function livePidAt(target) {
  try {
    const pid = Number(fs.readFileSync(target, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
var existingOwner = livePidAt(deviceLockPath);
if (existingOwner && existingOwner !== process.pid && process.env.GROK_MICRO_REPLACE !== "1") {
  throw new Error(`Codex Micro is already owned by grok-micro pid ${existingOwner}.`);
}
atomicWrite(deviceLockPath, `${process.pid}
`);
function restoredSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(slotsPath, "utf8"));
    return Array.isArray(parsed.slots) ? parsed.slots : [];
  } catch {
    return [];
  }
}
var registry = new RecentSessionRegistry(restoredSessions());
var input = new NativeInputInterpreter({
  encoderMode: process.env.GROK_MICRO_ENCODER_MODE ?? "composer-navigation",
  singleTapFocus: process.env.GROK_MICRO_SINGLE_TAP_FOCUS === "1"
});
var healthState = "starting";
var deviceHealth = { ...INITIAL_DEVICE_STATE };
var lifecycleTransition = null;
var lifecycleEvents = [];
var hasConnected = false;
function publishLifecycle(transition) {
  if (lifecycleTransition === transition && transition !== "reconnected") return;
  lifecycleTransition = transition;
  lifecycleEvents.push({ transition, at: (/* @__PURE__ */ new Date()).toISOString() });
  if (lifecycleEvents.length > 20) lifecycleEvents.shift();
}
var lastAction = null;
var device = null;
var reconnectAttempt = 0;
var reconnectTimer = null;
var lastDevicePath;
var lightingInFlight = false;
var lightingPending = true;
var lightingTimer = null;
var lastLightingFingerprint = "";
var displayedSessionIds = Array.from({ length: AGENT_KEY_COUNT }, () => null);
var lastInputAt = 0;
var dimmed = false;
var autoOffDeadline = autoOffMs > 0 ? Date.now() + autoOffMs : Number.POSITIVE_INFINITY;
var selectionAccentUntil = 0;
var voice = null;
var snakingAmbientStatus = null;
var appFocused = false;
var focusedRouteIdentity = null;
var sessionLocked = process.env.GROK_MICRO_SESSION_LOCKED === "1";
var connecting = false;
var lastEnvironmentRefreshAt = 0;
var messageStream = new RpcMessageStream();
var subscriptions = /* @__PURE__ */ new Map();
var catalogRoutes = /* @__PURE__ */ new Map();
function publicSlots() {
  return registry.entries().map((session, slot) => session ? {
    slot,
    sessionId: session.sessionId,
    state: session.state,
    selected: session.selected,
    pulsing: session.pulsing,
    updatedAt: session.updatedAt,
    routable: session.route !== null
  } : null);
}
function persist() {
  atomicWrite(slotsPath, `${JSON.stringify({ version: 1, slots: publicSlots() })}
`);
}
function writeHealth() {
  atomicWrite(healthPath, `${JSON.stringify({
    version: 1,
    state: healthState,
    pid: process.pid,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    dimmed,
    locked: sessionLocked,
    device: deviceHealth,
    lifecycleTransition,
    lifecycleEvents,
    lastAction
  })}
`);
}
function refreshRoutes() {
  const discovered = discoverControlRoutes();
  const routes = new Map([...catalogRoutes, ...discovered].filter((entry) => entry[1] !== null));
  for (const session of registry.entries()) {
    if (session) registry.setRoute(session.sessionId, routes.get(session.sessionId) ?? null);
  }
  const discoveredBySignature = /* @__PURE__ */ new Map();
  for (const [sessionId, route] of discovered) discoveredBySignature.set(`${route.socketPath}\0${route.token}`, { sessionId, route });
  for (const [signature, subscription] of subscriptions) {
    if (discoveredBySignature.has(signature)) continue;
    subscription.close();
    subscriptions.delete(signature);
  }
  for (const [signature, { sessionId, route }] of discoveredBySignature) {
    if (subscriptions.has(signature)) continue;
    const subscription = subscribeControlRoute(
      route,
      (event) => {
        try {
          if (event.type === "session.catalog") {
            const currentId = typeof event.sessionId === "string" ? event.sessionId : sessionId;
            const rows = Array.isArray(event.sessions) ? event.sessions : [];
            for (const row of rows) {
              if (!row || typeof row !== "object" || typeof row.id !== "string") continue;
              const item = row;
              catalogRoutes.set(item.id, route);
              registry.upsert({ sessionId: item.id, state: registry.entries().find((entry) => entry?.sessionId === item.id)?.state ?? "idle", selected: item.id === currentId, updatedAt: item.updatedAt, route });
            }
            persist();
            scheduleLighting();
            return;
          }
          if (event.type === "mode.changed") return;
          updateSession({ ...event, sessionId: event.sessionId ?? sessionId });
        } catch (error) {
          console.error(`grok-micro: ignored control event: ${error.message}`);
        }
      },
      (error) => {
        subscriptions.delete(signature);
        for (const [id, candidate] of catalogRoutes) if (candidate?.socketPath === route.socketPath && candidate.token === route.token) catalogRoutes.delete(id);
        console.error(`grok-micro: control event stream ${sessionId} unavailable: ${error.message}`);
      }
    );
    subscriptions.set(signature, subscription);
  }
}
function selectedSession() {
  return registry.active();
}
function markActivity() {
  autoOffDeadline = autoOffMs > 0 ? Date.now() + autoOffMs : Number.POSITIVE_INFINITY;
  if (dimmed) {
    dimmed = false;
    scheduleLighting();
  }
}
function markInputActivity() {
  lastInputAt = Date.now();
  markActivity();
}
function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${rpcTimeoutMs}ms`)), rpcTimeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectDevice();
  }, delay);
}
async function connectDevice() {
  if (connecting) return;
  connecting = true;
  const wasConnected = deviceHealth.status === "connected";
  try {
    let candidates;
    try {
      candidates = findCodexMicros();
    } catch (error) {
      deviceHealth = { ...deviceHealth, status: "error", detected: false, connected: false, error: "discovery-failed", errorMessage: error.message };
      if (!hasConnected) publishLifecycle(failedTransition(hasConnected));
      throw error;
    }
    if (candidates.length === 0) {
      deviceHealth = { ...deviceHealth, status: "not-detected", detected: false, connected: false, error: null, errorMessage: null, transport: "unknown", model: null };
      healthState = "reconnecting";
      scheduleReconnect();
      return;
    }
    deviceHealth = {
      ...deviceHealth,
      status: "detected",
      detected: true,
      connected: false,
      error: null,
      errorMessage: null,
      transport: transportForDescriptor(candidates[0]),
      model: modelForDescriptor(candidates[0])
    };
    if (device) await withTimeout(device.close(), "device close").catch(() => {
    });
    device = await withTimeout(CodexMicro.connect(), "device open");
    lastDevicePath = device.descriptor.path;
    deviceHealth = {
      ...deviceHealth,
      status: "connected",
      detected: true,
      connected: true,
      error: null,
      errorMessage: null,
      transport: transportForDescriptor(device.descriptor),
      model: modelForDescriptor(device.descriptor)
    };
    reconnectAttempt = 0;
    messageStream.reset();
    attachInput(device);
    healthState = "connected";
    if (!wasConnected) publishLifecycle(connectedTransition(hasConnected));
    hasConnected = true;
    lastLightingFingerprint = "";
    scheduleLighting();
  } catch (error) {
    device = null;
    if (deviceHealth.error !== "discovery-failed") {
      const code = failureCode(false, hasConnected);
      deviceHealth = { ...deviceHealth, status: "error", detected: true, connected: false, error: code, errorMessage: error.message };
      publishLifecycle(failedTransition(hasConnected));
    }
    healthState = "reconnecting";
    console.error(`grok-micro: device unavailable: ${error.message}`);
    scheduleReconnect();
  } finally {
    connecting = false;
    writeHealth();
  }
}
function scheduleLighting() {
  lightingPending = true;
  if (lightingTimer) return;
  const wait = Math.max(0, lastInputAt + inputQuietMs - Date.now());
  lightingTimer = setTimeout(() => {
    lightingTimer = null;
    void flushLighting();
  }, wait);
}
async function flushLighting() {
  if (lightingInFlight || !lightingPending) return;
  if (Date.now() < lastInputAt + inputQuietMs) return scheduleLighting();
  const handle = device;
  if (!handle) return scheduleReconnect();
  lightingInFlight = true;
  lightingPending = false;
  try {
    const sessions = registry.entries();
    const visibleSessions = sessions.map((session) => sessionForLighting(session, appFocused));
    const selected = sessionForLighting(selectedSession(), appFocused);
    const blanked = dimmed || sessionLocked;
    const keys = visibleSessions.map((session, index) => agentKeyLighting(index, blanked ? null : session, brightness));
    const zones = boardLighting(selected, {
      brightness,
      selectionFlash: Date.now() < selectionAccentUntil,
      voice,
      snakingAmbientStatus,
      dimmed: blanked
    });
    const assignments = sessions.map((session) => session?.sessionId ?? null);
    const fingerprint = JSON.stringify({ assignments, keys, zones });
    if (fingerprint !== lastLightingFingerprint) {
      await handle.sendRequest(RpcMethod.lightingConfig, zones);
      await handle.sendRequest(RpcMethod.agentKeyStatus, keys);
      lastLightingFingerprint = fingerprint;
      displayedSessionIds = assignments;
    }
    healthState = "connected";
    deviceHealth = { ...deviceHealth, status: "connected", connected: true, error: null, errorMessage: null };
    reconnectAttempt = 0;
  } catch (error) {
    console.error(`grok-micro: lighting failed: ${error.message}`);
    healthState = "reconnecting";
    deviceHealth = { ...deviceHealth, status: "error", connected: false, error: "transport-unavailable", errorMessage: error.message };
    publishLifecycle("connection-lost");
    lastLightingFingerprint = "";
    device = null;
    scheduleReconnect();
  } finally {
    lightingInFlight = false;
    if (lightingPending) scheduleLighting();
    writeHealth();
  }
}
async function routeEmission(emission) {
  const displayedSessionId = emission.sessionId || (emission.slot === void 0 ? void 0 : displayedSessionIds[emission.slot] ?? void 0);
  if (emission.slot !== void 0 && emission.action === "thread.select") {
    const selectedSlot = registry.entries().findIndex((entry) => entry?.sessionId === displayedSessionId);
    const selected = selectedSlot >= 0 ? registry.selectSlot(selectedSlot) : null;
    if (!displayedSessionId) {
      recordAction(emission.action, false, "unavailable", `Agent slot ${emission.slot + 1} is empty.`);
      return;
    }
    if (selected) {
      selectionAccentUntil = Date.now() + selectionAccentMs;
      persist();
      scheduleLighting();
      setTimeout(scheduleLighting, selectionAccentMs + 5);
    }
  }
  refreshRoutes();
  const target = displayedSessionId ? registry.entries().find((entry) => entry?.sessionId === displayedSessionId) ?? {
    sessionId: displayedSessionId,
    state: "idle",
    selected: false,
    pulsing: false,
    updatedAt: Date.now(),
    route: discoverControlRoutes().get(displayedSessionId) ?? null
  } : emission.slot === void 0 ? selectedSession() : null;
  if (!target?.route) {
    recordAction(emission.action, false, "unavailable", "No authenticated Grok control socket is available for this session.");
    return;
  }
  if (emission.action === "app.focus") {
    try {
      await focusTerminalRoute(target.route);
      appFocused = true;
      focusedRouteIdentity = routeIdentity(target.route);
      scheduleLighting();
      recordAction(emission.action, true);
    } catch (error) {
      recordAction(emission.action, false, String(error.code ?? "unavailable"), error.message);
    }
    return;
  }
  if (emission.action === "thread.select") {
    appFocused = focusAfterBackgroundSelection(appFocused, focusedRouteIdentity, routeIdentity(target.route));
    if (!appFocused) focusedRouteIdentity = null;
  }
  try {
    await sendControlAction(target.route, emission.action, { sessionId: target.sessionId });
    if (emission.action === "voice.pushToTalk.start" || emission.action === "voice.pushToTalk.latch") voice = "recording";
    if (emission.action === "voice.pushToTalk.stop") {
      voice = "completed";
      setTimeout(() => {
        voice = null;
        scheduleLighting();
      }, 500);
    }
    recordAction(emission.action, true);
  } catch (error) {
    const code = error instanceof UnsupportedActionError ? error.code : String(error.code ?? "unavailable");
    recordAction(emission.action, false, code, error.message);
  }
  scheduleLighting();
}
function recordAction(action, ok, code, message) {
  lastAction = { action, ok, ...code ? { code } : {}, ...message ? { message } : {}, at: (/* @__PURE__ */ new Date()).toISOString() };
  const detail = ok ? "ok" : `${code}: ${message}`;
  console.error(`grok-micro action ${action}: ${detail}`);
  writeHealth();
}
function attachInput(handle) {
  handle.onInput((report) => {
    if (sessionLocked) return;
    for (const message of messageStream.pushHidPacket(new Uint8Array(report))) {
      const event = parseDeviceEvent(message);
      if (!event || event.kind === "unrecognized") continue;
      if (event.kind === "keyEvent") {
        markInputActivity();
        const assigned = event.agentKeyIndex === null ? "" : displayedSessionIds[event.agentKeyIndex] ?? "";
        for (const emission of input.key(event.keyName, event.actionCode, assigned)) void routeEmission(emission);
      } else {
        if (event.distance > 0.1) markInputActivity();
        for (const emission of input.joystick(event.angle, event.distance)) void routeEmission(emission);
      }
    }
  });
}
function updateSession(event) {
  const sessionId = event.sessionId ?? event.session_id;
  let appliedOverride = false;
  if (event.voice === "recording" || event.voice === "processing" || event.voice === "completed" || event.voice === null) {
    voice = event.voice;
    appliedOverride = true;
  }
  if (event.snakingAmbientStatus === null) {
    snakingAmbientStatus = null;
    appliedOverride = true;
  } else if (event.snakingAmbientStatus !== void 0) {
    const normalized = normalizeSessionState(event.snakingAmbientStatus);
    if (normalized) {
      snakingAmbientStatus = normalized;
      appliedOverride = true;
    }
  }
  if (typeof event.appFocused === "boolean") {
    appFocused = event.appFocused;
    if (!appFocused) focusedRouteIdentity = null;
    appliedOverride = true;
  }
  const validSessionId = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  const previous = validSessionId ? registry.entries().find((entry) => entry?.sessionId === validSessionId)?.state ?? null : null;
  const state = transitionSessionState(previous, event);
  if (!state) {
    if (!appliedOverride) throw new Error("Event requires a Grok sessionId and supported state/event.");
    markActivity();
    scheduleLighting();
    return { slot: -1, state: "unchanged" };
  }
  if (!validSessionId) throw new Error("State events require a Grok sessionId.");
  if (state === "off") {
    registry.remove(validSessionId);
    persist();
    markActivity();
    scheduleLighting();
    return { slot: -1, state };
  }
  refreshRoutes();
  const route = discoverControlRoutes().get(validSessionId) ?? null;
  const slot = registry.upsert({
    sessionId: validSessionId,
    state,
    selected: typeof event.selected === "boolean" ? event.selected : void 0,
    pulsing: typeof event.pulsing === "boolean" ? event.pulsing : void 0,
    route
  });
  persist();
  markActivity();
  scheduleLighting();
  return { slot, state };
}
function refreshSessionLock() {
  if (process.env.GROK_MICRO_SESSION_LOCKED !== void 0 || process.platform !== "darwin") return;
  execFile2("/usr/sbin/ioreg", ["-n", "Root", "-d1"], (_error, stdout) => {
    const nextLocked = /CGSSessionScreenIsLocked[^=]*=\s*(?:Yes|1)/i.test(stdout);
    if (nextLocked && !sessionLocked) {
      input.reset();
      voice = null;
    }
    if (nextLocked !== sessionLocked) {
      sessionLocked = nextLocked;
      lastLightingFingerprint = "";
      scheduleLighting();
      writeHealth();
    }
  });
}
async function refreshDeviceStatus() {
  const handle = device;
  if (!handle || lightingInFlight) return;
  const quietIn = lastInputAt + inputQuietMs - Date.now();
  if (quietIn > 0) {
    setTimeout(() => void refreshDeviceStatus(), quietIn);
    return;
  }
  try {
    const { result } = await handle.call("device.status", null);
    if (result && typeof result === "object") {
      const status = result;
      deviceHealth = {
        ...deviceHealth,
        firmware: typeof status.version === "string" ? status.version : deviceHealth.firmware,
        battery: typeof status.battery === "number" ? {
          percentage: status.battery,
          isCharging: typeof status.is_charging === "boolean" ? status.is_charging : deviceHealth.battery?.isCharging ?? false
        } : deviceHealth.battery
      };
      writeHealth();
    }
  } catch (error) {
    deviceHealth = { ...deviceHealth, status: "error", connected: false, error: "transport-unavailable", errorMessage: `device.status: ${error.message}` };
    publishLifecycle("connection-lost");
    healthState = "reconnecting";
    device = null;
    lastLightingFingerprint = "";
    scheduleReconnect();
    writeHealth();
  }
}
function scanTopology() {
  let current;
  try {
    current = findCodexMicros()[0];
  } catch {
    current = void 0;
  }
  if (!current && deviceHealth.status !== "error") {
    deviceHealth = { ...deviceHealth, status: "not-detected", detected: false, connected: false, transport: "unknown", model: null };
  } else if (current && deviceHealth.status === "not-detected") {
    deviceHealth = { ...deviceHealth, status: "detected", detected: true, transport: transportForDescriptor(current), model: modelForDescriptor(current) };
  }
  if (current?.path !== lastDevicePath) {
    lastDevicePath = current?.path;
    healthState = "reconnecting";
    void connectDevice();
    for (const delay of [250, 1e3, 3e3]) setTimeout(() => void connectDevice(), delay);
  }
}
removeSocket();
var server = net.createServer({ allowHalfOpen: true }, (connection) => {
  connection.setEncoding("utf8");
  connection.setTimeout(3e3, () => connection.destroy());
  let body = "";
  let oversized = false;
  connection.on("error", () => {
  });
  connection.on("data", (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > maxMessageBytes) {
      oversized = true;
      connection.end(JSON.stringify({ ok: false, error: "Message exceeds grok-micro limit." }));
    }
  });
  connection.on("end", () => {
    if (oversized) return;
    try {
      const event = JSON.parse(body);
      if (event.op === "grok-micro.health") {
        connection.end(JSON.stringify({ ok: true, state: healthState, pid: process.pid, dimmed, locked: sessionLocked, device: deviceHealth, lifecycleTransition, lifecycleEvents, lastAction }));
        return;
      }
      const result = updateSession(event);
      connection.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      connection.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
});
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 384);
  healthState = device ? "connected" : "reconnecting";
  writeHealth();
  console.log(`grok-micro listening on ${socketPath}`);
});
var maintenanceTimer = setInterval(() => {
  if (Date.now() - lastEnvironmentRefreshAt >= 1e3) {
    lastEnvironmentRefreshAt = Date.now();
    refreshSessionLock();
    refreshRoutes();
  }
  for (const emission of input.tick()) void routeEmission(emission);
  if (autoOffMs > 0 && !dimmed && Date.now() >= autoOffDeadline) {
    dimmed = true;
    scheduleLighting();
  }
}, 50);
var topologyTimer = setInterval(() => {
  scanTopology();
}, 3e4);
var batteryTimer = setInterval(() => void refreshDeviceStatus(), 6e4);
await connectDevice();
for (const delay of [250, 1e3, 3e3]) setTimeout(scanTopology, delay);
void refreshDeviceStatus();
persist();
async function shutdown() {
  clearInterval(maintenanceTimer);
  clearInterval(topologyTimer);
  clearInterval(batteryTimer);
  if (lightingTimer) clearTimeout(lightingTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  server.close();
  for (const current of subscriptions.values()) current.close();
  subscriptions.clear();
  try {
    if (device) {
      const offKeys = Array.from({ length: AGENT_KEY_COUNT }, (_, index) => agentKeyLighting(index, null, 0));
      const offZones = boardLighting(null, { dimmed: true });
      await device.sendRequest(RpcMethod.lightingConfig, offZones).catch(() => {
      });
      await device.sendRequest(RpcMethod.agentKeyStatus, offKeys).catch(() => {
      });
      await device.close().catch(() => {
      });
    }
  } finally {
    healthState = "stopped";
    writeHealth();
    removeSocket();
    if (livePidAt(deviceLockPath) === process.pid) fs.rmSync(deviceLockPath, { force: true });
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void shutdown().finally(() => process.exit(0)));
}
