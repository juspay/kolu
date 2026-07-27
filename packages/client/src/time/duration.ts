/** Domain-neutral compact-duration bucketing. The one coarse-magnitude ladder
 *  shared by every compact-duration formatter in the app — terminal staleness
 *  (`formatDuration`, `formatTimeAgo`), the right-panel "Running for" readout,
 *  and the kaval daemon uptime (`formatUptime`). It lives here, not in any one
 *  domain's module, so neither domain imports the other just to format a delta.
 *
 *  Returns the dominant `{value, unit}` and — for the hour/day tiers — the
 *  next-finer `sub` unit, so a caller can render either a single unit (`2h`) or
 *  two (`2h 20m`) without re-walking the ladder. The sec<60 / min<60 / hr<24 /
 *  else thresholds and the untrustworthy-delta policy live here and nowhere
 *  else.
 *
 *  That policy is a `kind: "unknown"` arm, not a clamp to zero. The timestamps
 *  these deltas are measured from are stamped by the host a terminal runs on
 *  and subtracted from the browser's clock, so a remote host running slightly
 *  ahead puts its events in this clock's future: the reading is provably wrong
 *  and the honest answer is that we do not know. A caller renders its own
 *  empty for it (a dash, mostly). As a clamp it read `0s` / `just now`, and a
 *  formatter that disagreed had to guard on its own — which is how one row
 *  ended up with a wait chip saying "—" beside a timestamp saying "just now",
 *  under the same skewed clock, in the same 8ch track. Returning a value no
 *  caller can render as a number is what makes that unspellable.
 *
 *  One deliberate exception: a twin of this ladder lives in
 *  `packages/vazhi/src/format.ts` — vazhi may not import the client bundle.
 *  Keep the thresholds in step. */
import { DASH } from "kolu-common/surface";

export type DeltaUnit = "s" | "m" | "h" | "d";

export type CompactDelta =
  | { kind: "unknown" }
  | {
      kind: "delta";
      value: number;
      unit: DeltaUnit;
      sub?: { value: number; unit: DeltaUnit };
    };

export function compactDelta(ms: number): CompactDelta {
  // An event cannot have happened later than now — this delta is skew, not age.
  if (ms < 0) return { kind: "unknown" };
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return { kind: "delta", value: sec, unit: "s" };
  const min = Math.floor(sec / 60);
  if (min < 60) return { kind: "delta", value: min, unit: "m" };
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return {
      kind: "delta",
      value: hr,
      unit: "h",
      sub: { value: min % 60, unit: "m" },
    };
  }
  return {
    kind: "delta",
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
  if (d.kind === "unknown") return DASH;
  if (d.unit === "s") return `${d.value}s`;
  const sec = Math.floor(ms / 1000);
  return `${d.value}${d.unit} ${sec % 60}s`;
}
