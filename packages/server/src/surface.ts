/**
 * Server-side surface implementation — single source of truth for kolu-server's
 * OWN typed reactive layer (the `kolu` + `surfaceApp` siblings).
 *
 * As of the W2.2 cutover kolu-server serves NO terminal domain: `padiSurface` is
 * RE-SERVED off a bound padi PROCESS (see `padiBinding.ts` + the async boot in
 * `index.ts`), not implemented in-process here. So this file implements only the
 * two siblings kolu-server owns and exports the kolu+surfaceApp FINAL surface
 * router (`koluSurfaceRouter`, a supervised {@link SurfaceRuntime}) for `index.ts`
 * to splice the re-served `padi` sibling into, plus the `t` builder `router.ts`
 * binds kolu-server's remaining raw RPCs (`server`/`daemon`/`hosts`) against. The
 * surface is finalized by `implementSurfacesOnPublisher`, not by a local
 * `implement(servedContract)` (retired at SRT-PR1 — the runtime returns a final
 * router; routing is by the assembled object, so the padi splice needs no widened
 * contract).
 *
 *   - The kolu surface's mutation ctx is built here and EXPORTED as
 *     `koluSurfaceCtx` (only the memory sampler in `index.ts` writes it —
 *     `processMemory` — so a plain export off the built ctx suffices; no
 *     late-bound holder).
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
  confStore,
  type ImplementSurfaceDeps,
  implementSurfacesOnPublisher,
  publisherChannel,
} from "@kolu/surface/server";
import { surfaceAppServer } from "@kolu/surface-app/server";
import { implement } from "@orpc/server";
import { contract } from "kolu-common/contract";
import type {
  DaemonInventory,
  KoluBuildInfo,
  PadiLink,
  Preferences,
  ProcessMemory,
  ProcessRss,
  ProcessStartedAt,
} from "kolu-common/surface";
import {
  bytesToWholeMB,
  DEFAULT_DAEMON_INVENTORY,
  type koluSurface,
  surfaces,
} from "kolu-common/surface";
import {
  serverCommit,
  serverProcessId,
  serverStartedAt,
  serverVersion,
} from "./hostname.ts";
import { log } from "./log.ts";
import { store } from "./state.ts";

// `t` is the builder for kolu-server's RAW root RPCs — `server.info`,
// `daemon.restart`, `hosts.*` — which are NOT surface members and so need their
// own oRPC builder. It binds against the padi-less kolu-common `contract` (the
// same one the client consumes, byte-for-byte).
//
// The SURFACE is no longer finalized here: `implementSurfacesOnPublisher`
// (below) returns a FINAL top-level router for the `kolu` + `surfaceApp`
// siblings, and `index.ts` splices the RE-SERVED `padi` sibling into its
// `.surface` as a plain router object. The old `servedContract` superset — a
// `padi`-widened contract built solely to finalize the surface via `t` — is gone
// (the SRT-PR1 deletion): routing is driven by the assembled router object, not a
// widened contract, so the spliced padi routes without the widening (proved by
// the padiBinding integration test dialing `/surface/padi/*`).
export const t = implement(contract);

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

// ── processMemory cell: live metric, in-memory backing + whole-MB dedup ──
//
// Defined here beside the cell entry, not in `memorySampler.ts`: the cell's
// storage shape and dedup predicate are the surface layer's concern. The sampler
// only reads+publishes via the injected `publish` (→ `koluSurfaceCtx.cells.
// processMemory.set` → `set` below).
//
// W2.2 re-scope: the cell now carries kolu-server's OWN RSS plus padi's folded-in
// `{ padi, kaval }` reading (kaval lives inside the padi PROCESS now, so padi —
// not kolu-server — polls it; the sampler reads padi's readout off the re-serve).
// Each is the honest three-way, so `absent`/`error` never collapse to a fake zero.

/** Two per-process RSS readings render the same whole-MB figure — same status and,
 *  when `ok`, the same whole megabytes (an `absent`/`error` pair carries no number
 *  to compare). */
function rssMbEqual(a: ProcessRss, b: ProcessRss): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "ok" && b.status === "ok") {
    return bytesToWholeMB(a.rssBytes) === bytesToWholeMB(b.rssBytes);
  }
  return true;
}

