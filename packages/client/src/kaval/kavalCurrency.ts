/** The pure kaval-attention derivation — "does this host's kaval need the
 *  user's attention, and on which axis?" (B3.4 currency + SK5 contract skew).
 *
 *  Extracted as its own side-effect-free module (like `canvasModeResolver`) so
 *  its truth table is unit-tested without mounting `useDaemonStatus`'s
 *  `daemonStatus` subscription. The host-chip pip/tooltip and the Kaval dialog
 *  banner join the live `expected`/`status` sources and call
 *  {@link kavalAttention} at their read sites — the ONE version-COMPARISON
 *  site in the client (the canvas skew card renders the same typed
 *  `incompatible` fact through the state-sum flow, `liveDownState`, which
 *  performs no comparison — the versions are the arm's own fields). So the
 *  surfaces can never disagree about whether (or why) a kaval needs attention
 *  (the reuse-as-fortification ruling: two independently-drifting "your kaval
 *  needs attention" predicates would be this bug's own shape rebuilt in the
 *  UI).
 *
 *  The two axes are MUTUALLY EXCLUSIVE by construction: `stale` (a newer build
 *  is available) requires a CONNECTED kaval — a build-behind daemon is honestly
 *  connected — while `incompatible` (a proven contract skew, SK4) is a daemon
 *  that NEVER connects; its verdict arrives on the `incompatible` status arm
 *  with both versions as typed fields (never re-parsed from message prose). */

import type { DaemonStatus, KavalSkewVersions } from "@kolu/padi/surface";

/** The attention verdict — one of the two axes, or none. */
export type KavalAttention =
  | { kind: "none" }
  /** Currency axis (B3.4): connected, but a newer kaval build is available —
   *  the amber "restart to update" nudge. Carries no payload: the display
   *  sites pair the human-readable `navigableCommit`s off their own sources
   *  (the compared `staleKey`s are opaque closure hashes nobody renders). */
  | { kind: "stale" }
  /** Contract axis (SK4/SK5): a PROVEN skew — the daemon speaks a contract
   *  this kolu cannot talk to, and a respawn from the host's current closure
   *  has already been tried. Carries the wire's typed skew payload
   *  ({@link KavalSkewVersions}, the ONE spelling of the version pair). The
   *  recovery is `hosts.renewDaemon`, never a plain restart. */
  | ({ kind: "incompatible" } & KavalSkewVersions);

/** True when the running daemon is provably a build behind the kaval the server
 *  would spawn (B3.4 — "update pending"): it's `connected`, both build-ids are
 *  known (non-empty), and they differ.
 *
 *  Keyed on the closure-hash `staleKey` — the `expected` from padiSurface's
 *  `status.expectedKaval` cell, the `reported` from the connected daemon's
 *  `daemonStatus.identity` — NEVER the per-deploy `navigableCommit`, so a
 *  server-/client-only deploy (which leaves kaval's staleKey bit-identical) never
 *  nudges (#1034). Off-nix both ids are "" (nix-first, no dev fallback) → silent.
 *  The `connected` gate excludes the transient/down states, which carry no
 *  reported identity to compare. Orthogonal to `DaemonState` — a build-behind
 *  daemon is honestly `connected`, so this is a SECOND axis, not a state.
 *
 *  MODULE-PRIVATE since SK5: every consumer reads the joined verdict through
 *  {@link kavalAttention} — which owns the transport-liveness floor, so this
 *  helper never sees a dead-channel status — and a second comparison site
 *  can't be re-minted. */
function kavalStale(
  expected: string | undefined,
  reported: string | undefined,
  state: DaemonStatus["state"] | undefined,
): boolean {
  return (
    state === "connected" && !!expected && !!reported && expected !== reported
  );
}

/** The ONE attention derivation (SK5). `live` (the watchdog-backed channel
 *  liveness, `channelLive(...)`) is a REQUIRED leg, threaded through the
 *  predicate itself rather than left to each caller: over a dead/half-open link
 *  the retained status is stale, so neither the "newer build — restart" nudge
 *  nor the "incompatible — update" verdict can honestly fire (their actions
 *  would fail loudly beside a grey "unknown" dot). Making it a parameter means
 *  every read site — the host-chip pip/tooltip, the dialog banner, the canvas
 *  card — MUST pass it; there is no way left to spell an attention verdict
 *  without the floor. */
export function kavalAttention(
  expected: string | undefined,
  status: DaemonStatus | undefined,
  live: boolean,
): KavalAttention {
  if (!live || status === undefined) return { kind: "none" };
  if (status.state === "incompatible") {
    return {
      kind: "incompatible",
      daemonVersion: status.daemonVersion,
      requiredVersion: status.requiredVersion,
    };
  }
  const reported = status.identity?.staleKey;
  if (kavalStale(expected, reported, status.state)) {
    return { kind: "stale" };
  }
  return { kind: "none" };
}
