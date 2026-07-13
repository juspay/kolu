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
import type {
  DaemonSession,
  DownSessionState,
  Session,
  SshProv,
} from "@kolu/surface-remote";
import type {
  EntryFailedCause,
  PadiEntryFailure,
  SkewVersionPair,
} from "kolu-common/surfacesWithPadi";
import type { PadiConvergence } from "kolu-common/surface";

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
 *  signal: {@link padiFailureOf} floors a terminal give-up to `link-failed` off the
 *  transport state, so a genuinely failed entry always classifies. */
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
 *    (`state.phase === "failed"`) IS a `link-failed` by the schema's own definition
 *    ("the transport gave up") — so the LOCAL arm, whose `entryFailedDetail()` is
 *    always `null`, still classifies its terminal give-up rather than yielding `null`
 *    into `serveHostMap`'s fail-loud `UnclassifiedHostFailureError` seam.
 *  - No finer `detail` and merely `disconnected` (retrying) → `null`: keep-warming,
 *    the single-meaning absent (PR4). */
export function padiFailureOf(
  detail: PadiEntryFailedDetail | null,
  state: DownSessionState,
): PadiEntryFailure | null {
  if (detail !== null) return { ...detail, reason: state.error };
  return state.phase === "failed"
    ? { cause: "link-failed", reason: state.error }
    : null;
}

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
 *  `padiBinding.ts`) makes `"copying"`/`"building"` a compile error here too, the
 *  LAST consumer in this split's chain. The remote ssh arm keeps the default (the
 *  ssh connector's `SshProv` = `"copying" | "building"`); the heterogeneous
 *  local+remote pool (`index.ts`'s `buildRemotePool<PadiSession, …>`) still needs
 *  the common, un-parameterized `PadiSession` as its slot type — a local session
 *  widening into that slot is the same deliberate, structural widening
 *  `Session<_, never>` already undergoes to plug into a `Session` pool, not a
 *  silent one buried inside this alias. */
export type PadiSession<Prov extends string = SshProv> = Omit<
  DaemonSession<PadiSurfaceClient, PadiConvergence>,
  "onState"
> &
  Pick<Session<PadiSurfaceClient, Prov>, "onState"> & {
    /** The D1+D2 domain-cause detail for the map's `EntryStatus` (see
     *  {@link PadiEntryFailedDetail}) — kolu-server's OWN extra member (not part of
     *  the generic `@kolu/surface-remote` `DaemonSession` role, which knows nothing
     *  of padi's causes; the volatility boundary D1 draws). `null` when the arm has
     *  nothing to classify (the local arm always; the remote arm outside a
     *  classifiable down state). */
    entryFailedDetail(): PadiEntryFailedDetail | null;
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
 *  report `"copying"`/`"building"`); the remote ssh arm (`remotePadiBinding.ts`)
 *  passes a `Session<_, SshProv>` and gets back the default `PadiSession` (admits
 *  `"copying"`/`"building"`, its actual provisioning phases). */
export function asPadiSession<Prov extends string = SshProv>(
  base: Session<PadiSurfaceClient, Prov>,
  members: {
    convergence: () => PadiConvergence | null;
    renew: () => Promise<void>;
    /** The far-end clock offset measured at admit/connect (ms), or `null` before the
     *  first successful handshake. Folded into a keyed map's `EntryStatus.connected`. */
    clockOffset: () => number | null;
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
    clockOffset: members.clockOffset,
  };
}
