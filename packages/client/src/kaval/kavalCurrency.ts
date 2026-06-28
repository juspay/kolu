/** The pure B3.4 currency derivation — "is the running kaval a build behind?"
 *
 *  Extracted as its own side-effect-free module (like `canvasModeResolver`) so
 *  its truth table is unit-tested without mounting `useDaemonStatus`'s
 *  `daemonStatus` subscription. {@link KavalUpdateBadge}'s `kavalUpdatePending`
 *  accessor joins the live `expected`/`reported` sources and calls this. */

import type { DaemonState } from "kolu-common/surface";

/** True when the running daemon is provably a build behind the kaval the server
 *  would spawn (B3.4 — "update pending"): the link is `live`, it's `connected`, both
 *  build-ids are known (non-empty), and they differ.
 *
 *  Keyed on the closure-hash `staleKey` — the `expected` from the server's
 *  `buildInfo.expectedKaval`, the `reported` from the connected daemon's
 *  `daemonStatus.identity` — NEVER the per-deploy `navigableCommit`, so a
 *  server-/client-only deploy (which leaves kaval's staleKey bit-identical) never
 *  nudges (#1034). Off-nix both ids are "" (nix-first, no dev fallback) → silent.
 *  The `connected` gate excludes the transient/down states, which carry no
 *  reported identity to compare. Orthogonal to `DaemonState` — a build-behind
 *  daemon is honestly `connected`, so this is a SECOND axis, not a state.
 *
 *  `live` (the watchdog-backed transport liveness, `daemonTransportLive()`) is a
 *  REQUIRED leg, threaded through the predicate itself rather than left to each
 *  caller: over a dead/half-open link the retained `connected` identity is stale, so
 *  the "a newer build is available — restart" nudge can't honestly fire (its restart
 *  would fail loudly, beside a grey "unknown" dot). Making it a parameter means BOTH
 *  read sites — the rail badge (`kavalUpdatePending`) and the dialog banner
 *  (`KavalInfoDialog`'s `pending`) — MUST pass it; there is no way left to spell the
 *  connected-and-behind verdict without the floor (the unfloored call is a type error). */
export function kavalStale(
  expected: string | undefined,
  reported: string | undefined,
  state: DaemonState | undefined,
  live: boolean,
): boolean {
  return (
    live &&
    state === "connected" &&
    !!expected &&
    !!reported &&
    expected !== reported
  );
}
