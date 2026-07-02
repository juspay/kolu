/**
 * Server-side surface implementation — single source of truth for the
 * typed reactive layer.
 *
 *   - `surfaceRouter` — `oc.router({ surface: {...} })` fragment for the
 *     host router; spread alongside hand-listed raw oRPC procedures in
 *     `router.ts`.
 *   - The typed `cells / collections / events` mutation map (`surfaceCtx`)
 *     is built here and registered into `./surfaceCtx.ts` via
 *     `setSurfaceCtx(...)`. Domain modules (`activity.ts`, `session.ts`,
 *     `terminalEndpoint/local.ts`, `terminalEndpoint/metadata.ts`) import
 *     `surfaceCtx` from `./surfaceCtx.ts` — not from here — and call
 *     `surfaceCtx.cells.X.set(...)`, `.collections.X.upsert(k, v)`,
 *     `.events.X.publish(i, p)`. The framework owns the apply+publish
 *     chain; domain code never sees a channel name string. Routing the
 *     ctx through `./surfaceCtx.ts` is what breaks the bidirectional
 *     import cycle that would otherwise form (#1005).
 *
 * Publisher channel names are framework-derived in two layers. Each surface
 * names its own channels by primitive: `<prim>:changed` for cells,
 * `<prim>:keys` + `<prim>:<key>` for collections,
 * `<prim>:<JSON.stringify(input)>` for events. `implementSurfaces` then
 * key-namespaces every name with its sibling key before it reaches the shared
 * publisher — so the wire publisher actually sees `kolu/preferences:changed`,
 * `surfaceApp/buildInfo:changed`, etc. The `<sibling>/` prefix is what keeps
 * two siblings that each own a same-named primitive from colliding on one
 * publisher.
 *
 * `confStore`-backed cells (`preferences`, `activityFeed`, `session`) live
 * here so this file is the only one that knows the on-disk layout. Domain
 * modules read current values via `surfaceCtx.cells.X.get()` and write via
 * `.set()`; they do not import `store` directly.
 */

import {
  type CellStore,
  composeSurfaceContracts,
  confStore,
  type ImplementSurfaceDeps,
  implementSurfaces,
  publisherChannel,
} from "@kolu/surface/server";
import { surfaceAppServer } from "@kolu/surface-app/server";
import { surfacesWithPadi } from "@kolu/padi/surface";
import { oc } from "@orpc/contract";
import {
  quietActivity,
  serveTerminalWorkspace,
} from "@kolu/terminal-workspace/serveTerminalWorkspace";
import { implement } from "@orpc/server";
import { contract } from "kolu-common/contract";
import type {
  ActivityFeed,
  KoluBuildInfo,
  Preferences,
  ProcessMemory,
  SavedSession,
} from "kolu-common/surface";
import {
  bytesToWholeMB,
  type koluSurface,
  LOCAL_LOCATION,
} from "kolu-common/surface";
import { serverCommit, serverProcessId, serverVersion } from "./hostname.ts";
import { log } from "./log.ts";
import {
  buildPadiSurfaceDeps,
  cancelPendingAutosave,
  getSavedSession,
  getTerminal,
  listTerminals,
  publisher,
  registryMap,
  resolveTerminalEndpoint,
  setPadiSurfaceCtx,
  setSurfaceCtx,
  setWorkspaceSurfaceCtx,
  terminalNotFound,
} from "@kolu/padi/assembly";
import { store } from "./state.ts";

// Resolved through the one `HostLocation` seam (R9.1). Eager at module-eval,
// exactly as the prior direct reference was — the late-bound surface ctx
// (#1005) is what keeps that read TDZ-safe across ESM load orders.
const localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION);

// kolu-server serves a SUPERSET contract locally: the padi-less kolu-common
// `contract` (which the client consumes, byte-for-byte unchanged) PLUS the
// `padi` sibling. Spreading the already-built `contract` carries over its root
// namespaces (`server`/`daemon` — `terminal`/`git` were deleted at W1.R7, their
// mutations now on `padiSurface`) and its 3-sibling `surface`;
// the second spread of `composeSurfaceContracts(surfacesWithPadi)` then WIDENS
// `surface` to four siblings (adds `padi`). This is the same spread idiom
// `packages/common/src/contract.ts` assembles itself with — that file stays
// untouched (its own comment already anticipates kolu-server widening locally).
const servedContract = oc.router({
  ...contract,
  ...composeSurfaceContracts(surfacesWithPadi),
});

