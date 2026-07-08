import { encodeHostKey, type HostKey } from "kolu-common/hostKey";

/** Pure decision for wire.ts's active-host membership reconcile. Given the current pool
 *  membership `keys`, the `active` host, and the unremovable `localHost` default, returns
 *  the host to fall BACK to when the active host has left the pool, or `null` for a no-op.
 *
 *  `activeHost` is a per-tab pref whose only writer is the chip click, so when the ACTIVE
 *  host leaves membership — the user ✕'d their own guest chip, or the server auto-retired
 *  it on re-serve-pump death (`pool.remove`) — nothing re-keys `useEntry(activeHost)` and
 *  the tab is stranded on a dead host (every `padiRpcOf(activeHost())` call then throws
 *  `MAP_KEY_UNKNOWN`, canvas frozen, no chip lit). This is the host-level twin of the
 *  terminal auto-switch (`useActiveReconcile`).
 *
 *  Pure + total so the reconcile is unit-pinnable — wire.ts's effect is module-init and
 *  untestable in isolation, the same reason `floorOnLiveness` / `pruneToMembers` were
 *  extracted. No-op (returns `null`) when: membership hasn't snapshotted yet (empty `keys`
 *  — the warming window, so a not-yet-arrived host isn't read as departed), the active host
 *  is the local default (`.kind === "local"` — unremovable, always a member), or the active
 *  host is still a member (compared by its CANONICAL string — a `HostKey` is an object with
 *  no reference identity across independent decodes, so membership is `encodeHostKey`
 *  equality, never `===`). Otherwise the active host departed → fall back to `localHost`
 *  (the caller toasts). */
export function hostReconcileTarget(
  keys: readonly HostKey[],
  active: HostKey,
  localHost: HostKey,
): HostKey | null {
  if (keys.length === 0) return null; // pre-snapshot warming window — nothing to reconcile against
  if (active.kind === "local") return null; // the default is unremovable — always a member
  const activeEnc = encodeHostKey(active);
  if (keys.some((k) => encodeHostKey(k) === activeEnc)) return null; // still a member — no-op
  return localHost; // departed → fall back to the unremovable default, loudly
}
