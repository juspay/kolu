import { encodeHostKey, type HostKey } from "kolu-common/hostKey";

/** What wire.ts's ONE active-host effect should do this frame, or `null` for a no-op.
 *
 *  - `activate-joined` — a host the user just ADDED (pending intent) has now appeared in
 *    membership, so switch to it AND consume the pending intent (the caller clears its
 *    pending signal). No toast: this is the add the user asked for.
 *  - `bounce-departed` — the ACTIVE host left the pool, so fall back to the local default
 *    (the caller toasts). The pending intent, if any, is NOT consumed — a host still on its
 *    way in must survive a concurrent bounce of the previously-active host. */
export type HostReconcileAction =
  | { kind: "activate-joined"; target: HostKey }
  | { kind: "bounce-departed"; target: HostKey };

/** THE ONE active-host reconcile decision (wire.ts) — pure + total so wire.ts's module-init
 *  effect is unit-pinnable. Answers "where should the tab be, given membership + the current
 *  active host + any pending add-a-host intent?" as a SINGLE decision, so there is exactly one
 *  `setActiveHost` writer to reason about (the join-activation is an ARM here, not a second
 *  effect racing this one).
 *
 *  JOIN INTENT (added-host activation) — RS4 sibling / W6 add-host fix. `hosts.add` resolves
 *  BEFORE the membership `entries` stream delivers the new member, so a bare `setActiveHost`
 *  in the add `.then` raced THIS reconcile and got bounced to local — adding an N+1th host
 *  always landed on the local default. Deferring the switch to the frame the host JOINS
 *  membership (this arm) makes the decision frame-consistent: the host is a member the instant
 *  it becomes active. Checked BEFORE the departed-bounce guards so a pending join lands even
 *  while the local default is active (`active.kind === "local"` would otherwise short-circuit).
 *  (The true root cause is `hosts.add` resolving before the member is observable, but a
 *  server-side contract change is framework-touching and still can't guarantee client
 *  frame-ordering — pending-intent-in-the-resolver is the honest CLIENT fix.)
 *
 *  DEPARTED BOUNCE (RS4 #4) — when the ACTIVE host leaves membership (the user ✕'d their own
 *  guest chip, or the server auto-retired it on re-serve-pump death), nothing else re-keys
 *  `useEntry(activeHost)` and the tab is stranded on a dead host (every `padiRpcOf(activeHost())`
 *  throws `MAP_KEY_UNKNOWN`, canvas frozen, no chip lit) — fall back to the unremovable local
 *  default. No-op when membership hasn't snapshotted yet (empty `keys` — the warming window, so
 *  a not-yet-arrived host isn't read as departed), the active host is the local default
 *  (unremovable, always a member), or it is still a member. Membership is `encodeHostKey`
 *  equality — a `HostKey` is an object with no reference identity across independent decodes,
 *  so membership is never `===`. */
export function hostReconcileTarget(
  keys: readonly HostKey[],
  active: HostKey,
  pendingJoin: HostKey | null,
  localHost: HostKey,
): HostReconcileAction | null {
  // Join intent wins — activate a just-added host the instant it appears in membership.
  if (pendingJoin !== null) {
    const pendingEnc = encodeHostKey(pendingJoin);
    if (keys.some((k) => encodeHostKey(k) === pendingEnc)) {
      return { kind: "activate-joined", target: pendingJoin };
    }
  }
  // Departed-bounce: a stranded active host falls back to the local default.
  if (keys.length === 0) return null; // pre-snapshot warming window — nothing to reconcile against
  if (active.kind === "local") return null; // the default is unremovable — always a member
  const activeEnc = encodeHostKey(active);
  if (keys.some((k) => encodeHostKey(k) === activeEnc)) return null; // still a member — no-op
  return { kind: "bounce-departed", target: localHost }; // departed → fall back, loudly
}
