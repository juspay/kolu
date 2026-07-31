/**
 * `DaemonSession` — the daemon flavor of {@link Session} (S7/S7b).
 *
 * A plain {@link Session} dials a remote surface and reconnects. A DAEMON session
 * additionally SUPERVISES the process on the far end: it can report a standing
 * convergence anomaly (the bound daemon isn't the build we want, and here's why),
 * declare what REPLACING it costs the daemon's children, and trigger that
 * replacement. Supervision is the ONE thing a daemon adds over a plain session —
 * identity/reconnect/recheck are already universal (on the base role).
 *
 * Only a daemon kolu-server BINDS is a `DaemonSession` — today that is padi (both
 * arms). The framework's {@link ConvergenceAnomaly} (`adopted-stale` · `skew-refused` ·
 * `unconverged` · `cross-supervisor`) is the shared convergence vocabulary; apps
 * re-derive their wire descriptor from it and union session-owned states
 * (`link-failed`) at the edge. The base {@link DaemonConvergence} is the minimal
 * shared contract every such descriptor honors (a named `kind` + a human reason).
 */

import type { SurfaceClientLike } from "@kolu/surface/project";
import type { Session } from "./session";

/** The minimal shared shape of a daemon-convergence anomaly — a named `kind` and a
 *  human-readable `detail` for a UI banner. A consumer's richer descriptor (padi's
 *  `PadiConvergence`, carrying typed evidence per arm) extends this; the framework
 *  never names the app's specific states. Discriminant is `kind` (matches the
 *  framework anomaly union). */
export interface DaemonConvergence {
  /** The convergence kind (the app narrows this to its own union). */
  readonly kind: string;
  /** A human-readable reason for the degraded bind, for a dialog banner. */
  readonly detail: string;
}

/** What REPLACING a daemon (a `renew()`) costs its children — declared in the TYPE
 *  so a UI can't promise the wrong thing. padi: `"survive"` (its PTYs live in a
 *  separate kaval process, adopted by the fresh padi). kaval's own recycle: `"die"`
 *  (its PTYs are its own children). The distinction is the one fact a user cares
 *  about, so it is never a boolean flag to bury. */
export interface PreservationStrategy {
  readonly children: "survive" | "die";
}

/** The daemon flavor of {@link Session}: supervision (convergence · preservation ·
 *  renew) added atop the universal session role. Generic over the app's convergence
 *  descriptor `Conv` (kolu's padi arm: `PadiConvergence`), which must honor the
 *  minimal {@link DaemonConvergence} contract. */
export interface DaemonSession<
  Client = SurfaceClientLike,
  Conv extends DaemonConvergence = DaemonConvergence,
> extends Session<Client> {
  /** A STANDING convergence anomaly to surface (a degraded bind: adopted-stale
   *  build, contract skew, drain-failure, link-failure), or `null` when the bind is
   *  converged/healthy — so a degraded bind is a visible state, never a swallowed
   *  log line. */
  convergence(): Conv | null;
  /** What replacing this daemon costs — declared, so the UI's warning is honest. */
  readonly preservation: PreservationStrategy;
  /** Replace the running daemon per its {@link preservation} strategy — the manual
   *  trigger (the "restart" verb) of the same replacement machinery `convergence()`
   *  reports on. */
  renew(): Promise<void>;
}
