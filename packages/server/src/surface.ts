/**
 * Server-side surface implementation — single source of truth for kolu-server's
 * OWN typed reactive layer (the `kolu` + `surfaceApp` siblings).
 *
 * As of the W2.2 cutover kolu-server serves NO terminal domain: `padiSurface` is
 * RE-SERVED off a bound padi PROCESS (see `padiBinding.ts` + the async boot in
 * `index.ts`), not implemented in-process here. So this file implements only the
 * two siblings kolu-server owns. SR8.a moved the serve out of module load into a
 * boot-time {@link implementKoluSurface} that `index.ts` calls AFTER `padiSession`
 * exists; SR8.c gave every member ONE home HERE. `implementKoluSurface` takes plain
 * domain-named deps (reads + a projected `onState`) and assembles EVERY member's
 * framework node in this file — so `index.ts` imports no reactor primitive — and
 * RETURNS just `{ router }` (there are no module-level `koluSurfaceRouter`/
 * `koluSurfaceCtx` exports, and NO ctx-write path: the reactor graph is every derived
 * member's one writer). `index.ts` only splices the re-served `padi` sibling into
 * `router.surface`. What stays at module load is the `t` builder `router.ts` binds
 * kolu-server's remaining raw RPCs (`server`/`daemon`/`hosts`) against — a pure oRPC
 * contract builder that fires no connects, so the app-router assembly is unaffected by
 * the serve moving. The surface is finalized by `implementSurfacesOnPublisher`, not by
 * a local `implement(servedContract)` (retired at SRT-PR1 — the runtime returns a final
 * router; routing is by the assembled object, so the padi splice needs no widened
 * contract).
 *
 *   - kolu's four live members: `processMemory` + `daemonInventory` are DERIVED POLL
 *     cells (a fused `everyMsOr` cadence); `padiLink` + `processStartedAt` are DERIVED
 *     PUSH cells (two `scan`s over ONE shared `onState` source). All are graph-written —
 *     no ctx entry (the bridge's one-writer law). `preferences` is the one Conf-backed
 *     store cell.
 *
 * Publisher channel names are framework-derived in two layers. Each surface
 * names its own channels by primitive: `<prim>:changed` for cells,
 * `<prim>:keys` + `<prim>:<key>` for collections,
 * `<prim>:<JSON.stringify(input)>` for events. `implementSurfaces` then
 * key-namespaces every name with its sibling key before it reaches the shared
 * publisher — so the wire publisher actually sees `kolu/preferences:changed`,
 * `surfaceApp/buildInfo:changed`, etc.
 *
 * `preferences` is the one `confStore`-backed cell kolu-server still owns (a
 * `koluSurface` cell served here); the `activityFeed` + `session` stores retired
 * from here at W2.2 — padi owns its OWN state-root now, so those stores no longer
 * cross into padi from kolu-server.
 */

import { publisher } from "@kolu/padi/assembly";
import {
  type CellStore,
  composeSurfaceContracts,
  confStore,
  type ImplementSurfaceDeps,
  implementSurfacesOnPublisher,
  publisherChannel,
} from "@kolu/surface/server";
import { surfaceAppServer } from "@kolu/surface-app/server";
import { oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { contract } from "kolu-common/contract";
import type { PadiProcessMemory } from "@kolu/padi/surface";
import { derived, everyMsOr, scan, source } from "@kolu/surface/reactor";
import type {
  KoluBuildInfo,
  PadiLink,
  Preferences,
  ProcessStartedAt,
} from "kolu-common/surface";
import {
  type DaemonInventory,
  DEFAULT_DAEMON_INVENTORY,
  type koluSurface,
  surfaces,
} from "kolu-common/surface";
import {
  PADI_SURFACE_NAME,
  padiHostMap,
  surfacesWithPadi,
} from "kolu-common/surfacesWithPadi";
import {
  serverCommit,
  serverProcessId,
  serverStartedAt,
  serverVersion,
} from "./hostname.ts";
import { log } from "./log.ts";
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  sampleServerMemory,
} from "./memorySampler.ts";
import { DAEMON_INVENTORY_SAMPLE_INTERVAL_MS } from "./padi/daemonInventory.ts";
import { store } from "./state.ts";

