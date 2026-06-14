/** The pure B3.4 currency derivation — "is the running kaval a build behind?"
 *
 *  Extracted as its own side-effect-free module (like `canvasModeResolver`) so
 *  its truth table is unit-tested without mounting `useDaemonStatus`'s
 *  `daemonStatus` subscription. {@link KavalUpdateBadge}'s `kavalUpdatePending`
 *  accessor joins the live `expected`/`reported` sources and calls this. */

import type { DaemonState } from "kolu-common/surface";

/** True when the running daemon is provably a build behind the kaval the server
 *  would spawn (B3.4 — "update pending"): it's `connected`, both build-ids are
 *  known (non-empty), and they differ.
 *
 *  Keyed on the closure-hash `staleKey` — the `expected` from the server's
 *  `buildInfo.expectedKaval`, the `reported` from the connected daemon's
 *  `daemonStatus.identity` — NEVER the per-deploy `navigableCommit`, so a
 *  server-/client-only deploy (which leaves kaval's staleKey bit-identical) never
 *  nudges (#1034). Off-nix both ids are "" (nix-first, no dev fallback) → silent.
 *  The `connected` gate excludes the transient/down states, which carry no
 *  reported identity to compare. Orthogonal to `DaemonState` — a build-behind
 *  daemon is honestly `connected`, so this is a SECOND axis, not a state. */
export function kavalStale(
  expected: string | undefined,
  reported: string | undefined,
  state: DaemonState | undefined,
): boolean {
  return (
    state === "connected" && !!expected && !!reported && expected !== reported
  );
}
