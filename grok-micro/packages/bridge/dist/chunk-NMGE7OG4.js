// ../protocol/dist/index.js
var WORK_LOUDER_VENDOR_ID = 12346;
var CODEX_MICRO_PRODUCT_ID = 33632;
var CREATOR_MICRO_V2_PRODUCT_IDS = Object.freeze([33431, 33432]);
var VENDOR_USAGE_PAGE = 65280;
function codexMicroModelForProductId(productId) {
  if (productId === CODEX_MICRO_PRODUCT_ID) return "codex-micro";
  if (CREATOR_MICRO_V2_PRODUCT_IDS.includes(productId ?? -1)) return "creator-micro-v2";
  return null;
}
function isCodexMicroInterface(descriptor) {
  return descriptor?.vendorId === WORK_LOUDER_VENDOR_ID && codexMicroModelForProductId(descriptor?.productId) !== null && descriptor?.usagePage === VENDOR_USAGE_PAGE;
}
var HID_REPORT_ID = 6;
var RPC_CHANNEL = 2;
var HID_PACKET_LENGTH = 64;
var HID_PACKET_HEADER_LENGTH = 3;
var HID_PACKET_PAYLOAD_CAPACITY = HID_PACKET_LENGTH - HID_PACKET_HEADER_LENGTH;
function encodeHidPackets(messageBytes) {
  if (!(messageBytes instanceof Uint8Array)) {
    throw new TypeError("encodeHidPackets expects the message as a Uint8Array.");
  }
  const packets = [];
  for (let messageOffset = 0; messageOffset < messageBytes.length; messageOffset += HID_PACKET_PAYLOAD_CAPACITY) {
    const chunk = messageBytes.subarray(messageOffset, messageOffset + HID_PACKET_PAYLOAD_CAPACITY);
    const packet = new Uint8Array(HID_PACKET_LENGTH);
    packet[0] = HID_REPORT_ID;
    packet[1] = RPC_CHANNEL;
    packet[2] = chunk.length;
    packet.set(chunk, HID_PACKET_HEADER_LENGTH);
    packets.push(packet);
  }
  return packets;
}
function decodeHidPacket(packetBytes) {
  if (!(packetBytes instanceof Uint8Array) || packetBytes.length < HID_PACKET_HEADER_LENGTH) return null;
  const declaredLength = packetBytes[2];
  const availableLength = packetBytes.length - HID_PACKET_HEADER_LENGTH;
  return {
    reportId: packetBytes[0],
    channel: packetBytes[1],
    payload: packetBytes.subarray(
      HID_PACKET_HEADER_LENGTH,
      HID_PACKET_HEADER_LENGTH + Math.min(declaredLength, availableLength)
    )
  };
}
function rpcPayloadFromPacket(packetBytes) {
  const decoded = decodeHidPacket(packetBytes);
  if (!decoded || decoded.reportId !== HID_REPORT_ID || decoded.channel !== RPC_CHANNEL) return null;
  if (decoded.payload.length === 0) return null;
  return decoded.payload;
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var RpcMethod = Object.freeze({
  /** Query firmware version information. Params: null. */
  firmwareVersion: "sys.version",
  /** Set the six frosted agent-key LEDs. Params: array of agent-key lighting objects. */
  agentKeyStatus: "v.oai.thstatus",
  /** Configure whole-board lighting. Params: {keys?, ambient?} channel objects. */
  lightingConfig: "v.oai.rgbcfg",
  /** Device → host: key press/release/encoder events. */
  keyEvent: "v.oai.hid",
  /** Device → host: continuous joystick radial samples. */
  joystickSample: "v.oai.rad"
});
var utf8Encoder = new TextEncoder();
function encodeRpcRequest({ method, params = null, id }) {
  if (typeof method !== "string" || method.length === 0) {
    throw new TypeError("encodeRpcRequest requires a non-empty method name.");
  }
  if (!Number.isInteger(id) || id < 0 || id > 998) {
    throw new TypeError("encodeRpcRequest requires an integer id between 0 and 998.");
  }
  const json = JSON.stringify({ method, params, id }).replace(/[\u0080-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return utf8Encoder.encode(json);
}
function parseRpcMessage(messageText) {
  let parsed;
  try {
    parsed = JSON.parse(messageText);
  } catch {
    return { type: "invalid", text: messageText };
  }
  if (!isJsonObject(parsed)) return { type: "unknown", raw: parsed };
  const method = typeof parsed.method === "string" ? parsed.method : typeof parsed.m === "string" ? parsed.m : null;
  const hasEventParams = Object.prototype.hasOwnProperty.call(parsed, "params") || Object.prototype.hasOwnProperty.call(parsed, "p");
  if (method && hasEventParams) {
    const params = Object.prototype.hasOwnProperty.call(parsed, "params") ? parsed.params : parsed.p;
    return { type: "event", method, params, raw: parsed };
  }
  const responseId = Number.isInteger(parsed.id) ? parsed.id : Number.isInteger(parsed.i) ? parsed.i : null;
  if (typeof responseId === "number") {
    const response = { type: "response", id: responseId, result: parsed.result, raw: parsed };
    const responseMethod = typeof parsed.method === "string" ? parsed.method : typeof parsed.m === "string" ? parsed.m : null;
    if (responseMethod) response.method = responseMethod;
    return response;
  }
  if (method) {
    return { type: "event", method, params: void 0, raw: parsed };
  }
  return { type: "unknown", raw: parsed };
}
var MAX_PENDING_MESSAGE_LENGTH = 65536;
var RpcMessageStream = class {
  #pendingText = "";
  // Streaming decode holds partial multi-byte sequences between pushes, so
  // the decoder must be per-instance state, never shared.
  #utf8Decoder = new TextDecoder();
  /** Feed one raw 64-byte HID report. Non-RPC reports are ignored. */
  pushHidPacket(packetBytes) {
    const payload = rpcPayloadFromPacket(packetBytes);
    if (!payload) return [];
    return this.pushPayload(payload);
  }
  /** Feed deframed payload bytes (a chunk of the UTF-8 message stream). */
  pushPayload(payloadBytes) {
    return this.pushText(this.#utf8Decoder.decode(payloadBytes, { stream: true }));
  }
  /** Feed decoded text directly. */
  pushText(text) {
    this.#pendingText += text;
    const lines = this.#pendingText.split(/\r?\n/);
    this.#pendingText = lines.pop() ?? "";
    const messages = lines.filter((line) => line.length > 0).map(parseRpcMessage);
    if (this.#pendingText.length > MAX_PENDING_MESSAGE_LENGTH) {
      messages.push({ type: "invalid", text: this.#pendingText.slice(0, 1024) });
      this.#pendingText = "";
    }
    return messages;
  }
  /** Text received after the last complete message (useful for diagnostics). */
  get pendingText() {
    return this.#pendingText;
  }
  /**
   * Discards buffered text and partial UTF-8 state. Call after a device
   * disconnect/reconnect — the buffer is connection state.
   */
  reset() {
    this.#pendingText = "";
    this.#utf8Decoder = new TextDecoder();
  }
};
var LightingEffect = Object.freeze({
  off: 0,
  solid: 1,
  snake: 2,
  rainbow: 3,
  breath: 4,
  gradient: 5,
  shallowBreath: 6
});
var AGENT_KEY_COUNT = 6;
var LIGHTING_EFFECT_VALUES = new Set(Object.values(LightingEffect));
function assertRgbColor(color, fieldName) {
  if (!Number.isInteger(color) || color < 0 || color > 16777215) {
    throw new RangeError(`${fieldName} must be an integer RGB color between 0x000000 and 0xffffff.`);
  }
}
function assertUnitInterval(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${fieldName} must be a number between 0 and 1.`);
  }
}
function assertLightingEffect(effect) {
  if (!LIGHTING_EFFECT_VALUES.has(effect)) {
    throw new RangeError(`effect must be one of LightingEffect (${[...LIGHTING_EFFECT_VALUES].join(", ")}).`);
  }
}
function isAgentKeyIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < AGENT_KEY_COUNT;
}
function assertAgentKeyIndex(agentKeyIndex) {
  if (!isAgentKeyIndex(agentKeyIndex)) {
    throw new RangeError(`agentKeyIndex must be an integer between 0 and ${AGENT_KEY_COUNT - 1}.`);
  }
}
function encodeAgentKeyLighting({
  agentKeyIndex,
  color,
  brightness,
  effect,
  speed,
  syncKeysLighting,
  syncAmbientLighting
}) {
  assertAgentKeyIndex(agentKeyIndex);
  assertRgbColor(color, "color");
  assertUnitInterval(brightness, "brightness");
  assertLightingEffect(effect);
  assertUnitInterval(speed, "speed");
  const wireEntry = { id: agentKeyIndex, c: color, b: brightness, e: effect, s: speed };
  if (syncKeysLighting !== void 0) wireEntry.sk = syncKeysLighting ? 1 : 0;
  if (syncAmbientLighting !== void 0) wireEntry.sa = syncAmbientLighting ? 1 : 0;
  return wireEntry;
}
function agentKeyStatusParams(encodedEntries) {
  if (!Array.isArray(encodedEntries) || encodedEntries.length === 0 || encodedEntries.length > AGENT_KEY_COUNT) {
    throw new RangeError(`agentKeyStatusParams expects 1-${AGENT_KEY_COUNT} encoded entries.`);
  }
  const seenIndexes = /* @__PURE__ */ new Set();
  for (const entry of encodedEntries) {
    assertAgentKeyIndex(entry?.id);
    if (seenIndexes.has(entry.id)) throw new RangeError(`agent key ${entry.id} appears more than once.`);
    seenIndexes.add(entry.id);
  }
  return encodedEntries.map((entry) => ({ ...entry }));
}
function encodeLightingChannel({ color, brightness, effect, speed, mode = 0 }) {
  assertRgbColor(color, "color");
  assertUnitInterval(brightness, "brightness");
  assertLightingEffect(effect);
  assertUnitInterval(speed, "speed");
  if (!Number.isInteger(mode) || mode < 0) throw new RangeError("mode must be a non-negative integer.");
  return { c: color, b: brightness, e: effect, s: speed, m: mode };
}
function lightingConfigParams({ keys, ambient }) {
  if (keys === void 0 && ambient === void 0) {
    throw new TypeError("lightingConfigParams needs at least one of keys/ambient.");
  }
  const params = {};
  if (keys !== void 0) params.keys = validatedChannel(keys, "keys");
  if (ambient !== void 0) params.ambient = validatedChannel(ambient, "ambient");
  return params;
}
function validatedChannel(channel, channelName) {
  assertRgbColor(channel?.c, `${channelName}.color`);
  assertUnitInterval(channel.b, `${channelName}.brightness`);
  assertLightingEffect(channel.e);
  assertUnitInterval(channel.s, `${channelName}.speed`);
  if (!Number.isInteger(channel.m) || channel.m < 0) {
    throw new RangeError(`${channelName}.mode must be a non-negative integer.`);
  }
  return { ...channel };
}
var KeyActionCode = Object.freeze({
  release: 0,
  press: 1,
  encoderTurn: 2
});
var AGENT_KEY_NAMES = Object.freeze(["AG00", "AG01", "AG02", "AG03", "AG04", "AG05"]);
var ACTION_KEY_NAMES = Object.freeze(["ACT06", "ACT07", "ACT08", "ACT09", "ACT10", "ACT11", "ACT12"]);
var ENCODER_KEY_NAMES = Object.freeze({
  clockwise: "ENC_CW",
  counterClockwise: "ENC_CC"
});
function agentKeyIndexForName(keyName) {
  if (typeof keyName !== "string") return null;
  const index = AGENT_KEY_NAMES.indexOf(keyName);
  return index >= 0 ? index : null;
}
var ACTION_NAME_BY_CODE = new Map(
  Object.entries(KeyActionCode).map(
    ([actionName, actionCode]) => [actionCode, actionName]
  )
);
function parseKeyEvent(eventParams) {
  if (!isJsonObject(eventParams)) return null;
  const keyName = eventParams.k;
  const actionCode = eventParams.act;
  if (typeof keyName !== "string" || typeof actionCode !== "number") return null;
  const action = ACTION_NAME_BY_CODE.get(actionCode);
  if (!action) return null;
  return {
    keyName,
    action,
    actionCode,
    agentKeyIndex: agentKeyIndexForName(keyName)
  };
}
function parseJoystickSample(eventParams) {
  if (!isJsonObject(eventParams)) return null;
  const angle = eventParams.a;
  const distance = eventParams.d;
  if (typeof angle !== "number" || typeof distance !== "number") return null;
  if (!Number.isFinite(angle) || !Number.isFinite(distance)) return null;
  if (distance < 0 || distance > 1) return null;
  return { angle, distance };
}
var JOYSTICK_DIRECTIONS = Object.freeze(["right", "down", "left", "up"]);
function parseDeviceEvent(message) {
  if (message?.type !== "event") return null;
  if (message.method === RpcMethod.keyEvent) {
    const keyEvent = parseKeyEvent(message.params);
    if (keyEvent) return { kind: "keyEvent", ...keyEvent };
  }
  if (message.method === RpcMethod.joystickSample) {
    const joystickSample = parseJoystickSample(message.params);
    if (joystickSample) return { kind: "joystickSample", ...joystickSample };
  }
  return { kind: "unrecognized", method: message.method, params: message.params };
}
function firmwareVersionRequest({ id }) {
  return { method: RpcMethod.firmwareVersion, params: null, id };
}
function agentKeyStatusRequest({ agentKeys, id }) {
  return { method: RpcMethod.agentKeyStatus, params: agentKeyStatusParams(agentKeys), id };
}
function lightingConfigRequest({ keys, ambient, id }) {
  return { method: RpcMethod.lightingConfig, params: lightingConfigParams({ keys, ambient }), id };
}
function encodeRequestPackets(request) {
  return encodeHidPackets(encodeRpcRequest(request));
}

// src/micro.ts
import { randomInt } from "crypto";
import { HIDAsync, devices } from "node-hid";
function transportForDescriptor(descriptor) {
  const transport = descriptor.transport?.toLowerCase();
  if (transport === "usb" || transport === "bluetooth") return transport;
  const markers = `${descriptor.path ?? ""} ${descriptor.product ?? ""}`;
  if (/bluetooth|\bble\b/i.test(markers)) return "bluetooth";
  if (/\busb\b/i.test(markers)) return "usb";
  return "unknown";
}
function modelForDescriptor(descriptor) {
  return codexMicroModelForProductId(descriptor.productId);
}
function sortCodexMicroCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const transportRank = (value) => transportForDescriptor(value) === "usb" ? 0 : transportForDescriptor(value) === "bluetooth" ? 1 : 2;
    const modelRank = (value) => modelForDescriptor(value) === "codex-micro" ? 0 : 1;
    return transportRank(left) - transportRank(right) || modelRank(left) - modelRank(right);
  });
}
function findCodexMicros() {
  return sortCodexMicroCandidates(devices().filter(isCodexMicroInterface));
}
var CodexMicro = class _CodexMicro {
  #device;
  #writeTail = Promise.resolve();
  #lastWriteStartedAt = 0;
  #pending = /* @__PURE__ */ new Map();
  #stream = new RpcMessageStream();
  #inputListeners = /* @__PURE__ */ new Set();
  #closed = false;
  descriptor;
  static async connect() {
    const [descriptor] = findCodexMicros();
    if (!descriptor?.path) throw new Error("Codex Micro vendor HID interface not found. Connect it and grant Input Monitoring.");
    return new _CodexMicro(await HIDAsync.open(descriptor.path, { nonExclusive: true }), descriptor);
  }
  constructor(device, descriptor) {
    this.#device = device;
    this.descriptor = descriptor;
    this.#device.on("data", (report) => {
      for (const message of this.#stream.pushHidPacket(new Uint8Array(report))) {
        if (message.type !== "response") continue;
        const pending = this.#pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.#pending.delete(message.id);
        const error = message.raw.error;
        if (error) pending.reject(new Error(String(error.message ?? "Device RPC failed.")));
        else pending.resolve(message.result);
      }
      for (const listener of this.#inputListeners) listener(report);
    });
    this.#device.on("error", (error) => this.#failPending(error));
  }
  /** Serialized call: random firmware id, 50ms spacing, correlated ACK, one immediate timeout retry. */
  async sendRequest(method, params) {
    return (await this.call(method, params)).id;
  }
  async call(method, params) {
    let completed = { id: -1, result: null };
    const operation = this.#writeTail.then(async () => {
      const waitMs = 50 - (Date.now() - this.#lastWriteStartedAt);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          completed = await this.#sendAndWait(method, params);
          return;
        } catch (error) {
          if (!/timed out/i.test(error.message) || attempt === 1) throw error;
        }
      }
    });
    this.#writeTail = operation.catch(() => {
    });
    await operation;
    return completed;
  }
  async #sendAndWait(method, params) {
    if (this.#closed) throw new Error("Codex Micro is closed.");
    let requestId = randomInt(0, 999);
    while (this.#pending.has(requestId)) requestId = randomInt(0, 999);
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`${method} timed out after 10000ms`));
      }, 1e4);
      this.#pending.set(requestId, { resolve, reject, timer });
    });
    this.#lastWriteStartedAt = Date.now();
    try {
      for (const packet of encodeRequestPackets({ method, params, id: requestId })) {
        await this.#device.write(Buffer.from(packet));
      }
    } catch (error) {
      const pending = this.#pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(requestId);
        pending.reject(error);
      }
    }
    return { id: requestId, result: await response };
  }
  async close() {
    this.#closed = true;
    this.#failPending(new Error("Codex Micro closed."));
    await this.#device.close();
  }
  onInput(listener) {
    this.#inputListeners.add(listener);
  }
  #failPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
};

export {
  RpcMethod,
  RpcMessageStream,
  LightingEffect,
  AGENT_KEY_COUNT,
  assertAgentKeyIndex,
  encodeAgentKeyLighting,
  encodeLightingChannel,
  parseDeviceEvent,
  firmwareVersionRequest,
  agentKeyStatusRequest,
  lightingConfigRequest,
  encodeRequestPackets,
  transportForDescriptor,
  modelForDescriptor,
  findCodexMicros,
  CodexMicro
};
