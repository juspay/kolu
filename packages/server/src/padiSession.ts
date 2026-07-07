/**
 * The padi SESSION shape both binder arms (local {@link ./padiBinding.ts}, remote
 * {@link ./remotePadiBinding.ts}) return — post-S9, there is NO `BoundPadi` type and
 * NO wrapper class. A padi arm is a base {@link Session} (from `makeSession`) with
 * the daemon supervision members added by object SPREAD.
 *
 * Identity is UNIVERSAL — it rides the base `Session.identity()` (padi's reserved
 * `system.identity`, which padi's daemon declares; see `@kolu/padi` daemonMain), so
 * a padi arm adds ONLY supervision: `convergence()` (a standing anomaly, or null when
 * healthy), `preservation` (padi's children survive a renew — its PTYs live in kaval),
 * and `renew()` (the "restart" drain). The two arms share this spread + the ONE
 * `PADI_CONVERGENCE_POLICY`/`decide()` table + the ONE `drainAndAwaitExit` skeleton
 * (each arm plugs in its own transport exit signal — the local socket-close, the
 * remote hello-poll); they differ only in their transport (a self-converging local
 * `endpointConnector` vs an ssh `sshConnector` + a post-connect `padiAdmit`) and in
 * the enactment around that shared skeleton, which the base `Session` hides.
 */

import type { PadiSurfaceClient } from "@kolu/padi/dial";
import type { DaemonSession, Session } from "@kolu/surface-remote";
import type { ProvisioningPhase } from "@kolu/surface-remote/connection";
import type { PadiConvergence } from "kolu-common/surface";

/** A bound padi, LOCAL or REMOTE — a daemon session over the padi surface, its
 *  convergence descriptor being padi's app-specific {@link PadiConvergence}.
 *
 *  Parameterized by `Prov`, mirroring `@kolu/surface-remote`'s own copying-
 *  unrepresentable split (juspay/kolu#1716) one layer up: `DaemonSession` itself
 *  always extends the FULL-union `Session<Client>` (it is not generic over the
 *  provisioning phase), so a padi session built over the local arm's narrowed
 *  `Session<_, never>` base was silently WIDENED back to the full union the moment
 *  it became a `PadiSession` — the type claimed a local padi session's `onState`
 *  could report `"copying"`, even though the local endpoint connector (no
 *  nix-copy, the daemon is already here) can never produce it. `PadiSession<Prov>`
 *  intersects the daemon's supervision members onto the `Prov`-NARROWED base
 *  `Session<PadiSurfaceClient, Prov>`'s `onState` instead of `DaemonSession`'s own
 *  (always-full) one — so `PadiSession<never>` (the local arm, see
 *  `padiBinding.ts`) makes `"copying"` a compile error here too, the LAST consumer
 *  in this split's chain. The remote ssh arm keeps the default (full
 *  `ProvisioningPhase`, admitting `"copying"`); the heterogeneous local+remote pool
 *  (`index.ts`'s `buildRemotePool<PadiSession, …>`) still needs the common,
 *  un-parameterized `PadiSession` as its slot type — a local session widening
 *  into that slot is the same deliberate, structural widening `Session<_, never>`
 *  already undergoes to plug into a `Session` pool, not a silent one buried
 *  inside this alias. */
export type PadiSession<Prov extends ProvisioningPhase = ProvisioningPhase> =
  Omit<DaemonSession<PadiSurfaceClient, PadiConvergence>, "onState"> &
    Pick<Session<PadiSurfaceClient, Prov>, "onState">;

/** padi's preservation strategy: its PTYs live in a SEPARATE kaval process, so a
 *  `renew()` (drain + respawn) is survived by them — a fresh padi adopts the running
 *  kaval. The one fact a "restart" UI must state honestly. */
export const PADI_PRESERVATION = { children: "survive" } as const;

/** Add the padi daemon-supervision members onto a base {@link Session} by spread —
 *  the TS-idiomatic derivation S9 mandates (no wrapper class, no forwarding
 *  boilerplate). `convergence` reads the arm's standing anomaly; `renew` is the arm's
 *  drain. Identity/reconnect/recheck/pin/… all ride the base unchanged.
 *
 *  Generic over `Prov` — INFERRED from `base` — so the caller's own narrowing
 *  survives THROUGH this function instead of being discarded at the one place
 *  both arms funnel through: the local arm (`padiBinding.ts`) passes a
 *  `Session<_, never>` base and gets back a `PadiSession<never>` (still unable to
 *  report `"copying"`); the remote ssh arm (`remotePadiBinding.ts`) passes the
 *  default `Session<_>` (Prov = `ProvisioningPhase`) and gets back the default
 *  `PadiSession` (admits `"copying"`, its actual opening phase). */
export function asPadiSession<
  Prov extends ProvisioningPhase = ProvisioningPhase,
>(
  base: Session<PadiSurfaceClient, Prov>,
  members: {
    convergence: () => PadiConvergence | null;
    renew: () => Promise<void>;
    /** The far-end clock offset measured at admit/connect (ms), or `null` before the
     *  first successful handshake. Folded into a keyed map's `EntryStatus.connected`. */
    clockOffset: () => number | null;
  },
): PadiSession<Prov> {
  return {
    ...base,
    convergence: members.convergence,
    preservation: PADI_PRESERVATION,
    renew: members.renew,
    clockOffset: members.clockOffset,
  };
}
