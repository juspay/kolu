/** The bound host's "Running daemons" scan liveness, as a DISCRIMINATED CAUSE — not a
 *  bare `live` boolean. A boolean can only say "not live", so the section's copy had to
 *  GUESS the reason ("padi is connecting, or … too old to report") and had NO arm for a
 *  hard host failure — over an ssh-unreachable host it read "connecting" while the real
 *  state was `failed` (attempt 11), #1793.
 *
 *  {@link daemonScanCause} is a TOTAL fold over the host's typed {@link PadiEntry}
 *  (the four `EntryState` kinds) × whether a real inventory frame has landed, so a new
 *  entry kind is a compile-forced arm here, and a `failed` host threads its typed
 *  {@link EntryFailedCause} straight through to per-cause copy — reusing the SAME
 *  {@link HOST_DOWN_COPY} titles the Skew-UX host-down card shows, never a parallel
 *  hand-rolled string (the repo's "reuse the existing source of truth" rule). */

import type { EntryState } from "@kolu/surface-map";
import type {
  ConnectionInfo,
  EntryFailedCause,
  PadiEntryFailure,
} from "kolu-common/surfacesWithPadi";
import { match } from "ts-pattern";
import { HOST_DOWN_COPY } from "./hostDownCopy";

/** The active host's typed padi entry state — the discriminated `(connected | warming |
 *  failed | not-a-member)` value `padiMap.entry(host).state()` returns. */
export type PadiEntry = EntryState<PadiEntryFailure, ConnectionInfo>;

/** Why the bound host's daemon scan is (not) a trustworthy live reading. `live` → the
 *  section renders its rows; every other arm is an honest "unavailable" cause, so the
 *  copy is a total function of WHY rather than a single guessed sentence. */
export type DaemonScan =
  | { kind: "live" }
  /** The bind is (re)establishing — genuinely transient. Covers a `warming` entry AND a
   *  `connected` entry whose bind is not live (the browser↔server transport dropped, so the
   *  re-served reading is stale): both are "the link isn't live right now", NOT "too old". */
  | { kind: "connecting" }
  /** Live bind, but no fresh scan frame — a `connected` entry over a LIVE bind that has not
   *  reported an inventory frame: its padi predates the `hostInventory` member (never
   *  reports) OR has not delivered its first frame yet. Honestly "hasn't reported", never a
   *  guessed "too old" (the dead-transport case folds to `connecting`, not here). */
  | { kind: "no-frame" }
  /** The host BINDING itself failed (ssh dial / handshake / contract fault), cause-typed
   *  — the arm the boolean could not express. Carries the {@link EntryFailedCause} so the
   *  copy names the real reason. */
  | { kind: "failed"; cause: EntryFailedCause }
  /** The active host is not a padi-map member — no bound padi to scan at all. */
  | { kind: "no-host" };

/** Fold the host's typed entry state (+ whether a real inventory frame has landed) into
 *  the honest {@link DaemonScan} cause. TOTAL over the four `EntryState` kinds via
 *  `.exhaustive()`, so a future entry kind can't silently fall through to a misleading
 *  reason. `bindLive` is the canonical bind-liveness fact (browser transport ∧ the active
 *  entry's own connection, `daemonChannelLive`). It refines the `connected` arm into three
 *  HONEST causes — never one guessed "too old": a dead bind is `connecting` (the transport
 *  dropped, reading stale), a live bind with no frame is `no-frame` (old / first frame
 *  pending), and only a live bind WITH a frame is `live`. The `failed`/`warming` causes
 *  stand on the entry's own kind. */
export function daemonScanCause(
  entry: PadiEntry,
  { bindLive, framePresent }: { bindLive: boolean; framePresent: boolean },
): DaemonScan {
  return match(entry)
    .with({ kind: "connected" }, () => {
      // A `connected` entry whose bind is not live means the browser↔server transport
      // dropped (connected ⟹ the entry leg is up, so `bindLive` tracks the transport) —
      // the reading is stale and re-establishing, honestly `connecting`, NOT "too old".
      if (!bindLive) return { kind: "connecting" } as const;
      // Live bind, but no self-padi frame yet: old padi or first-frame pending.
      if (!framePresent) return { kind: "no-frame" } as const;
      return { kind: "live" } as const;
    })
    .with({ kind: "warming" }, () => ({ kind: "connecting" }) as const)
    .with(
      { kind: "failed" },
      (e) => ({ kind: "failed", cause: e.failure.cause }) as const,
    )
    .with({ kind: "not-a-member" }, () => ({ kind: "no-host" }) as const)
    .exhaustive();
}

/** The honest "scan unavailable" line for a NON-live {@link DaemonScan} — a total fold, so
 *  every cause gets its own plain-language reason (a hard failure reuses the matching
 *  {@link HOST_DOWN_COPY} title). `live` is excluded at the type level: the section renders
 *  rows for it, never this copy. */
export function scanUnavailableText(
  scan: Exclude<DaemonScan, { kind: "live" }>,
): string {
  return match(scan)
    .with(
      { kind: "connecting" },
      () => "Daemon scan unavailable — padi is connecting.",
    )
    .with(
      { kind: "no-frame" },
      () =>
        "Daemon scan unavailable — the connected padi hasn't reported a scan yet.",
    )
    .with(
      { kind: "failed" },
      (s) => `Daemon scan unavailable — ${HOST_DOWN_COPY[s.cause].title}.`,
    )
    .with(
      { kind: "no-host" },
      () => "Daemon scan unavailable — no padi is bound to this host.",
    )
    .exhaustive();
}
