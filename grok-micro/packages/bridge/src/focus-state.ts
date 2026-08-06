import type { ControlRoute } from "./state";

export function routeIdentity(route: ControlRoute): string {
  return `${route.pid ?? ""}\0${route.socketPath}\0${route.terminal?.tmuxPane ?? ""}\0${route.terminal?.tty ?? ""}`;
}

export function focusAfterBackgroundSelection(
  appFocused: boolean,
  focusedIdentity: string | null,
  targetIdentity: string,
): boolean {
  return appFocused && focusedIdentity !== null && focusedIdentity === targetIdentity;
}
