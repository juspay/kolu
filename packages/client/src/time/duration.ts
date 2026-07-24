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
 *  the client must never render a negative age) live here and nowhere else.
 *
 *  One deliberate exception: a twin of this ladder lives in
 *  `packages/vazhi/src/format.ts` — vazhi may not import the client bundle.
 *  Keep the thresholds in step. */
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

/** A compact elapsed readout for a LIVE, seconds-granularity timer — `"45s"` under a
 *  minute, `"2m 3s"` above (dual-unit so a minutes-long connect still shows its seconds
 *  ticking). Built on the {@link compactDelta} ladder's sec/min bucketing so the
 *  thresholds live in ONE place — the connect overlay's elapsed timer reads this rather
 *  than hand-rolling `Math.floor(secs/60)` in a domain module. Distinct from the
 *  hours-scale single-unit `formatDuration`/`formatUptime` (which want `2h`, not `2h 3s`)
 *  precisely because a live connect timer wants its seconds visible. */
export function formatElapsedShort(ms: number): string {
  const d = compactDelta(ms);
  if (d.unit === "s") return `${d.value}s`;
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${d.value}${d.unit} ${sec % 60}s`;
}
