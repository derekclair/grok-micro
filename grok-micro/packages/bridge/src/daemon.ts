import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { resolveRuntimeFile } from "./runtime-paths";
import { execFile } from "node:child_process";
import {
  AGENT_KEY_COUNT,
  RpcMessageStream,
  RpcMethod,
  parseDeviceEvent,
} from "codex-micro-protocol";
import { CodexMicro, findCodexMicros, modelForDescriptor, transportForDescriptor } from "./micro";
import { RecentSessionRegistry, normalizeSessionState, transitionSessionState, type GrokSession, type GrokSessionState } from "./state";
import { agentKeyLighting, boardLighting, sessionForLighting, type VoiceState } from "./status-lighting";
import { NativeInputInterpreter, type ActionEmission, type EncoderMode, type NativeAction } from "./native-input";
import { discoverControlRoutes, sendControlAction, subscribeControlRoute, UnsupportedActionError, type ControlSubscription } from "./grok-control";
import { focusTerminalRoute } from "./focus";
import { focusAfterBackgroundSelection, routeIdentity } from "./focus-state";
import {
  connectedTransition,
  failedTransition,
  failureCode,
  INITIAL_DEVICE_STATE,
  type LifecycleTransition,
  type PublicDeviceState,
} from "./device-health";

const socketPath = resolveRuntimeFile("socket");
const slotsPath = resolveRuntimeFile("slots");
const healthPath = resolveRuntimeFile("health");
const deviceLockPath = resolveRuntimeFile("lock");
const maxMessageBytes = Number(process.env.GROK_MICRO_MAX_MESSAGE_BYTES ?? 262_144);
const brightness = Math.max(0, Math.min(1, Number(process.env.GROK_MICRO_BRIGHTNESS ?? 1)));
const inputQuietMs = Number(process.env.GROK_MICRO_INPUT_QUIET_MS ?? 100);
const autoOffMs = Number(process.env.GROK_MICRO_AUTO_OFF_MS ?? 180_000);
const selectionAccentMs = Number(process.env.GROK_MICRO_SELECTION_ACCENT_MS ?? 4_000);
const rpcTimeoutMs = Number(process.env.GROK_MICRO_RPC_TIMEOUT_MS ?? 10_000);
const reconnectDelays = [1_000, 2_000, 5_000, 10_000];

