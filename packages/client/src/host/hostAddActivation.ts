import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createEffect, createSignal } from "solid-js";

/** Pure decision for {@link createAddedHostActivation}: given the host we want to activate
 *  once it JOINS the pool and the current membership keys, return it iff it is now a member
 *  (so switching to it won't be bounced by wire.ts's membership reconcile), else `null`.
 *  Membership is `encodeHostKey` equality — a `HostKey` is an object with no reference
 *  identity across independent decodes, so `===` would never match (mirrors
 *  `hostReconcileTarget`). Pure + total so the join gate is unit-pinnable. */
export function activationOnJoin(
  pending: HostKey | null,
  memberKeys: readonly HostKey[],
): HostKey | null {
  if (pending === null) return null;
  const enc = encodeHostKey(pending);
  return memberKeys.some((k) => encodeHostKey(k) === enc) ? pending : null;
}

/** Activate a newly ADDED host as the active host — but only once it actually appears in
 *  the pool membership.
 *
 *  `hosts.add` resolves BEFORE the membership `entries` stream delivers the new member, so
 *  switching to it immediately (in the add `.then`) loses a race with wire.ts's membership
 *  reconcile (`hostReconcileTarget`): the reconcile sees the just-activated host as "not a
 *  member" and bounces the tab to the unremovable LOCAL default — so a user adding their
 *  N+1th host always landed on local, never the host they just added. Deferring the switch
 *  to the frame the host JOINS membership makes the two effects agree — the host is a
 *  member the instant it becomes active, so the reconcile is a no-op.
 *
 *  Returns the `requestActivateOnJoin(host)` the add flow calls in place of a bare
 *  `setActiveHost`. Must run inside a reactive owner (wire.ts's app-scope `hostScoped`
 *  root), alongside the reconcile it coexists with. */
export function createAddedHostActivation(
  memberKeys: () => readonly HostKey[],
  setActiveHost: (host: HostKey) => void,
): (host: HostKey) => void {
  const [pending, setPending] = createSignal<HostKey | null>(null);
  createEffect(() => {
    const target = activationOnJoin(pending(), memberKeys());
    if (target === null) return;
    setActiveHost(target);
    setPending(null); // one-shot: clear so a later departure/rejoin doesn't re-switch
  });
  return setPending;
}