// `t` is the host router builder against the SERVED (superset) contract; both
// `surfaceRouter` and the raw oRPC handlers in `router.ts` plug procedures into
// it. Exported so `router.ts` can call `t.server.info.handler(...)` /
// `t.daemon.restart.handler(...)` against the same builder — every surviving
// root procedure (only `server`/`daemon` after W1.R7) survives the widening.
export const t = implement(servedContract);

// ── Stores (Conf-backed; one slot per persisted cell) ──────────────────

const preferencesStore: CellStore<Preferences> = confStore<Preferences>(
  store,
  "preferences",
);
const activityFeedStore: CellStore<ActivityFeed> = confStore<ActivityFeed>(
  store,
  "activityFeed",
);
const savedSessionStore: CellStore<SavedSession | null> =
  confStore<SavedSession | null>(store, "session");

// ── processMemory cell: live metric, in-memory backing + whole-MB dedup ──
//
// Defined here beside the cell entry (mirroring `terminalList`), not in
// `memorySampler.ts`: the cell's storage shape and dedup predicate are the
// surface layer's concern. The sampler only reads+publishes via the injected
// `publish` (→ `surfaceCtx.cells.processMemory.set` → `set` below).

/** The whole-MB rail figure of the kaval reading, plus its discriminant — a
 *  comparison key that distinguishes `absent`/`error`/`ok@N MB` from each other,
 *  so the dedup never folds an `error` state into an `absent` one (or vice
 *  versa). `ok` carries its whole-MB figure (the rail's granularity) so a sub-MB
 *  wobble within `ok` still dedups. Built on the shared {@link bytesToWholeMB} so
 *  the dedup boundary and the client's rendered figure are one computation. */
function kavalMemoryKey(m: ProcessMemory["kavalMemory"]): string {
  return m.status === "ok" ? `ok:${bytesToWholeMB(m.rssBytes)}` : m.status;
}

/** Two readouts are equal when they render the same whole-MB rail figures AND the
 *  same kaval state — the cell's `equals`, so a sub-MB RSS wobble never
 *  re-publishes, but a state transition (absent → error, ok → absent) always
 *  does. */
export function processMemoryMbEqual(
  a: ProcessMemory,
  b: ProcessMemory,
): boolean {
  return (
    bytesToWholeMB(a.serverRssBytes) === bytesToWholeMB(b.serverRssBytes) &&
    kavalMemoryKey(a.kavalMemory) === kavalMemoryKey(b.kavalMemory)
  );
}

/** In-memory backing for the `processMemory` cell. The sampler writes through
 *  `surfaceCtx.cells.processMemory.set` (→ `set` here, then publish); a fresh
 *  subscription reads the latest via `get`. No persistence — a live metric has
 *  no on-disk slot, mirroring the `terminalList` cell. */
