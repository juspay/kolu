import { type HostKey, hostKeysInclude } from "kolu-common/hostKey";

/** Ground the per-tab ACTIVE host against live membership — the pure, total decision
 *  wire.ts's `groundedActiveHost` enacts (kept here, dependency-free, so it is
 *  unit-pinnable exactly like {@link hostReconcileTarget}).
 *
 *  `activeHost` is the per-tab persisted INTENT: restored SYNCHRONOUSLY at boot from the
 *  launch-selected Web Storage backend (`sessionStorage` for a regular tab, `localStorage`
 *  for an installed PWA — see `activeHostStorage`), a tick before the async
 *  `padiMap.entries` membership snapshot lands (and it may name a host that has since left
 *  the pool). The per-host
 *  SCOPE (`hostScope/hostScopes` → `scopedByEntry`) must never be handed an active key
 *  that membership does not ground: `scopedByEntry` reads a non-member active as the
 *  removal-race inhabitant (a dev warn + `undefined` world), which at BOOT is a false
 *  positive — the host is not departing, membership simply has not arrived yet.
 *
 *  So the accessor fed to the scope is grounded through this: the active host IFF it
 *  is a CURRENT member, else `null` ("nothing grounded yet" — `scopedByEntry`'s honest
 *  no-selection inhabitant, no warn). `null` — NOT a local-default substitute — is the
 *  correct empty: substituting local's owned world while `activeHost` still names a
 *  non-local host would be a representable LIE (the scope would be local's while every
 *  `useEntry(activeHost)` / `foldState` readout targets the other host). The
 *  departed-active case is re-pointed by wire.ts's ONE active-host reconcile
 *  ({@link hostReconcileTarget}) a tick later; until then the scope is honestly `null`.
 *
 *  Membership is decided by the shared `hostKeysInclude` authority (`encodeHostKey`
 *  equality), the SAME scan `hostReconcileTarget` uses — so the membership check can't
 *  drift between the read and write side. Note this scans UNIFORMLY, including for
 *  `local`: `hostReconcileTarget` instead short-circuits `local` on the server invariant
 *  that `LOCAL_HOST` is the unremovable seed, so a `local` active that is somehow NOT a
 *  member grounds to `null` here (honest — no owned world) while reconcile would not
 *  bounce it. That invariant-violation state is asserted fail-fast in `wire.ts` rather
 *  than left to degrade silently. */
export function groundActiveHost(
  active: HostKey,
  members: readonly HostKey[],
): HostKey | null {
  return hostKeysInclude(members, active) ? active : null;
}