/** Two readouts are equal when all three processes render the same whole-MB figure
 *  — the cell's `equals`, so a sub-MB RSS wobble never re-publishes to every
 *  connected client. Built on the shared {@link bytesToWholeMB} so the dedup
 *  boundary and the client's rendered figure are one computation. */
export function processMemoryMbEqual(
  a: ProcessMemory,
  b: ProcessMemory,
): boolean {
  return (
    bytesToWholeMB(a.serverRssBytes) === bytesToWholeMB(b.serverRssBytes) &&
    rssMbEqual(a.padi, b.padi) &&
    rssMbEqual(a.kaval, b.kaval)
  );
}

/** In-memory backing for the `processMemory` cell. The sampler writes through
 *  `koluSurfaceCtx.cells.processMemory.set` (→ `set` here, then publish); a fresh
 *  subscription reads the latest via `get`. No persistence — a live metric has
 *  no on-disk slot. */
let currentProcessMemory: ProcessMemory = {
  serverRssBytes: 0,
  padi: { status: "absent" },
  kaval: { status: "absent" },
};
const memoryCellStore = {
  get: (): ProcessMemory => currentProcessMemory,
  set: (value: ProcessMemory): void => {
    currentProcessMemory = value;
  },
};

// ── padiLink cell: kolu-server's live view of its binding to padi ────────
//
// Server-authored (kolu-server drives it off `padiSession.onState` in `index.ts`);
// the client folds it into the warming/degraded canvas so a padi drop shows an honest
// connecting state, never a frozen re-served daemonStatus (#1034). A live signal, so
// the backing is in-memory (no on-disk slot); a fresh subscription reads the latest via
// `get`, seeded at the gate-closed `connecting` before the first transition.
let currentPadiLink: PadiLink = "connecting";
const padiLinkCellStore = {
  get: (): PadiLink => currentPadiLink,
  set: (value: PadiLink): void => {
    currentPadiLink = value;
  },
};

// ── processStartedAt cell: kolu-server + padi boot times for the rail's uptime ──
//
// Server-authored (kolu-server drives it off `padiSession.onState` in `index.ts`,
// the SAME subscription that drives `padiLink`); the client renders `now − startedAt`
// as each process's uptime. A live signal, so the backing is in-memory (no on-disk
// slot). `server` is seeded to `serverStartedAt` (`./hostname.ts`'s module-init
// `Date.now()`) — the REAL boot epoch is already known at seed time, so there is no
// pre-yield gap to paper over with an in-band `0` sentinel (#1034: `0` is a real, if
// absurd, timestamp, not a safe "unknown" marker). `padi` genuinely ISN'T known yet
// (no padi session has bound), so it stays the honest `null` until the first
// `onState` yield — never a fabricated boot time.
let currentProcessStartedAt: ProcessStartedAt = {
  server: serverStartedAt,
  padi: null,
};
const processStartedAtCellStore = {
  get: (): ProcessStartedAt => currentProcessStartedAt,
  set: (value: ProcessStartedAt): void => {
    currentProcessStartedAt = value;
  },
};

// ── daemonInventory cell: the host-daemon inventory (kaval + padi enumeration) ──
//
// Server-authored diagnostic readout — the read-only inventory sampler
// (`daemonInventory.ts`, wired in `index.ts`) is the sole writer via
// `koluSurfaceCtx.cells.daemonInventory.set`; clients read-only. A live signal, so the
// backing is in-memory (no on-disk slot); a fresh subscription reads the latest via
// `get`, seeded at the honest empty-lists default before the first sample.
let currentDaemonInventory: DaemonInventory = DEFAULT_DAEMON_INVENTORY;
const daemonInventoryCellStore = {
  get: (): DaemonInventory => currentDaemonInventory,
  set: (value: DaemonInventory): void => {
    currentDaemonInventory = value;
  },
};

// ── kolu's own-surface implementation deps (concretely typed) ───────────
//
// Typed against `koluSurface.spec` so every stream `read(input)` / collection
// reader / cell `store` is inferred. `implementSurfaces` itself `any`-specs its
// entry deps (the surface map is heterogeneous, so it can't carry each spec
// through), so we type-check kolu's deps HERE at construction and cast only at
// the entry boundary below — the same pattern the example server and the
// `implementSurfaces` test use.
const koluDeps: Omit<
  ImplementSurfaceDeps<typeof koluSurface.spec>,
  "channel"