function atomicWrite(target: string, contents: string): void {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  let handle: number | undefined;
  try {
    handle = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(handle, contents);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    fs.rmSync(temporary, { force: true });
    handle = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(handle, contents);
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  fs.renameSync(temporary, target);
}

function removeSocket(): void {
  try {
    const stat = fs.lstatSync(socketPath);
    if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket path ${socketPath}.`);
    fs.unlinkSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function livePidAt(target: string): number | null {
  try {
    const pid = Number(fs.readFileSync(target, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

const existingOwner = livePidAt(deviceLockPath);
if (existingOwner && existingOwner !== process.pid && process.env.GROK_MICRO_REPLACE !== "1") {
  throw new Error(`Codex Micro is already owned by grok-micro pid ${existingOwner}.`);
}
atomicWrite(deviceLockPath, `${process.pid}\n`);

function restoredSessions(): Array<Partial<GrokSession>> {
  try {
    const parsed = JSON.parse(fs.readFileSync(slotsPath, "utf8")) as { slots?: unknown };
    return Array.isArray(parsed.slots) ? parsed.slots as Array<Partial<GrokSession>> : [];
  } catch {
    return [];
  }
}

const registry = new RecentSessionRegistry(restoredSessions());
const input = new NativeInputInterpreter({
  encoderMode: (process.env.GROK_MICRO_ENCODER_MODE ?? "composer-navigation") as EncoderMode,
  singleTapFocus: process.env.GROK_MICRO_SINGLE_TAP_FOCUS === "1",
});

let healthState = "starting";
let deviceHealth: PublicDeviceState = { ...INITIAL_DEVICE_STATE };
let lifecycleTransition: LifecycleTransition | null = null;
const lifecycleEvents: Array<{ transition: LifecycleTransition; at: string }> = [];
let hasConnected = false;

function publishLifecycle(transition: LifecycleTransition): void {
  if (lifecycleTransition === transition && transition !== "reconnected") return;
  lifecycleTransition = transition;
  lifecycleEvents.push({ transition, at: new Date().toISOString() });
  if (lifecycleEvents.length > 20) lifecycleEvents.shift();
}
let lastAction: { action: string; ok: boolean; code?: string; message?: string; at: string } | null = null;
let device: CodexMicro | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastDevicePath: string | undefined;
let lightingInFlight = false;
let lightingPending = true;
let lightingTimer: ReturnType<typeof setTimeout> | null = null;
let lastLightingFingerprint = "";
let displayedSessionIds: Array<string | null> = Array.from({ length: AGENT_KEY_COUNT }, () => null);
let lastInputAt = 0;
let dimmed = false;
let autoOffDeadline = autoOffMs > 0 ? Date.now() + autoOffMs : Number.POSITIVE_INFINITY;
let selectionAccentUntil = 0;
let voice: VoiceState = null;
let snakingAmbientStatus: GrokSessionState | null = null;
let appFocused = false;
let focusedRouteIdentity: string | null = null;
let sessionLocked = process.env.GROK_MICRO_SESSION_LOCKED === "1";
let connecting = false;
let lastEnvironmentRefreshAt = 0;
const messageStream = new RpcMessageStream();
const subscriptions = new Map<string, ControlSubscription>();
const catalogRoutes = new Map<string, GrokSession["route"]>();

function publicSlots() {
  return registry.entries().map((session, slot) => session ? {
    slot,
    sessionId: session.sessionId,
    state: session.state,
    selected: session.selected,
    pulsing: session.pulsing,
    updatedAt: session.updatedAt,
    routable: session.route !== null,
  } : null);
}

function persist(): void {
  atomicWrite(slotsPath, `${JSON.stringify({ version: 1, slots: publicSlots() })}\n`);
}

function writeHealth(): void {
  atomicWrite(healthPath, `${JSON.stringify({
    version: 1,
    state: healthState,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    dimmed,
    locked: sessionLocked,
    device: deviceHealth,
    lifecycleTransition,
    lifecycleEvents,
    lastAction,
  })}\n`);
}

function refreshRoutes(): void {
  const discovered = discoverControlRoutes();
  const routes = new Map([...catalogRoutes, ...discovered].filter((entry): entry is [string, NonNullable<GrokSession["route"]>] => entry[1] !== null));
  for (const session of registry.entries()) {
    if (session) registry.setRoute(session.sessionId, routes.get(session.sessionId) ?? null);
  }
  const discoveredBySignature = new Map<string, { sessionId: string; route: NonNullable<GrokSession["route"]> }>();
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
              if (!row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string") continue;
              const item = row as { id: string; updatedAt?: number };
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
          console.error(`grok-micro: ignored control event: ${(error as Error).message}`);
        }
      },
      (error) => {
        subscriptions.delete(signature);
        for (const [id, candidate] of catalogRoutes) if (candidate?.socketPath === route.socketPath && candidate.token === route.token) catalogRoutes.delete(id);
        console.error(`grok-micro: control event stream ${sessionId} unavailable: ${error.message}`);
      },
    );
    subscriptions.set(signature, subscription);
  }
}

function selectedSession(): GrokSession | null {
  return registry.active();
}

function markActivity(): void {
  autoOffDeadline = autoOffMs > 0 ? Date.now() + autoOffMs : Number.POSITIVE_INFINITY;
  if (dimmed) {
    dimmed = false;
    scheduleLighting();
  }
}

function markInputActivity(): void {
  lastInputAt = Date.now();
  markActivity();
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${rpcTimeoutMs}ms`)), rpcTimeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectDevice();
  }, delay);
}

