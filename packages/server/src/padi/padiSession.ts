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
 * and `renew()` (the "restart" drain, an Effect — see {@link PadiSession}). The two
 * arms share this spread + the ONE
 * `padiConvergencePolicy`/`decide()` table + the ONE `drainAndAwaitExit` skeleton
 * (each arm plugs in its own transport exit signal — the local socket-close, the
 * remote hello-poll); they differ only in their transport (a self-converging local
 * `endpointConnector` vs an ssh `sshConnector` + a post-connect `padiAdmit`) and in
 * the enactment around that shared skeleton, which the base `Session` hides.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type {
  DaemonSession,
  DownSessionState,
  Session,
  SshProv,
} from "@kolu/surface-remote";
import type { Effect } from "effect";
import type { PadiConvergence } from "kolu-common/surface";
import type {
  EntryFailedCause,
  PadiEntryFailure,
  SkewVersionPair,
} from "kolu-common/surfacesWithPadi";

/** The domain detail a padi arm attaches to the map's published `EntryStatus`
 *  when its session is DOWN (D1 + D2) — the failure `cause`, plus the typed
 *  `running`/`expected` version pair when that cause is `contract-skew-refused`.
 *  Paired with the transport `reason` into the schema-valid `PadiEntryFailure` by
 *  {@link padiFailureOf} (the `serveHostMap` `failureOf` hook the composition root
 *  injects). `null` = "this arm has no finer domain detail for this down state": a
 *  transient reconnect (→ keep the entry warming), never a fabricated cause. The
 *  REMOTE arm sets a `link-failed` detail on a terminal give-up (its convergence
 *  tracks the link); the LOCAL arm has no convergence channel and returns `null`
 *  even when terminally `failed` — so `null`-on-`failed` is NOT the "no failure"
 *  signal: {@link padiFailureOf} classifies a null-detail terminal give-up as the
 *  LOCAL arm's `local-start-failed`, so a genuinely failed entry always classifies. */
export type PadiEntryFailedDetail =
  | { readonly cause: Exclude<EntryFailedCause, "contract-skew-refused"> }
  | ({ readonly cause: "contract-skew-refused" } & SkewVersionPair);

/** Classify a DOWN padi session into the map's schema-valid {@link PadiEntryFailure}
 *  — the `serveHostMap` `failureOf` hook, pulled out of the composition root so it is
 *  the ONE tested source of truth for "detail + transport state → published failure".
 *
 *  - A finer arm-local `detail` (skew / unconverged / cross-supervisor / a drv fault
 *    / the remote arm's own `link-failed`) is paired with the transport `reason` and
 *    published verbatim.
 *  - No finer `detail` (`null`) but the session has TERMINALLY given up
 *    (`state.phase === "failed"`) is classified off the ARM directly, via
 *    `provisions` (the runtime twin of the session's `Prov` — `false` for the local
 *    endpoint, `true` for a provisioning ssh arm): a NON-provisioning (local) give-up
 *    is `local-start-failed` (the padi couldn't start on this machine — a distinct
 *    producer from a remote reach, with a distinct remedy, so it gets its own named
 *    arm rather than collapsing into `link-failed`, which would be `"other"` wearing a
 *    better name); a provisioning (remote) give-up is `link-failed`. The remote arm
 *    normally rides the `detail` branch above (its convergence machine sets a
 *    `link-failed` detail), so this remote fallback only fires if a remote path ever
 *    reaches a terminal `failed` WITHOUT that detail — and it still classifies
 *    correctly off the arm rather than mislabeling it local. Either way a terminal
 *    give-up classifies rather than yielding `null` into `serveHostMap`'s fail-loud
 *    `UnclassifiedHostFailureError` seam.
 *  - No finer `detail` and merely `disconnected` (retrying) → `null`: keep-warming,
 *    the single-meaning absent (PR4). */
export function padiFailureOf(
  provisions: boolean,
  detail: PadiEntryFailedDetail | null,
  state: DownSessionState,
): PadiEntryFailure | null {
  if (detail !== null) return { ...detail, reason: state.error };
  if (state.phase !== "failed") return null;
  return provisions
    ? { cause: "link-failed", reason: state.error }
    : { cause: "local-start-failed", reason: state.error };
}