> = {
  cells: {
    preferences: {
      store: preferencesStore,
      // Content-level dedup, mirroring the `session` cell below. Defence in
      // depth behind the client's coalescing + no-op drop (#1041): a patch
      // that doesn't change the value skips the `state.json` write and the
      // bus publish, so it can't contend with the session autosave on the
      // shared Conf store. `JSON.stringify` is fine — Preferences is small
      // and writes are rare once the client stops storming.
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      // Log only patched keys — values may carry user-identifying state
      // (themes, file paths in rightPanel.tab) that have no business in
      // operator logs.
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
    processMemory: {
      // Live metric; the in-memory store has no persistent slot. The sampler
      // (`memorySampler.ts`) is the sole writer via `koluSurfaceCtx.cells.
      // processMemory.set`. `equals` dedups at whole-MB granularity so a sub-MB
      // RSS wobble never re-publishes to every connected client.
      store: memoryCellStore,
      equals: processMemoryMbEqual,
    },
    padiLink: {
      // Live signal; the in-memory store has no persistent slot. The bound-padi
      // `onState` subscription (`index.ts`) is the sole writer via
      // `koluSurfaceCtx.cells.padiLink.set`. `equals` dedups so a repeated
      // same-state transition (onState fires once per endpoint status, and several
      // map to the same padiLink) never re-publishes to every connected client.
      store: padiLinkCellStore,
      equals: (a, b) => a === b,
    },
    processStartedAt: {
      // Live signal; the in-memory store has no persistent slot. The bound-padi
      // `onState` subscription (`index.ts`) is the sole writer via
      // `koluSurfaceCtx.cells.processStartedAt.set`. `equals` dedups so a transition
      // that leaves both boot times unchanged (onState fires per endpoint status;
      // several keep the same connected padi) never re-publishes to every client.
      store: processStartedAtCellStore,
      equals: (a, b) => a.server === b.server && a.padi === b.padi,
    },
    daemonInventory: {
      // Live diagnostic signal; the in-memory store has no persistent slot. The
      // read-only inventory sampler (`daemonInventory.ts`, `index.ts`) is the sole
      // writer via `koluSurfaceCtx.cells.daemonInventory.set`. `equals` dedups a
      // structurally-identical re-enumeration (the daemon set changes rarely) so a
      // steady-state tick never re-publishes to every connected client — a shallow
      // JSON compare is fine (the lists are tiny, a handful of daemons at most).
      store: daemonInventoryCellStore,
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
  },
};

// ── Surface implementation ─────────────────────────────────────────────

const koluSurfaces =
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
  implementSurfacesOnPublisher(
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
      // Just the `preferences` + `processMemory` cells — every terminal-derived
      // member rides the re-served `padi` sibling.
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

// The kolu+surfaceApp FINAL surface router. Its `.surface` is the built
// `{ kolu, surfaceApp }` sibling map — exported so `index.ts`'s async boot can
// splice the RE-SERVED `padi` sibling in beside them
// (`{ surface: { ...koluSurfaceRouter.surface, padi } }`) and assemble the final
// host router. padi is async (an `await`ed binding), so it cannot be composed
// here at module-eval — hence the split.
export const koluSurfaceRouter = koluSurfaces.router as {
  surface: Record<string, unknown>;
};
// The kolu surface ctx (`implementSurfacesOnPublisher(...).ctx.kolu`) — exported so
// the memory sampler (`index.ts`) writes `processMemory` through it. Only
// kolu-server's own web shell writes koluSurface now (padi domain code lives in
// padi's process), so a plain export off the built ctx suffices.
export const koluSurfaceCtx = koluSurfaces.ctx.kolu;
// NB: the runtime's `close` is intentionally NOT exported. kolu-server's web-shell
// runtime is process-lifetime (a module-eval singleton that lives exactly as long
// as the process), and its graceful shutdown is a SYNCHRONOUS signal handler
// (`index.ts` → `process.exit(0)`). For a process-lifetime owner, process death IS
// the teardown; the runtime's only owned source (the surface-app buildInfo
// connector) is released by process exit. Exporting a `close` nobody calls would be
// a dead knob, and awaiting it inside the sync signal handler would add a
// shutdown-hang risk (a parked connector) for zero real benefit. `done` (above) is
// still observed — the fault channel is what matters here, not teardown.
