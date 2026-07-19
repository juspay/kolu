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
  /** The bind is (re)establishing — genuinely transient, the one case the old copy
   *  assumed for ALL not-live readings. */
  | { kind: "connecting" }
  /** Connected, but no real frame yet — a bind whose padi predates the `hostInventory`
   *  member (or hasn't delivered its first frame), so it can't report the scan. */
  | { kind: "too-old" }
  /** The host BINDING itself failed (ssh dial / handshake / contract fault), cause-typed
   *  — the arm the boolean could not express. Carries the {@link EntryFailedCause} so the
   *  copy names the real reason. */
  | { kind: "failed"; cause: EntryFailedCause }
  /** The active host is not a padi-map member — no bound padi to scan at all. */
  | { kind: "no-host" };

/** Fold the host's typed entry state (+ whether a real inventory frame has landed) into
 *  the honest {@link DaemonScan} cause. TOTAL over the four `EntryState` kinds via
 *  `.exhaustive()`, so a future entry kind can't silently fall through to a misleading
 *  "connecting". `bindLive` is the canonical bind-liveness fact (browser transport ∧ the
 *  active entry's own connection, `daemonChannelLive`) — it gates ONLY the `connected`
 *  arm's live-vs-too-old decision; the `failed`/`warming` causes stand on the entry's own
 *  kind, which is the honest reason even while the transport reconnects. */
export function daemonScanCause(
  entry: PadiEntry,
  bindLive: boolean,
  framePresent: boolean,
): DaemonScan {
  return match(entry)
    .with({ kind: "connected" }, () =>
      bindLive && framePresent
        ? ({ kind: "live" } as const)
        : ({ kind: "too-old" } as const),
    )
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
      { kind: "too-old" },
      () =>
        "Daemon scan unavailable — the connected padi is too old to report it.",
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
