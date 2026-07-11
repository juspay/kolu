import { encodeHostKey, type HostKey } from "kolu-common/hostKey";

/** Ground the per-tab ACTIVE host against live membership — the pure, total decision
 *  wire.ts's `groundedActiveHost` enacts (kept here, dependency-free, so it is
 *  unit-pinnable exactly like {@link hostReconcileTarget}).
 *
 *  `activeHost` is the per-tab persisted INTENT: restored SYNCHRONOUSLY from
 *  sessionStorage at boot, a tick before the async `padiMap.entries` membership
 *  snapshot lands (and it may name a host that has since left the pool). The per-host
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
 *  Membership is `encodeHostKey` equality — a `HostKey` is an object with no reference
 *  identity across independent decodes, so it is never `===` (mirrors
 *  `hostReconcileTarget`). */
export function groundActiveHost(
  active: HostKey,
  members: readonly HostKey[],
): HostKey | null {
  const activeEnc = encodeHostKey(active);
  return members.some((k) => encodeHostKey(k) === activeEnc) ? active : null;
}