let currentProcessMemory: ProcessMemory = {
  serverRssBytes: 0,
  kavalMemory: { status: "absent" },
};
const memoryCellStore = {
  get: (): ProcessMemory => currentProcessMemory,
  set: (value: ProcessMemory): void => {
    currentProcessMemory = value;
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
    activityFeed: { store: activityFeedStore },
    session: {
      // Reads through `getSavedSession` to keep the "empty terminals = null"
      // legacy normalization at one site (`session.ts` owns that invariant).
      store: { get: () => getSavedSession(), set: savedSessionStore.set },
      // Content-level dedup. The surface cell otherwise publishes a fresh
      // object reference on every set, including byte-identical re-saves
      // from the autosave loop or test fixtures. Downstream that flips a
      // SolidJS keyed `<Show when={savedSession()}>` in EmptyState and
      // detaches the restore button mid-frame. `JSON.stringify` is fine
      // for this cell — SavedSession is small (a handful of terminals
      // and scalars) and sets are rare. See
      // `docs/flaky-tests-ralph-report-2.md` cycles 3 / 5.
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      // Atomic cross-cell invariant: every write to the session cell —
      // `set`, `patch`, `test__set`, or the server-internal
      // `surfaceCtx.cells.session.set` reached by `writeSession` —
      // cancels any pending `saveSession([])` autosave callback armed by
      // a recent `terminals:dirty` event. Without this, the surface
      // `test__set` verb used by the e2e harness bypasses the named
      // `setSavedSession` and a stale killAll-time dirty event can
      // clobber a freshly POSTed session with `null` ~500 ms later
      // (cycle 6). Harmless no-op on the autosave loop's own write path
      // (the loop clears the timer synchronously before calling
      // `saveSession`); future dirty events arm a fresh timer normally.
      onWrite: () => cancelPendingAutosave(),
    },
    terminalList: {
      // Live registry; the in-memory store has no persistent slot.
      store: { get: () => listTerminals(), set: () => {} },
    },
    processMemory: {
      // Live metric; the in-memory store has no persistent slot. The sampler
      // (`memorySampler.ts`) is the sole writer via `surfaceCtx.cells.
      // processMemory.set`. `equals` dedups at whole-MB granularity so a sub-MB
      // RSS wobble never re-publishes to every connected client.
      store: memoryCellStore,
      equals: processMemoryMbEqual,
    },
  },

  events: {
    terminalExit: {
      // Single-yield-then-close: validate the terminal exists at subscribe
      // time. `terminalNotFound` throws a typed `ORPCError("NOT_FOUND")` — not
      // a bare Error, which oRPC would scrub to an opaque "Internal server
      // error" — so the client's
      // exit subscription recognizes a stale-session re-subscribe and swallows
      // it instead of logging a fault; `STREAM_RETRY` does not retry an
      // `ORPCError`. Then forward the first exit-channel yield and return. The
      // `bus` helper is the framework's per-input channel — the same one
      // `surfaceCtx.events.terminalExit.publish` writes to.
      source: async function* (input, signal, { bus }) {
        if (!getTerminal(input.id)) throw terminalNotFound(input.id);
        for await (const exitCode of bus.subscribe(signal)) {
          yield exitCode;
          return;
        }
      },
    },
  },
};

// ── Surface implementation ─────────────────────────────────────────────