/** A bound padi, LOCAL or REMOTE — a daemon session over the padi surface, its
 *  convergence descriptor being padi's app-specific {@link PadiConvergence}.
 *
 *  Parameterized by `Prov`, mirroring `@kolu/surface-remote`'s own provisioning-
 *  unrepresentable split (juspay/kolu#1716) one layer up: `DaemonSession` itself
 *  always extends the FULL-union `Session<Client>` (it is not generic over the
 *  provisioning phase), so a padi session built over the local arm's narrowed
 *  `Session<_, never>` base was silently WIDENED back to the full union the moment
 *  it became a `PadiSession` — the type claimed a local padi session's `onState`
 *  could report `"provisioning"`, even though the local endpoint connector (the
 *  daemon is already here) can never produce it. `PadiSession<Prov>`
 *  intersects the daemon's supervision members onto the `Prov`-NARROWED base
 *  `Session<PadiSurfaceClient, Prov>`'s `onState` (and its synchronous twin
 *  `currentState`, which returns the same `SessionState<Prov>` frame) instead of
 *  `DaemonSession`'s own (always-full) ones — so `PadiSession<never>` (the local arm,
 *  see `padiBinding.ts`) makes `"provisioning"` a compile error here too, the
 *  LAST consumer in this split's chain. The remote ssh arm keeps the default (the
 *  ssh connector's `SshProv` = `"probing" | "provisioning"`); the heterogeneous
 *  local+remote pool (`index.ts`'s `buildRemotePool<PadiSession, …>`) still needs
 *  the common, un-parameterized `PadiSession` as its slot type — a local session
 *  widening into that slot is the same deliberate, structural widening
 *  `Session<_, never>` already undergoes to plug into a `Session` pool, not a
 *  silent one buried inside this alias. */
export type PadiSession<Prov extends string = SshProv> = Omit<
  DaemonSession<PadiSurfaceClient, PadiConvergence>,
  "onState" | "currentState" | "renew"
> &
  Pick<Session<PadiSurfaceClient, Prov>, "onState" | "currentState"> & {
    /** The D1+D2 domain-cause detail for the map's `EntryStatus` (see
     *  {@link PadiEntryFailedDetail}) — kolu-server's OWN extra member (not part of
     *  the generic `@kolu/surface-remote` `DaemonSession` role, which knows nothing
     *  of padi's causes; the volatility boundary D1 draws). `null` when the arm has
     *  nothing to classify (the local arm always; the remote arm outside a
     *  classifiable down state). */
    entryFailedDetail(): PadiEntryFailedDetail | null;
    /** Replace the running padi per its {@link PADI_PRESERVATION} strategy — the
     *  "restart" verb, as an EFFECT.
     *
     *  NARROWED off `DaemonSession.renew(): Promise<void>` by the `Omit` above, for
     *  the same reason `onState`/`currentState` are: the generic role in
     *  `@kolu/surface-remote` is the widest shape every daemon session could have,
     *  and kolu-server's padi arms have a narrower, truer one. Both arms' drains are
     *  built on the supervisor's Effect-native `drainAndAwaitExit`, and both of this
     *  member's callers (`index.ts`'s `drainBoundPadi` / `renewHostDaemon`) are
     *  reached from `router.ts`'s procedure handlers, which are Effects — so a
     *  `Promise` here would be a face nothing on either side of it wanted. It fails
     *  when the drain does not take; that failure IS the procedure's rejection. */
    renew(): Effect.Effect<void, unknown>;
  };

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
 *  report `"provisioning"`); the remote ssh arm (`remotePadiBinding.ts`)
 *  passes a `Session<_, SshProv>` and gets back the default `PadiSession` (admits
 *  `"probing"`/`"provisioning"`, its actual provisioning phases). */
export function asPadiSession<Prov extends string = SshProv>(
  base: Session<PadiSurfaceClient, Prov>,
  members: {
    convergence: () => PadiConvergence | null;
    renew: () => Effect.Effect<void, unknown>;
    /** See {@link PadiSession.entryFailedDetail}. */
    entryFailedDetail: () => PadiEntryFailedDetail | null;
  },
): PadiSession<Prov> {
  return {
    ...base,
    convergence: members.convergence,
    entryFailedDetail: members.entryFailedDetail,
    preservation: PADI_PRESERVATION,
    renew: members.renew,
  };
}