async function connectDevice(): Promise<void> {
  if (connecting) return;
  connecting = true;
  const wasConnected = deviceHealth.status === "connected";
  try {
    let candidates: ReturnType<typeof findCodexMicros>;
    try {
      candidates = findCodexMicros();
    } catch (error) {
      deviceHealth = { ...deviceHealth, status: "error", detected: false, connected: false, error: "discovery-failed", errorMessage: (error as Error).message };
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
      model: modelForDescriptor(candidates[0]),
    };
    if (device) await withTimeout(device.close(), "device close").catch(() => {});
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
      model: modelForDescriptor(device.descriptor),
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
      deviceHealth = { ...deviceHealth, status: "error", detected: true, connected: false, error: code, errorMessage: (error as Error).message };
      publishLifecycle(failedTransition(hasConnected));
    }
    healthState = "reconnecting";
    console.error(`grok-micro: device unavailable: ${(error as Error).message}`);
    scheduleReconnect();
  } finally {
    connecting = false;
    writeHealth();
  }
}

function scheduleLighting(): void {
  lightingPending = true;
  if (lightingTimer) return;
  const wait = Math.max(0, lastInputAt + inputQuietMs - Date.now());
  lightingTimer = setTimeout(() => {
    lightingTimer = null;
    void flushLighting();
  }, wait);
}

async function flushLighting(): Promise<void> {
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
      dimmed: blanked,
    });
    const assignments = sessions.map((session) => session?.sessionId ?? null);
    const fingerprint = JSON.stringify({ assignments, keys, zones });
    if (fingerprint !== lastLightingFingerprint) {
      // Native app always publishes the board zones before per-thread status.
      await handle.sendRequest(RpcMethod.lightingConfig, zones);
      await handle.sendRequest(RpcMethod.agentKeyStatus, keys);
      lastLightingFingerprint = fingerprint;
      displayedSessionIds = assignments;
    }
    healthState = "connected";
    deviceHealth = { ...deviceHealth, status: "connected", connected: true, error: null, errorMessage: null };
    reconnectAttempt = 0;
  } catch (error) {
    console.error(`grok-micro: lighting failed: ${(error as Error).message}`);
    healthState = "reconnecting";
    deviceHealth = { ...deviceHealth, status: "error", connected: false, error: "transport-unavailable", errorMessage: (error as Error).message };
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

async function routeEmission(emission: ActionEmission): Promise<void> {
  const displayedSessionId = emission.sessionId || (emission.slot === undefined ? undefined : displayedSessionIds[emission.slot] ?? undefined);
  if (emission.slot !== undefined && emission.action === "thread.select") {
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
  const target = displayedSessionId
    ? registry.entries().find((entry) => entry?.sessionId === displayedSessionId) ?? {
      sessionId: displayedSessionId,
      state: "idle" as const,
      selected: false,
      pulsing: false,
      updatedAt: Date.now(),
      route: discoverControlRoutes().get(displayedSessionId) ?? null,
    }
    : emission.slot === undefined ? selectedSession() : null;
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
      recordAction(emission.action, false, String((error as { code?: unknown }).code ?? "unavailable"), (error as Error).message);
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
      setTimeout(() => { voice = null; scheduleLighting(); }, 500);
    }
    recordAction(emission.action, true);
  } catch (error) {
    const code = error instanceof UnsupportedActionError ? error.code : String((error as { code?: unknown }).code ?? "unavailable");
    recordAction(emission.action, false, code, (error as Error).message);
  }
  scheduleLighting();
}

function recordAction(action: NativeAction, ok: boolean, code?: string, message?: string): void {
  lastAction = { action, ok, ...(code ? { code } : {}), ...(message ? { message } : {}), at: new Date().toISOString() };
  const detail = ok ? "ok" : `${code}: ${message}`;
  console.error(`grok-micro action ${action}: ${detail}`);
  writeHealth();
}

function attachInput(handle: CodexMicro): void {
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

function updateSession(event: Record<string, unknown>): { slot: number; state: string } {
  const sessionId = event.sessionId ?? event.session_id;
  let appliedOverride = false;
  if (event.voice === "recording" || event.voice === "processing" || event.voice === "completed" || event.voice === null) {
    voice = event.voice as VoiceState;
    appliedOverride = true;
  }
  if (event.snakingAmbientStatus === null) {
    snakingAmbientStatus = null;
    appliedOverride = true;
  } else if (event.snakingAmbientStatus !== undefined) {
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
    selected: typeof event.selected === "boolean" ? event.selected : undefined,
    pulsing: typeof event.pulsing === "boolean" ? event.pulsing : undefined,
    route,
  });
  persist();
  markActivity();
  scheduleLighting();
  return { slot, state };
}

