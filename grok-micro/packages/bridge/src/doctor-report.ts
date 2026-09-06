/** Snapshot written by the daemon to GROK_MICRO_HEALTH. Presence is not liveness. */
export interface HealthSnapshot {
  state?: string;
  updatedAt?: string;
  pid?: number;
}

export interface SocketProbe {
  state?: string;
}

export interface DaemonHealthReport {
  ok: boolean;
  detail: string;
}

/**
 * A leftover health JSON is not a live daemon. Only a successful socket probe
 * counts as healthy; an on-disk snapshot from a previous run is reported as stale.
 */
export function describeDaemonHealth(
  health: HealthSnapshot | null,
  probe: SocketProbe | null,
): DaemonHealthReport {
  if (probe) {
    const state = probe.state ?? health?.state ?? "running";
    return { ok: true, detail: health?.updatedAt ? `${state} at ${health.updatedAt}` : state };
  }
  if (!health) return { ok: false, detail: "not started" };
  const when = health.updatedAt ?? "unknown time";
  if (health.state === "stopped") {
    return { ok: false, detail: `stopped at ${when} — run pnpm start` };
  }
  return {
    ok: false,
    detail: `stale ${health.state ?? "unknown"} snapshot at ${when} — daemon not running`,
  };
}