// kolu-server serves a SUPERSET contract locally: the padi-less kolu-common
// `contract` (which the client consumes, byte-for-byte unchanged) PLUS the
// `padi` sibling. Spreading the already-built `contract` carries over its root
// namespaces (`server`/`daemon`/`hosts`) and its 2-sibling `surface`
// (kolu + surfaceApp); the second spread of
// `composeSurfaceContracts(surfacesWithPadi)` then WIDENS `surface` to three
// siblings (adds `padi`), and `padi` is overwritten with the host MAP's own
// contract (the key-folded members + the `entries` membership collection) so the
// served wire shape matches what `serveHostMap` serves (in `index.ts`).
//
// This contract widening is LOAD-BEARING for the WIRE MATCHER, not just for
// surface finalization. `implement(contract).router(obj)` ADAPTS `obj` against
// the contract and DROPS any key the contract doesn't declare — and the
// re-served `padi` sibling is a `serveSurfaceMap` FRAGMENT (structurally
// navigable by `directLink`, but carrying no `/surface/padi/*` matcher meta of
// its own). So the `padi`-widened `servedContract` builder is what RE-ADAPTS the
// map fragment under the `padi` key, attaching the `/surface/padi/*` routes the
// HTTP/ws `RPCHandler` matcher needs. Building `t` against the padi-LESS
// `contract` silently drops every `/surface/padi/*` route → a boot-time 404 the
// `directLink`-based `padiBinding` test can't see (directLink bypasses the
// matcher). Pinned by `router.test.ts`. (The SURFACE FINALIZATION did move to
// `implementSurfacesOnPublisher` below — this `t` binds the raw root RPCs and
// re-adapts the spliced siblings for the wire, it no longer finalizes the kolu
// surface.)
const servedContract = oc.router({
  ...contract,
  surface: {
    ...composeSurfaceContracts(surfacesWithPadi).surface,
    // Overwrite the plain `padi` sibling with the keyed MAP's folded surface fragment.
    // The value is the map's TYPED `surfaceContract` field — no `as any` reaching into
    // `.contract` (PR3); the map owns the single library-side cast, so this connection
    // site stays cast-free. The key is {@link PADI_SURFACE_NAME}, the SAME const the map's
    // `name` and every other mount reference.
    [PADI_SURFACE_NAME]: padiHostMap.surfaceContract,
  },
});

// `t` is the host router builder against the SERVED (superset) contract; both
// the spliced surface siblings and the raw oRPC handlers in `router.ts` plug into
// it. Exported so `router.ts` binds `t.server.info` / `t.daemon.restart` /
// `t.hosts.*` and re-adapts the assembled surface against the same builder.
export const t = implement(servedContract);

// ── Stores (Conf-backed; one slot per persisted cell) ──────────────────
//
// Only `preferences` remains kolu-server's own persisted cell. The `session` +
// `activityFeed` + `lastPairedDaemon` stores retired from here at the W2.2
// cutover: padi owns its OWN state-root now (`openPadiStateStores`), so those
// stores no longer cross into padi from kolu-server.

const preferencesStore: CellStore<Preferences> = confStore<Preferences>(
  store,
  "preferences",
);

// ── The bound padi's rail state — the projected payload the push cells derive from ──
//
// `padiLink` + `processStartedAt` both derive from the bound padi's `onState`. To keep
// this file domain-projection-free, `index.ts` projects each raw `SessionState` into
// this small payload (phase → `link`, `identity()` → `padiStartedAt`) BEFORE it reaches
// here; the two push cells then just route its fields. All FOUR of kolu-server's live
// members (`processMemory`, `daemonInventory`, `padiLink`, `processStartedAt`) now have
// ONE home — this file — assembled from the boot-only reads/onState `index.ts` supplies.
export interface PadiRailState {
  link: PadiLink;
  padiStartedAt: number | null;
}

