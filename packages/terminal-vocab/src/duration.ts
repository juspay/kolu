import { DASH } from "./dash.ts";

export type DeltaUnit = "s" | "m" | "h" | "d";

export type CompactDelta =
  | { kind: "unknown" }
  | {
      kind: "delta";
      value: number;
      unit: DeltaUnit;
      sub?: { value: number; unit: DeltaUnit };
    };

/** The dominant `{value, unit}` of a millisecond delta and — for the hour/day
 *  tiers — the next-finer `sub` unit, so a caller can render either a single
 *  unit (`2h`) or two (`2h 20m`) without re-walking the ladder. The thresholds
 *  and the untrustworthy-delta policy live here and nowhere else. */
export function compactDelta(ms: number): CompactDelta {
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

/** A compact forward DURATION: "12s" / "5m" / "2h" / "3d". Single-unit and
 *  coarse — only the dominant tier of the ladder. An untrustworthy delta renders
 *  as the dash. */
export function compactPhrase(ms: number): string {
  const d = compactDelta(ms);
  if (d.kind === "unknown") return DASH;
  return `${d.value}${d.unit}`;
}

/** A compact DUAL-unit duration: "45s" / "2m" / "2h 20m" / "3d 5h" — the
 *  dominant tier plus the ladder's next-finer `sub` where the tier HAS one, and
 *  the single unit where it does not. */
export function dualPhrase(ms: number): string {
  return dualOf(compactDelta(ms));
}

/** …and the same rendering over a delta ALREADY WALKED. */
export function dualOf(d: CompactDelta): string {
  if (d.kind === "unknown") return DASH;
  return d.sub
    ? `${d.value}${d.unit} ${d.sub.value}${d.sub.unit}`
    : `${d.value}${d.unit}`;
}

/** A compact AGE: "5m ago" / "2h ago" / "3d ago", "just now" under a minute.
 *
 *  `null` — the honest never-observed reading, never an in-band `0` — renders as
 *  the EMPTY STRING rather than the dash; the dash means "there is a reading and
 *  it is not trustworthy". */
export function agoPhrase(at: number | null, now: number): string {
  if (at === null) return "";
  const d = compactDelta(now - at);
  if (d.kind === "unknown") return DASH;
  if (d.unit === "s") return "just now";
  return `${d.value}${d.unit} ago`;
}
