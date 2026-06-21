/** Domain-neutral compact-duration bucketing. The one coarse-magnitude ladder
 *  shared by every compact-duration formatter in the app — terminal staleness
 *  (`formatDuration`, `formatTimeAgo`), the right-panel "Running for" readout,
 *  and the kaval daemon uptime (`formatUptime`). It lives here, not in any one
 *  domain's module, so neither domain imports the other just to format a delta.
 *
 *  Returns the dominant `{value, unit}` and — for the hour/day tiers — the
 *  next-finer `sub` unit, so a caller can render either a single unit (`2h`) or
 *  two (`2h 20m`) without re-walking the ladder. The sec<60 / min<60 / hr<24 /
 *  else thresholds and the negative-clamp (clock skew between an agent host and
 *  the client must never render a negative age) live here and nowhere else. */
export type DeltaUnit = "s" | "m" | "h" | "d";

export function compactDelta(ms: number): {
  value: number;
  unit: DeltaUnit;
  sub?: { value: number; unit: DeltaUnit };
} {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return { value: sec, unit: "s" };
  const min = Math.floor(sec / 60);
  if (min < 60) return { value: min, unit: "m" };
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return { value: hr, unit: "h", sub: { value: min % 60, unit: "m" } };
  }
  return {
    value: Math.floor(hr / 24),
    unit: "d",
    sub: { value: hr % 24, unit: "h" },
  };
}