/** The boot-only dependencies `index.ts` supplies so `implementKoluSurface` can build
 *  EVERY member here — the reactor `source`/`scan`/`derived.cell` nodes are assembled in
 *  this file, never a kolu-named parallel poll-spec type, and `index.ts` imports no
 *  reactor primitive. Each seam needs `padiSession` (the re-serve mirror, the liveness
 *  snapshot, the identity sum), which exists only in the async boot. */
export interface KoluSurfaceDeps {
  /** padi's `{ padi, kaval }` memory reading off the re-serve mirror (gated in
   *  `index.ts` on padi's honest connected phase, `padiSession.currentState().phase
   *  === "connected"`), or `null` when padi is down. */
  readPadiMemory: () => Promise<PadiProcessMemory | null>;
  /** The RAW host-daemon enumeration — may throw (a discovery fs-walk / session
   *  readout). `implementKoluSurface` wraps it TOTAL (below) so a fault degrades only
   *  this one diagnostic cell, never faults the runtime's `done` → `process.exit`. */
  readDaemonInventory: () => Promise<DaemonInventory>;
  /** The bound padi's state feed, projected to {@link PadiRailState}. Fires the current
   *  state synchronously on subscribe and returns an unsubscribe. Drives the two push
   *  cells (payload) AND the two poll cells' fused cadence (a bare change tick). */
  onState: (cb: (state: PadiRailState) => void) => () => void;
}

// ── Surface implementation (SR8.a: served in boot; SR8.c: ONE home per member) ───
//
// Serving kolu-server's own two siblings is the ONE place a connect fires (the
// surface-app buildInfo connector). It happens HERE, called once from `index.ts`'s
// async boot AFTER `padiSession` exists — not at module load — because every live member
// reads/installs through boot-only seams. SR8.c: `implementKoluSurface` now takes plain
// domain-named deps and assembles EVERY member's framework node (`source`/`scan`/
// `derived.cell`) in THIS file — kolu's member table has one home, and `index.ts` imports
// no reactor primitive. Ordering is enforced by straight-line boot control flow (the
// caller uses the returned router/ctx immediately), so the rejected late-bind registrar
// slot (an override-knob) is unnecessary and absent. `t`/`servedContract` (module-level
// above) are pure contract builders that fire no connects, so `router.ts`'s app-router
// assembly against `t` keeps working unchanged.
/** Serve kolu-server's OWN two sibling surfaces (kolu + surfaceApp) on the shared
 *  `@kolu/padi` publisher, wire the runtime's deliberately-fatal `done`, and return the
 *  built router + kolu ctx. `index.ts`'s boot splices the RE-SERVED `padi` sibling into
 *  `.router.surface`; every kolu member is the reactor graph's own writer now (no
 *  ctx-write path). Call exactly once, after `padiSession`. */
