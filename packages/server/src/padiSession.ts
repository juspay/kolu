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
import type { PadiConvergence } from "kolu-common/surface";

/** A bound padi, LOCAL or REMOTE — a daemon session over the padi surface, its
 *  convergence descriptor being padi's app-specific {@link PadiConvergence}. */
export type PadiSession = DaemonSession<PadiSurfaceClient, PadiConvergence>;

/** padi's preservation strategy: its PTYs live in a SEPARATE kaval process, so a
 *  `renew()` (drain + respawn) is survived by them — a fresh padi adopts the running
 *  kaval. The one fact a "restart" UI must state honestly. */
export const PADI_PRESERVATION = { children: "survive" } as const;

/** Add the padi daemon-supervision members onto a base {@link Session} by spread —
 *  the TS-idiomatic derivation S9 mandates (no wrapper class, no forwarding
 *  boilerplate). `convergence` reads the arm's standing anomaly; `renew` is the arm's
 *  drain. Identity/reconnect/recheck/pin/… all ride the base unchanged. */
export function asPadiSession(
  base: Session<PadiSurfaceClient>,
  members: {
    convergence: () => PadiConvergence | null;
    renew: () => Promise<void>;
  },
): PadiSession {
  return {
    ...base,
    convergence: members.convergence,
    preservation: PADI_PRESERVATION,
    renew: members.renew,
  };
}
