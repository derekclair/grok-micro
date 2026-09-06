/**
 * Voice PTT action handler contract for Grok CLI interactive sessions.
 *
 * When the Codex Micro MIC key (ACT10) is pressed, the daemon emits one of:
 *   voice.pushToTalk.start   → user began holding the key
 *   voice.pushToTalk.latch   → quick double-tap → latched recording mode
 *   voice.pushToTalk.stop    → release (or second press while latched)
 *
 * The handler below is the integration point. It should:
 * 1. Open/focus the composer input area.
 * 2. Signal to the OS or a local STT provider that voice capture should begin.
 * 3. On stop/latch-release, transcribe and submit the prompt (or cancel).
 *
 * This file is a reference stub; wire it into the interactive action handler
 * registered via LocalControlServer.setActionHandler().
 */

import type { ControlAction } from "./types";

export type VoiceState = "idle" | "listening" | "processing";

export interface VoicePTTContext {
  focusComposer(): void;
  beginListening(): Promise<void>;
  stopListeningAndSubmit(): Promise<void>;
  cancelListening(): void;
  setVoiceState(state: VoiceState): void;
}

export async function handleVoicePTT(
  action: ControlAction,
  ctx: VoicePTTContext,
  currentState: VoiceState,
): Promise<void> {
  if (action.type === "voice.pushToTalk.start") {
    if (currentState !== "idle") return;
    ctx.focusComposer();
    ctx.setVoiceState("listening");
    await ctx.beginListening();
    return;
  }

  if (action.type === "voice.pushToTalk.latch") {
    if (currentState === "listening") {
      // Already listening → latch means keep recording until explicit stop
      return;
    }
    ctx.focusComposer();
    ctx.setVoiceState("listening");
    await ctx.beginListening();
    return;
  }

  if (action.type === "voice.pushToTalk.stop") {
    if (currentState === "listening") {
      ctx.setVoiceState("processing");
      await ctx.stopListeningAndSubmit();
      ctx.setVoiceState("idle");
    } else {
      ctx.cancelListening();
      ctx.setVoiceState("idle");
    }
  }
}