export function implementKoluSurface(deps: KoluSurfaceDeps) {
  // The daemon-inventory read made TOTAL — the guard has ONE home, here beside the cell.
  // `deps.readDaemonInventory` may throw (a discovery fs-walk / session readout), and a
  // poll source's T+0 SEED throw faults the runtime's `done` → `process.exit(1)` (below),
  // crashing the whole web shell over a purely diagnostic panel. Catch → a structured
  // `log.error` (the reactor's own poll catch is a bare `console.error`, no serverId/cell
  // tag) and the honest empty default, mirroring the memory read's totality. Enumeration
  // is designed not to throw, so this is defence in depth.
  const readDaemonInventoryTotal = async (): Promise<DaemonInventory> => {
    try {
      return await deps.readDaemonInventory();
    } catch (err) {
      log.error({ err }, "daemon-inventory sample failed");
      return DEFAULT_DAEMON_INVENTORY;
    }
  };

  // ONE push `source` over the bound padi's projected `onState` — the "single onState
  // subscription" both push cells share. The source's tap is ref-counted (installed on the
  // first `scan` subscriber, torn down on the last), so the two cells' scans multicast off a
  // single `deps.onState`. A push occurrence emits SYNCHRONOUSLY (the reactor's `makeEmit`
  // `batch` → the graph-node publish `effect`, no microtask) — deliberately the PUSH arm,
  // never the reactor's microtask-deferred POLL arm, whose read must gate on padi's honest
  // `currentState().phase` (never a `currentClient()` pointer reassigned mid-frame). The source has
  // no `initial` (its bare level is honestly `T | undefined`); each cell's SCAN carries its
  // own exact-`T` honest seed below, so no fabricated `undefined` ever reaches the wire.
  //
  // SEED INVARIANT (why two scans over one ref-counted source is safe): `source.subscribe`
  // does NOT replay its current level, so only `padiLink`'s scan (the FIRST subscriber,
  // which installs the tap) folds the install-time `onState` emission; `processStartedAt`'s
  // scan subscribes second and keeps its own `startedAtSeed`. That is correct ONLY because
  // padi is still WARMING when this runs — `index.ts` calls `implementKoluSurface`
  // synchronously right after a fire-and-forget local `pin()`, so the async dial has not
  // completed, `padiStartedAt()` is `null`, and the install-time emission carries
  // `{ padi: null }` — byte-equal to `startedAtSeed`, so the second scan misses nothing.
  // Both cells then track every LATER `onState` (both subscribed). This warming precondition
  // is not left to chance: `index.ts` ENFORCES it fail-fast (asserts `padiStartedAt()` is
  // `null`) right before calling this — a future change that awaits the pin trips at boot,
  // not silently. The fix then is to seed both scans from a live snapshot, not to relax it.
  const padiRail = source<PadiRailState>(deps.onState);
  // Each push cell's honest pre-first-onState seed, typed EXACTLY as the cell's `T` (so the
  // scan's level is `DerivedCell<T>`, not a literal-widened `string`): `padiLink` at the
  // gate-closed `connecting`; `processStartedAt` with kolu-server's own boot epoch known
  // (`serverStartedAt`) and padi's genuinely not yet (`null`) — no `0` sentinel (#1034).
  const linkSeed: PadiLink = "connecting";
  const startedAtSeed: ProcessStartedAt = {
    server: serverStartedAt,
    padi: null,
  };

  // Typed against `koluSurface.spec` so every member is inferred per-entry
  // (`SurfaceDepsFor`/`ImplementSurfaceDeps` carry the spec types since #1197/#1201 — full
  // inline inference, no cast anywhere). The two DERIVED poll cells fold padi's readouts
  // on a fused cadence; the two PUSH cells scan the shared `onState`; `preferences` is the
  // one Conf-backed store. Each derived member is the reactor graph's one writer — no ctx
  // entry, its `equals` at the spec (the one wire dedup point).
  const koluDeps: ImplementSurfaceDeps<typeof koluSurface.spec> = {
    cells: {
      preferences: {
        store: preferencesStore,
        // Content-level dedup, mirroring the `session` cell. Defence in depth behind
        // the client's coalescing + no-op drop (#1041): a patch that doesn't change
        // the value skips the `state.json` write and the bus publish, so it can't
        // contend with the session autosave on the shared Conf store. `JSON.stringify`
        // is fine — Preferences is small and writes are rare once the client settles.
        equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        // Log only patched keys — values may carry user-identifying state (themes,
        // file paths in rightPanel.tab) that have no business in operator logs.
        onMutate: (patch) =>
          log.info(
            {
              keys: Object.keys(patch),
              rightPanel: patch.rightPanel
                ? Object.keys(patch.rightPanel)
                : undefined,
            },
            "preferences update",
          ),
      },
      // Live metric — a DERIVED POLL cell. Its read folds padi's `{ padi, kaval }` off the
      // re-serve mirror onto kolu-server's own RSS; its `install` fuses the 5s interval
      // with `deps.onState` so a padi drop reports `absent` at once (#1831). Whole-MB
      // `equals` at the spec; the graph is the one writer.
      processMemory: derived.cell(
        source({
          read: () => sampleServerMemory(deps.readPadiMemory),
          install: everyMsOr(MEMORY_SAMPLE_INTERVAL_MS, deps.onState),
        }),
      ),
      // Live signal — a DERIVED PUSH cell scanning the shared `onState`: each state change
      // folds to the projected `link`. Seeded at the gate-closed `connecting` (the scan's
      // exact-`T` honest initial — the real warming phase at boot too). `equals` at the spec
      // dedups a repeated same-link transition. The reactor graph is the one writer.
      padiLink: derived.cell(
        scan<PadiRailState, PadiLink>(padiRail, linkSeed, (_prev, s) => s.link),
      ),
      // Live signal — a DERIVED PUSH cell scanning the SAME shared `onState`: kolu-server's
      // own boot time + the bound padi's honest boot time (`null` while unbound). Seeded
      // `startedAtSeed`. `equals` at the spec. The reactor graph is the one writer.
      processStartedAt: derived.cell(
        scan(padiRail, startedAtSeed, (_prev, s) => ({
          server: serverStartedAt,
          padi: s.padiStartedAt,
        })),
      ),
      // Live diagnostic — a DERIVED POLL cell. Its read enumerates the host daemons + the
      // bound padi's identity/convergence (TOTAL-wrapped above); its `install` fuses the
      // 10s interval with `deps.onState` so a padi (re)bind refreshes version/convergence
      // at once. Structural `equals` at the spec; the graph is the one writer.
      daemonInventory: derived.cell(
        source({
          read: readDaemonInventoryTotal,
          install: everyMsOr(DAEMON_INVENTORY_SAMPLE_INTERVAL_MS, deps.onState),
        }),
      ),
    },
  };

  // The two SIBLING surfaces kolu-server OWNS, multiplexed over one transport
  // (kolu#1197): kolu's own primitives under the `kolu` key, and surface-app's
  // COMPLETE surface (the buildInfo cell + the `identity.info` restart probe) under
  // `surfaceApp`. They are NOT merged — `implementSurfaces` keys each surface,
  // serving them at `/surface/kolu/…` and `/surface/surfaceApp/…`. The third
  // sibling, `padi`, is NOT implemented here: `index.ts`'s async boot RE-SERVES it
  // off a bound padi process and splices it into this fragment under `/surface/padi/*`.
  //
  // kolu seeds the buildInfo cell with `{ commit }` and patches `version` over it.
  // `surfaceAppServer` returns the buildInfo cell carrying `.connect` — the surface
  // runtime fires it once the cell ctx is built, republishing the resolved
  // `{ commit, version }` (server-pushed, so the `srv` rail fills in without a
  // client reload). The connector is an OWNED source now: a fault reaches the
  // runtime's `done` (routed to kolu's fatal policy below), never floats.
  //
  // ON PUBLISHER: kolu serves on the SHARED `@kolu/padi` publisher (its
  // cross-channel microtask order is load-bearing — the terminal-list vs.
  // per-terminal-exit ordering pinned by `kill.feature`), so the runtime does
  // NOT own the channel's lifetime. Distinct constructor, not a mode flag.
  const koluSurfaces = implementSurfacesOnPublisher(
    // The padi-LESS `surfaces` map (`{ kolu, surfaceApp }`) — kolu-server implements
    // only its own two siblings; the `padi` sibling's IMPL comes from the re-serve
    // (spliced in `index.ts`), and the client's wire contract stays unchanged
    // because the client dials padi through the map client, not this static router.
    surfaces,
    {
      channel: <T>(name: string) => publisherChannel<T>(publisher, name),

      // Default subsequent-read error handler for poll-shape streams.
      onStreamReadError: (err, info) =>
        log.error(
          { err: err instanceof Error ? err.message : String(err), ...info },
          "stream snapshot read failed",
        ),
    },
    {
      // ── surface-app's server deps (sibling under `surfaceApp`) ───────────
      // The build-identity cell's server fragment (skew axis) PLUS the
      // `identity.info` restart probe pinned to kolu's boot UUID. `commit` is
      // kolu's single source (`serverCommit` ← `KOLU_COMMIT_HASH`); `version`
      // lands as a `Partial<KoluBuildInfo>` patch over the library-seeded
      // `{ commit }`. Per-key deps are typed against the surface's own spec, so
      // this needs no cast.
      surfaceApp: surfaceAppServer<KoluBuildInfo>({
        buildInfo: async () => ({ version: serverVersion }),
        commit: serverCommit,
        // surface-app's identity probe (restart axis) —
        // `surface.surfaceApp.identity.info`. Pin it to the existing boot UUID
        // (`serverProcessId`) so the value is stable within a process and
        // changes on restart. Composed, not hand-written.
        processId: serverProcessId,
        // `version` is a build constant — this read can't fail — but keep the
        // fragment's error sink for the cell's contract.
        onError: (err) =>
          log.error(
            { err: err instanceof Error ? err.message : String(err) },
            "buildInfo version axis failed",
          ),
      }),

      // ── kolu's own server deps (sibling under `kolu`) ────────────────────
      // The one Conf-backed store cell (`preferences`) + the two DERIVED PUSH cells
      // scanning `onState` (`padiLink`/`processStartedAt`) + the two DERIVED poll cells
      // (`processMemory`/`daemonInventory`) — every one built above in THIS file (SR8.c),
      // the reactor graph its own writer. Every terminal-derived member rides the
      // re-served `padi` sibling.
      kolu: koluDeps,
    },
  );

  // Observe the surface runtime's `done` and route it into kolu-server's EXISTING
  // deliberately-fatal fault policy (the same disposition a floated cell-connector
  // rejection reached via the process `unhandledRejection` handler before, and the
  // same fatal treatment the default padi re-serve's `done` gets in `index.ts`): an
  // owned surface fault is unrecoverable for the web shell, so crash loud. The
  // DISPOSITION is unchanged — only the route (owned `done` instead of a floated
  // rejection). Byte-identical in the no-fault steady state.
  koluSurfaces.done.catch((err) => {
    log.fatal({ err }, "kolu surface runtime faulted — unrecoverable");
    process.exit(1);
  });

  // NB: the runtime's `close` is intentionally NOT returned. kolu-server's web-shell
  // runtime is process-lifetime (built once in boot, lives exactly as long as the
  // process), and its graceful shutdown is a SYNCHRONOUS signal handler
  // (`index.ts` → `process.exit(0)`). For a process-lifetime owner, process death IS
  // the teardown; the runtime's only owned source (the surface-app buildInfo
  // connector) is released by process exit. Returning a `close` nobody calls would be
  // a dead knob, and awaiting it inside the sync signal handler would add a
  // shutdown-hang risk (a parked connector) for zero real benefit. `done` (above) is
  // still observed — the fault channel is what matters here, not teardown.
  // The kolu+surfaceApp FINAL surface router. Its `.surface` is the built
  // `{ kolu, surfaceApp }` sibling map — `index.ts`'s async boot splices the RE-SERVED
  // `padi` sibling in beside them (`{ surface: { ...router.surface, padi } }`) and
  // assembles the final host router. padi is async (an `await`ed binding), so it can't be
  // composed here. Every member is the reactor graph's own writer now (the poll cells'
  // reads + the push cells' `scan`s over the shared `onState` source), so NO ctx is
  // returned — the caller only splices the router.
  return {
    router: koluSurfaces.router as { surface: Record<string, unknown> },
  };
}
