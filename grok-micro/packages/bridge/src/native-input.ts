export type NativeAction =
  | "thread.select"
  | "app.focus"
  | "composer.toggleFastMode"
  | "approval.approve"
  | "approval.decline"
  | "thread.fork"
  | "voice.pushToTalk.start"
  | "voice.pushToTalk.stop"
  | "voice.pushToTalk.latch"
  | "composer.submit"
  | "composer.previous"
  | "composer.next"
  | "composer.activate"
  | "reasoning.decrease"
  | "reasoning.increase"
  | "reasoning.options"
  | "conversation.scrollUp"
  | "conversation.scrollDown"
  | "conversation.scrollBottom"
  | "settings.codexMicro"
  | "composer.togglePlanMode"
  | "navigation.forward"
  | "sidebar.toggle"
  | "navigation.back";

export type EncoderMode = "composer-navigation" | "reasoning" | "conversation-scroll" | "custom";
export type JoystickDirection = "up" | "right" | "down" | "left";

export interface ActionEmission {
  action: NativeAction;
  slot?: number;
  sessionId?: string;
  phase?: "press" | "release" | "latch";
}

export interface NativeInputOptions {
  now?: () => number;
  encoderMode?: EncoderMode;
  agentDoubleTapMs?: number;
  micTapMs?: number;
  holdMs?: number;
  singleTapFocus?: boolean;
  encoderCustom?: Partial<Record<"left" | "right" | "click" | "longPress", NativeAction | null>>;
}

/** Pure state machine matching the factory Codex Micro gestures. */
export class NativeInputInterpreter {
  #now: () => number;
  #encoderMode: EncoderMode;
  #agentDoubleTapMs: number;
  #micTapMs: number;
  #holdMs: number;
  #singleTapFocus: boolean;
  #encoderCustom: NonNullable<NativeInputOptions["encoderCustom"]>;
  #lastAgent: { slot: number; sessionId: string; at: number } | null = null;
  #encoderDownAt: number | null = null;
  #encoderHoldFired = false;
  #micDownAt: number | null = null;
  #micPendingUntil: number | null = null;
  #micLatched = false;
  #micSuppressUntil = 0;
  #joystickDirection: JoystickDirection | null = null;

  constructor({
    now = Date.now,
    encoderMode = "composer-navigation",
    agentDoubleTapMs = 350,
    micTapMs = 350,
    holdMs = 500,
    singleTapFocus = false,
    encoderCustom = {},
  }: NativeInputOptions = {}) {
    this.#now = now;
    this.#encoderMode = encoderMode;
    this.#agentDoubleTapMs = agentDoubleTapMs;
    this.#micTapMs = micTapMs;
    this.#holdMs = holdMs;
    this.#singleTapFocus = singleTapFocus;
    this.#encoderCustom = encoderCustom;
  }

  key(keyName: string, actionCode: number, assignedSessionId = ""): ActionEmission[] {
    const now = this.#now();
    const agent = /^AG0([0-5])$/.exec(keyName);
    if (agent && actionCode === 1) {
      const slot = Number(agent[1]);
      const doubleTap = this.#lastAgent?.slot === slot
        && this.#lastAgent.sessionId === assignedSessionId
        && now - this.#lastAgent.at <= this.#agentDoubleTapMs;
      this.#lastAgent = doubleTap ? null : { slot, sessionId: assignedSessionId, at: now };
      const actions: ActionEmission[] = [{ action: "thread.select", slot, sessionId: assignedSessionId }];
      if (this.#singleTapFocus || doubleTap) actions.push({ action: "app.focus", slot, sessionId: assignedSessionId });
      return actions;
    }
    if (keyName === "ENC_CW" && actionCode === 2) {
      const action = this.#encoderAction(-1);
      return action ? [{ action }] : [];
    }
    if (keyName === "ENC_CC" && actionCode === 2) {
      const action = this.#encoderAction(1);
      return action ? [{ action }] : [];
    }
    if (keyName === "ENC_CLK") {
      if (actionCode === 1) {
        this.#encoderDownAt = now;
        this.#encoderHoldFired = false;
      }
      if (actionCode === 0 && this.#encoderDownAt !== null) {
        this.#encoderDownAt = null;
        if (this.#encoderHoldFired) return [];
        const action = this.#encoderClickAction();
        return action ? [{ action }] : [];
      }
      return [];
    }
    if (keyName === "ACT10") return this.#microphone(actionCode, now);
    // ACT11 is the ignored second switch beneath the same wide MIC keycap.
    if (keyName === "ACT11") return [];
    if (actionCode !== 1) return [];
    const actions: Readonly<Record<string, NativeAction>> = Object.freeze({
      ACT06: "composer.toggleFastMode",
      ACT07: "approval.approve",
      ACT08: "approval.decline",
      ACT09: "thread.fork",
      ACT12: "composer.submit",
    });
    const action = actions[keyName];
    return action ? [{ action }] : [];
  }

  joystick(angle: number, distance: number): ActionEmission[] {
    if (!Number.isFinite(angle) || !Number.isFinite(distance)) return [];
    if (distance < 0.5) {
      this.#joystickDirection = null;
      return [];
    }
    const normalized = ((angle % 1) + 1) % 1;
    const direction: JoystickDirection = normalized >= 0.625 && normalized < 0.875
      ? "up"
      : normalized >= 0.125 && normalized < 0.375
        ? "down"
        : normalized >= 0.375 && normalized < 0.625
          ? "left"
          : "right";
    if (direction === this.#joystickDirection) return [];
    this.#joystickDirection = direction;
    const action: Record<JoystickDirection, NativeAction> = {
      up: "composer.togglePlanMode",
      right: "navigation.forward",
      down: "sidebar.toggle",
      left: "navigation.back",
    };
    return [{ action: action[direction] }];
  }

  tick(): ActionEmission[] {
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

  reset(): void {
    this.#lastAgent = null;
    this.#encoderDownAt = null;
    this.#encoderHoldFired = false;
    this.#micDownAt = null;
    this.#micPendingUntil = null;
    this.#micLatched = false;
    this.#micSuppressUntil = 0;
    this.#joystickDirection = null;
  }

  #encoderAction(direction: -1 | 1): NativeAction | null {
    if (this.#encoderMode === "custom") return direction < 0 ? this.#encoderCustom.left ?? null : this.#encoderCustom.right ?? null;
    if (this.#encoderMode === "reasoning") return direction < 0 ? "reasoning.decrease" : "reasoning.increase";
    if (this.#encoderMode === "conversation-scroll") return direction < 0 ? "conversation.scrollUp" : "conversation.scrollDown";
    return direction < 0 ? "composer.previous" : "composer.next";
  }

  #encoderClickAction(): NativeAction | null {
    if (this.#encoderMode === "custom") return this.#encoderCustom.click ?? null;
    if (this.#encoderMode === "reasoning") return "reasoning.options";
    if (this.#encoderMode === "conversation-scroll") return "conversation.scrollBottom";
    return "composer.activate";
  }

  #microphone(actionCode: number, now: number): ActionEmission[] {
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
}