function refreshSessionLock(): void {
  if (process.env.GROK_MICRO_SESSION_LOCKED !== undefined || process.platform !== "darwin") return;
  execFile("/usr/sbin/ioreg", ["-n", "Root", "-d1"], (_error, stdout) => {
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

async function refreshDeviceStatus(): Promise<void> {
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
      const status = result as Record<string, unknown>;
      deviceHealth = {
        ...deviceHealth,
        firmware: typeof status.version === "string" ? status.version : deviceHealth.firmware,
        battery: typeof status.battery === "number" ? {
          percentage: status.battery,
          isCharging: typeof status.is_charging === "boolean" ? status.is_charging : deviceHealth.battery?.isCharging ?? false,
        } : deviceHealth.battery,
      };
      writeHealth();
    }
  } catch (error) {
    deviceHealth = { ...deviceHealth, status: "error", connected: false, error: "transport-unavailable", errorMessage: `device.status: ${(error as Error).message}` };
    publishLifecycle("connection-lost");
    healthState = "reconnecting";
    device = null;
    lastLightingFingerprint = "";
    scheduleReconnect();
    writeHealth();
  }
}

function scanTopology(): void {
  let current: ReturnType<typeof findCodexMicros>[number] | undefined;
  try { current = findCodexMicros()[0]; } catch { current = undefined; }
  if (!current && deviceHealth.status !== "error") {
    deviceHealth = { ...deviceHealth, status: "not-detected", detected: false, connected: false, transport: "unknown", model: null };
  } else if (current && deviceHealth.status === "not-detected") {
    deviceHealth = { ...deviceHealth, status: "detected", detected: true, transport: transportForDescriptor(current), model: modelForDescriptor(current) };
  }
  if (current?.path !== lastDevicePath) {
    lastDevicePath = current?.path;
    healthState = "reconnecting";
    void connectDevice();
    for (const delay of [250, 1_000, 3_000]) setTimeout(() => void connectDevice(), delay);
  }
}

removeSocket();
const server = net.createServer({ allowHalfOpen: true }, (connection) => {
  connection.setEncoding("utf8");
  connection.setTimeout(3_000, () => connection.destroy());
  let body = "";
  let oversized = false;
  connection.on("error", () => {});
  connection.on("data", (chunk: string) => {
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
      const event = JSON.parse(body) as Record<string, unknown>;
      if (event.op === "grok-micro.health") {
        connection.end(JSON.stringify({ ok: true, state: healthState, pid: process.pid, dimmed, locked: sessionLocked, device: deviceHealth, lifecycleTransition, lifecycleEvents, lastAction }));
        return;
      }
      const result = updateSession(event);
      connection.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      connection.end(JSON.stringify({ ok: false, error: (error as Error).message }));
    }
  });
});

server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600);
  healthState = device ? "connected" : "reconnecting";
  writeHealth();
  console.log(`grok-micro listening on ${socketPath}`);
});

const maintenanceTimer = setInterval(() => {
  if (Date.now() - lastEnvironmentRefreshAt >= 1_000) {
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

const topologyTimer = setInterval(() => {
  scanTopology();
}, 30_000);
const batteryTimer = setInterval(() => void refreshDeviceStatus(), 60_000);

await connectDevice();
for (const delay of [250, 1_000, 3_000]) setTimeout(scanTopology, delay);
void refreshDeviceStatus();
persist();

async function shutdown(): Promise<void> {
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
      await device.sendRequest(RpcMethod.lightingConfig, offZones).catch(() => {});
      await device.sendRequest(RpcMethod.agentKeyStatus, offKeys).catch(() => {});
      await device.close().catch(() => {});
    }
  } finally {
    healthState = "stopped";
    writeHealth();
    removeSocket();
    if (livePidAt(deviceLockPath) === process.pid) fs.rmSync(deviceLockPath, { force: true });
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown().finally(() => process.exit(0)));
}
