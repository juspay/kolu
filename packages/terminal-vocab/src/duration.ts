/** **The compact-duration LADDER, and the two phrases every kolu surface says
 *  with it.**
 *
 *  One coarse-magnitude ladder — sec<60 / min<60 / hr<24 / else — plus the
 *  untrustworthy-delta policy, plus the two sentences kolu renders over them:
 *  "5m ago" for an age, "45s" for a live duration, "2h 20m" for a dual-unit one.
 *  Every compact-duration
 *  readout in the product is one of these: terminal staleness, the Dock row's
 *  recency cell and its wait chip, the right-panel "Running for", the kaval
 *  daemon uptime, the connect overlay's elapsed timer.
 *
 *  **Why it moved out of the client.** The phrases were app-only, and a package
 *  that renders kolu's Dock row could not say them — so the first consumer to
 *  render that row wrote its own, and diverged in both modes at once: "7m" where
 *  the Dock says "5m ago", and the empty string where the wait chip must say the
 *  dash. There were THREE ladders in this tree with these exact thresholds and
 *  three different skew policies; a fourth, in a consumer, is what "compose
 *  rather than re-derive" exists to prevent.
 *
 *  This is now the only one of the three that WALKS it. `relativeTime`, one
 *  file over, folds onto {@link compactPhrase} and keeps only its own
 *  never-observed sentinel. `kaval-tui`'s copy stays, argued rather than
 *  forgotten: that package's manifest sits BELOW padi and names neither this
 *  package nor `@kolu/padi-client`, so reaching for this ladder would point its
 *  dependency arrow up.
 *
 *  **Why HERE and not a new leaf.** Both readers — kolu's client and
 *  `@kolu/solid-dockrow` — already declare `@kolu/terminal-vocab`, so this costs
 *  neither of them a manifest edge, a workspace entry, or a closure
 *  regeneration. It also lands beside `DASH`, which every arm below
 *  returns, and beside `relativeTime` — which now reads this ladder rather than
 *  walking its own.
 *
 *  It is domain-NEUTRAL code in a terminal-vocabulary package, and that tension
 *  is real. It is resolved by what the tree already does rather than by taste:
 *  every one of these formatters returns `DASH`, and `DASH` lives here, so each
 *  of them already reaches this package to spell its empty state.
 *
 *  **The untrustworthy-delta policy is a `kind: "unknown"` arm, not a clamp to
 *  zero.** The timestamps these deltas are measured from are stamped by the host
 *  a terminal runs on and subtracted from the browser's clock, so a remote host
 *  running slightly ahead puts its events in this clock's future: the reading is
 *  provably wrong and the honest answer is that we do not know. As a clamp it
 *  read `0s` / `just now`, and a formatter that disagreed had to guard on its
 *  own — which is how one row ended up with a wait chip saying "—" beside a
 *  timestamp saying "just now", under the same skewed clock, in the same 8ch
 *  track. Returning a value no caller can render as a number is what makes that
 *  unspellable.
 *
 *  Nothing here reads a clock. `now` is always a parameter, because a ticking
 *  `now` is ambient app state whose cadence the consuming app owns — kolu runs a
 *  1 s tick for the wait chip and a plain `Date.now()` read for "3m ago",
 *  deliberately different subscriptions. */

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

/** A compact forward DURATION: "12s" / "5m" / "2h" / "3d". Single-unit and
 *  coarse — only the dominant tier of the ladder. An untrustworthy delta renders
 *  as the dash; the policy is the ladder's, not this formatter's, because as a
 *  local guard it contradicted the clamp applied for every OTHER formatter and
 *  the two answers appeared side by side in the same dock row. */
export function compactPhrase(ms: number): string {
  const d = compactDelta(ms);
  if (d.kind === "unknown") return DASH;
  return `${d.value}${d.unit}`;
}

/** A compact DUAL-unit duration: "45s" / "2m" / "2h 20m" / "3d 5h" — the
 *  dominant tier plus the ladder's next-finer `sub` where the tier HAS one, and
 *  the single unit where it does not.
 *
 *  This is the rendering `compactDelta`'s `sub` exists for, and it was spelled
 *  identically in two client formatters — the connect overlay's elapsed timer and
 *  the kaval daemon's uptime — which is one rule in two places.
 *
 *  The only thing those two genuinely disagree about is the WORD for a delta
 *  that cannot be trusted, and that substitution is made at the DISAGREEING CALL
 *  SITE rather than taken as a parameter here: `formatUptime` says "unknown"
 *  because a daemon presence has a vocabulary for it, exactly as `recencyText`
 *  supplies the wait chip's dash. A defaulted word parameter would be a knob —
 *  the second caller wanting a third word gets it free, and the vocabulary stops
 *  being kolu's. Everything here gets the ladder's own dash. */
export function dualPhrase(ms: number): string {
  return dualOf(compactDelta(ms));
}

/** …and the same rendering over a delta ALREADY WALKED.
 *
 *  Two callers hold a `CompactDelta` before they know they want this: one
 *  branches on `kind === "unknown"` to say its own word for an untrustworthy
 *  delta, the other on the minute tier to show live seconds. Handing them
 *  {@link dualPhrase} made each walk the ladder a SECOND time and throw the
 *  first walk away — in the module whose whole premise is that the ladder is
 *  walked once, in one place.
 *
 *  Not a knob and not a second rendering: it is this rendering at the level the
 *  caller is already at, the same shape {@link compactPhrase} and
 *  {@link agoPhrase} would take if anyone needed them pre-walked. */
export function dualOf(d: CompactDelta): string {
  if (d.kind === "unknown") return DASH;
  return d.sub
    ? `${d.value}${d.unit} ${d.sub.value}${d.sub.unit}`
    : `${d.value}${d.unit}`;
}

/** A compact AGE: "5m ago" / "2h ago" / "3d ago", "just now" under a minute.
 *
 *  `null` — the honest never-observed reading, never an in-band `0` — renders as
 *  the EMPTY STRING rather than the dash, and the difference is load-bearing:
 *  "there has never been activity here" is a row with nothing to say, while the
 *  dash means "there is a reading and it is not trustworthy". A caller whose slot
 *  cannot render empty (the wait chip is a violet capsule, and a capsule with no
 *  glyph reads as a rendering bug rather than as "unknown") substitutes the dash
 *  itself, because that is its rendering's rule and not this phrase's. */
export function agoPhrase(at: number | null, now: number): string {
  if (at === null) return "";
  const d = compactDelta(now - at);
  // The same skew answer the wait chip beside it gives — the two share a row.
  if (d.kind === "unknown") return DASH;
  if (d.unit === "s") return "just now";
  return `${d.value}${d.unit} ago`;
}
