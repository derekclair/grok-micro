export type DeviceStatus = "not-detected" | "detected" | "connected" | "error";
export type DeviceErrorCode = "discovery-failed" | "connection-failed" | "transport-unavailable";
export type LifecycleTransition = "connected" | "connection-failed" | "connection-lost" | "reconnected";

export interface PublicDeviceState {
  status: DeviceStatus;
  transport: "usb" | "bluetooth" | "unknown";
  model: "codex-micro" | "creator-micro-v2" | null;
  error: DeviceErrorCode | null;
  battery: { percentage: number; isCharging: boolean } | null;
  // Compatibility/diagnostic fields retained beside the native public shape.
  detected: boolean;
  connected: boolean;
  errorMessage: string | null;
  firmware: string | null;
}

export const INITIAL_DEVICE_STATE: PublicDeviceState = Object.freeze({
  status: "not-detected",
  transport: "unknown",
  model: null,
  error: null,
  battery: null,
  detected: false,
  connected: false,
  errorMessage: null,
  firmware: null,
});

export function failureCode(discoveryFailed: boolean, hasConnected: boolean): DeviceErrorCode {
  return discoveryFailed ? "discovery-failed" : hasConnected ? "transport-unavailable" : "connection-failed";
}

export function connectedTransition(hasConnected: boolean): LifecycleTransition {
  return hasConnected ? "reconnected" : "connected";
}

export function failedTransition(hasConnected: boolean): LifecycleTransition {
  return hasConnected ? "connection-lost" : "connection-failed";
}
