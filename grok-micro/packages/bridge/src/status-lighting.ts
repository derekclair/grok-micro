import {
  LightingEffect,
  encodeAgentKeyLighting,
  encodeLightingChannel,
  type AgentKeyLightingWire,
  type LightingChannelWire,
} from "codex-micro-protocol";
import type { GrokSession, GrokSessionState } from "./state";

export interface FactoryStyle {
  color: number;
  effect: number;
  speed: number;
}

export const FACTORY_COLORS: Readonly<Record<GrokSessionState, number>> = Object.freeze({
  off: 0x000000,
  idle: 0xffffff,
  working: 0x304ffe,
  unread: 0x00ff4c,
  "awaiting-approval": 0xff6d00,
  "awaiting-response": 0xff6d00,
  error: 0xff0033,
});

export const VOICE_COLORS = Object.freeze({
  recording: 0x2e8b57,
  processing: 0xffffff,
  completed: 0xffffff,
});

export function sessionForLighting(session: GrokSession | null, appFocused: boolean): GrokSession | null {
  return session?.selected && session.state === "unread" && appFocused ? { ...session, state: "idle" } : session;
}

export function agentKeyLighting(
  agentKeyIndex: number,
  session: GrokSession | null,
  brightness = 1,
): AgentKeyLightingWire {
  if (!session || session.state === "off" || brightness <= 0) {
    return encodeAgentKeyLighting({
      agentKeyIndex: agentKeyIndex as 0 | 1 | 2 | 3 | 4 | 5,
      color: 0,
      brightness: 0,
      effect: LightingEffect.off,
      speed: 0,
      syncKeysLighting: false,
      syncAmbientLighting: false,
    });
  }
  const animated = session.selected || session.pulsing;
  return encodeAgentKeyLighting({
    agentKeyIndex: agentKeyIndex as 0 | 1 | 2 | 3 | 4 | 5,
    color: FACTORY_COLORS[session.state],
    brightness,
    effect: animated ? LightingEffect.breath : LightingEffect.solid,
    speed: animated ? 0.4 : 0,
    syncKeysLighting: false,
    syncAmbientLighting: false,
  });
}

function channel(color: number, brightness: number, effect: number, speed: number): LightingChannelWire {
  return encodeLightingChannel({ color, brightness, effect: effect as 0 | 1 | 2 | 3 | 4 | 5 | 6, speed, mode: 0 });
}

export type VoiceState = "recording" | "processing" | "completed" | null;

export function boardLighting(
  selected: GrokSession | null,
  { brightness = 1, selectionFlash = false, voice = null, snakingAmbientStatus = null, dimmed = false }: {
    brightness?: number;
    selectionFlash?: boolean;
    voice?: VoiceState;
    snakingAmbientStatus?: GrokSessionState | null;
    dimmed?: boolean;
  } = {},
): { ambient: LightingChannelWire; keys: LightingChannelWire } {
  const off = channel(0, 0, LightingEffect.off, 0);
  if (dimmed) return { ambient: off, keys: off };
  if (snakingAmbientStatus) {
    return { ambient: channel(FACTORY_COLORS[snakingAmbientStatus], brightness, LightingEffect.snake, 0.4), keys: off };
  }
  if (voice) {
    const effect = voice === "completed" ? LightingEffect.solid : LightingEffect.snake;
    return {
      ambient: channel(VOICE_COLORS[voice], brightness, effect, voice === "completed" ? 0 : 0.4),
      keys: channel(VOICE_COLORS[voice], brightness, LightingEffect.solid, 0),
    };
  }
  if (selectionFlash && selected) {
    const selectedChannel = channel(FACTORY_COLORS[selected.state], brightness, LightingEffect.solid, 0);
    const ambient = selected.state === "working"
      ? channel(FACTORY_COLORS.working, brightness, LightingEffect.snake, 0.4)
      : selectedChannel;
    return { ambient, keys: selectedChannel };
  }
  if (selected?.state === "working") {
    return { ambient: channel(FACTORY_COLORS.working, brightness, LightingEffect.snake, 0.4), keys: off };
  }
  return { ambient: off, keys: off };
}