const { router: surfaceRouterFragment, ctx: surfaceCtxBuilt } =
  // Two SIBLING surfaces multiplexed over one transport (kolu#1197): kolu's OWN
  // primitives under the `kolu` key, and surface-app's COMPLETE surface (the
  // buildInfo cell + the `identity.info` restart probe) under `surfaceApp`. They
  // are NOT merged — `implementSurfaces` keys each surface, serving them at
  // `/surface/kolu/…` and `/surface/surfaceApp/…` with a key-namespaced channel
  // per surface (so neither's `*:changed` channels collide on the wire).
  //
  // kolu seeds the buildInfo cell with `{ commit }` and patches `version` over
  // it. `surfaceAppServer` returns the buildInfo cell carrying `.connect` — the
  // surface runtime fires it once the cell ctx is built, republishing the
  // resolved `{ commit, version }` through the same fragment when it settles
  // (server-pushed, so the `srv` rail fills in without a client reload). The
  // `expectedKaval` axis this cell once carried moved to padi's `status` cell
  // (W1.R7 — a kaval read no longer crosses `packages/server`). No app-visible
  // connect to call, no hand-written `ctx.cells.buildInfo.set`.
  implementSurfaces(
    // `surfacesWithPadi` (the keyed Surface map PLUS `padi`) is served here so
    // `padiSurface` serves BESIDE the three siblings at `/surface/padi/*`
    // (dual-serve). The contract widening above (`servedContract`) is what lets
    // the padi-less kolu-common `surfaces` the client consumes stay untouched;
    // here we add the server-only per-surface deps, keyed the same way.
    surfacesWithPadi,
    {
      channel: <T>(name: string) => publisherChannel<T>(publisher, name),

      // Default subsequent-read error handler for poll-shape streams. kolu's own
      // fs/git value streams retired at W1.R4 (the Code tab now pulse-then-
      // requeries padiSurface's procedures), so the poll-shape streams this now
      // covers are padi's `subscribeRepoChange`/`subscribeFileChange` pulses and
      // terminalWorkspace's watchers; per-stream overrides are absent so this
      // fires for every poll-shape stream.
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
      // `{ commit }`. The kaval `expectedKaval` axis this cell once carried moved
      // to padi's `status` cell (W1.R7 — a kaval read no longer crosses
      // `packages/server`). Per-key deps are typed against the surface's own spec,
      // so this needs no cast.
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
      kolu: koluDeps,

      // ── the terminal-workspace server deps (sibling under `terminalWorkspace`) ──
      // The GENERIC awareness surface (R8), assembled by the ONE shared factory
      // (`serveTerminalWorkspace`) that `pulam` also calls — the version cell + the
      // fs/git procedures + watcher streams live THERE, built off the SAME
      // in-process endpoint kolu's own value-bearing streams read. kolu injects
      // only the two volatile backings: the `awareness` collection (projected off
      // its registry) and `activity` (QUIET — no raw byte tap until R9). Typed
      // against `terminalWorkspaceSurface.spec`, so this needs no cast.
      terminalWorkspace: serveTerminalWorkspace({
        // Project the awareness half straight off the registry — `.snapshot`
        // exactly as padi's `terminals` collection composes off the same entry.
        // Writes go through the sink's
        // `installSnapshot`/`updateServer*Metadata` (which call
        // `workspaceSurfaceCtx.collections.snapshots.upsert`), so the framework's
        // `upsert`/`remove` are no-ops (the registry is the authority).
        snapshots: {
          readAll: () => registryMap((t) => t.snapshot),
          readOne: (key) => getTerminal(key as string)?.snapshot,
          upsert: () => {},
          remove: () => {},
        },
        // QUIET for now: kolu-server has no raw byte tap (R9 makes it live), so it
        // truthfully yields the empty live set — not a lie, the honest "nothing
        // known to be moving". R9 injects a live source here instead.
        activity: quietActivity,
        endpoint: localEndpoint,
        log,
      }),

      // ── padi's own server deps (sibling under `padi`) ────────────────────
      // The COMPLETE `padiSurface` served natively from `@kolu/padi` (W1.R0),
      // assembled by its own `buildPadiSurfaceDeps` off the SAME in-process
      // endpoint. Every member has a functional read/procedure/source handler
      // (boot requires it), but NO padi ctx is registered and NO write-trigger
      // fires at R0 — dual-serve, single-publish: the client still renders every
      // live delta through the kolu/terminalWorkspace/surfaceApp path. R1+ turns
      // on padi's live-publish one member at a time.
      padi: buildPadiSurfaceDeps({ endpoint: localEndpoint, log }),
    },
  );

export const surfaceRouter = surfaceRouterFragment;
// Domain modules mutate only kolu's OWN primitives, so register the `kolu`
// surface's ctx (`implementSurfaces(...).ctx.kolu`). surface-app's buildInfo is
// driven by the runtime-fired cell `.connect`, not by domain code.
setSurfaceCtx(surfaceCtxBuilt.kolu);
// The awareness sink (`terminalEndpoint/metadata.ts`) publishes onto the
// `terminalWorkspace` surface's `awareness` collection, so register that ctx too.
setWorkspaceSurfaceCtx(surfaceCtxBuilt.terminalWorkspace);
// padi's live publish. The composed-terminal seam
// (`terminalEndpoint/metadata.ts`) publishes onto padi's `terminals` collection +
// `urgency` cell, and the kaval supervisor's `publishDaemonStatus` onto padi's
// `daemonStatus` collection (W1.R7 — the last terminal-domain members left
// koluSurface, which now serves NO collections). The terminalWorkspace
// `snapshots` collection stays served for the generic awareness surface.
setPadiSurfaceCtx(surfaceCtxBuilt.padi);
