export const CONTROL_PROTOCOL_VERSION = 1 as const;

export type ControlErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "unsupported_version"
  | "unsupported"
  | "unavailable"
  | "not_pending"
  | "not_active"
  | "busy"
  | "internal_error";

export class ControlActionError extends Error {
  constructor(
    readonly code: ControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ControlActionError";
  }
}

export type SupportedControlAction =
  | { type: "composer.submit" }
  | { type: "turn.interrupt" }
  | { type: "mode.cycle" }
  | { type: "composer.togglePlanMode" }
  | { type: "approval.respond"; decision: "approve" | "decline" }
  | { type: "session.new" }
  | { type: "thread.select"; sessionId: string }
  | { type: "thread.fork" }
  | { type: "reasoning.adjust"; direction: "increase" | "decrease" }
  | { type: "conversation.scroll"; direction: "up" | "down" | "bottom" }
  | { type: "voice.pushToTalk.start" }
  | { type: "voice.pushToTalk.stop" }
  | { type: "voice.pushToTalk.latch" };

/** Native Micro concepts that Grok does not currently implement exactly. */
export type UnsupportedNativeControlAction =
  | { type: "composer.toggleFastMode" }
  | { type: "navigate"; direction?: "back" | "forward" }
  | { type: "sidebar.toggle" }
  | { type: "settings.open"; section?: string };

export type ControlAction = SupportedControlAction | UnsupportedNativeControlAction;

export interface ControlSessionSummary {
  id: string;
  title: string | null;
  mode: string;
  updatedAt: string;
}

export interface ControlTerminalMetadata {
  termProgram: string | null;
  tmuxPane: string | null;
  tty: string | null;
}

export type ControlEvent =
  | { type: "session.opened"; sessionId: string; cwd: string; mode: string }
  | { type: "session.closed"; sessionId: string; reason: string }
  | { type: "session.changed"; previousSessionId: string; sessionId: string; cwd: string }
  | {
      type: "session.catalog";
      sessionId: string;
      sessions: ControlSessionSummary[];
    }
  | { type: "mode.changed"; sessionId: string; mode: string }
  | { type: "turn.started"; sessionId: string }
  | { type: "turn.completed"; sessionId: string; outcome: "completed" | "interrupted" | "failed" }
  | { type: "tool.started"; sessionId: string; toolName: string; toolCallId: string }
  | { type: "tool.finished"; sessionId: string; toolName: string; toolCallId: string; success: boolean }
  | { type: "input.requested"; sessionId: string; kind: "approval" | "response" }
  | { type: "input.resolved"; sessionId: string; kind: "approval"; decision: "approve" | "decline" }
  | { type: "input.resolved"; sessionId: string; kind: "response" };

export interface AuthenticateMessage {
  version: typeof CONTROL_PROTOCOL_VERSION;
  type: "authenticate";
  token: string;
}

export interface ActionMessage {
  version: typeof CONTROL_PROTOCOL_VERSION;
  type: "action";
  id: string;
  action: ControlAction;
}

export type ClientMessage = AuthenticateMessage | ActionMessage;

export interface ControlRegistration {
  protocolVersion: typeof CONTROL_PROTOCOL_VERSION;
  pid: number;
  sessionId: string;
  cwd: string;
  socketPath: string;
  token: string;
  createdAt: string;
  sessions: ControlSessionSummary[];
  terminal: ControlTerminalMetadata;
}

export type ServerMessage =
  | {
      version: typeof CONTROL_PROTOCOL_VERSION;
      type: "ready";
      pid: number;
      sessionId: string;
      cwd: string;
    }
  | { version: typeof CONTROL_PROTOCOL_VERSION; type: "event"; seq: number; event: ControlEvent }
  | { version: typeof CONTROL_PROTOCOL_VERSION; type: "result"; id: string; ok: true; data?: unknown }
  | {
      version: typeof CONTROL_PROTOCOL_VERSION;
      type: "result";
      id: string;
      ok: false;
      error: { code: ControlErrorCode; message: string };
    }
  | {
      version: typeof CONTROL_PROTOCOL_VERSION;
      type: "protocol_error";
      error: { code: ControlErrorCode; message: string };
    };

export type ControlActionHandler = (action: ControlAction) => unknown | Promise<unknown>;
