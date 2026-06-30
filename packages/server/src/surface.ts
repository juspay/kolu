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
  confStore,
  type ImplementSurfaceDeps,
  implementSurfaces,
  publisherChannel,
} from "@kolu/surface/server";
import { surfaceAppServer } from "@kolu/surface-app/server";
import {
  quietActivity,
  quietTerminalEvents,
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
  surfaces,
} from "kolu-common/surface";
import {
  type FsReadFileOutput,
  fsListAllOutputEqual,
  fsReadFileOutputEqual,
  gitDiffOutputEqual,
  gitStatusOutputEqual,
} from "kolu-git";
import { isBinaryPreviewable } from "kolu-common/preview";
import { serverCommit, serverProcessId, serverVersion } from "./hostname.ts";
import { buildIframePreviewUrl } from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import { publisher } from "./publisher.ts";
import { cancelPendingAutosave, getSavedSession } from "./session.ts";
import { store } from "./state.ts";
import { setSurfaceCtx } from "./surfaceCtx.ts";
import { setWorkspaceSurfaceCtx } from "./workspaceSurfaceCtx.ts";
import {
  getTerminal,
  listTerminals,
  registryMap,
  terminalNotFound,
} from "./terminal-registry.ts";
import {
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
// kaval's OWN identity assembler — read in the SERVER process it returns the
// server's baked KAVAL_BUILD_ID/KAVAL_COMMIT_HASH (the build the server would
// spawn), i.e. the *expected* kaval. Distinct from the connected daemon's
// *reported* identity, which rides `daemonStatus.identity`, not buildInfo.
import { currentPtyHostIdentity as expectedKavalIdentity } from "kaval";

// Resolved through the one `HostLocation` seam (R9.1). Eager at module-eval,
// exactly as the prior direct reference was — the late-bound surface ctx
// (#1005) is what keeps that read TDZ-safe across ESM load orders.
const localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION);

// `t` is the host router builder; both `surfaceRouter` and the raw oRPC
// handlers in `router.ts` plug procedures into it. Exported so `router.ts`
// can call `t.terminal.create.handler(...)` etc. against the same builder.
export const t = implement(contract);

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

  collections: {
    authored: {
      // Design-S: kolu serves the AUTHORED half (location + client chrome + the
      // active|sleeping discriminant) straight off the registry — NO awareness,
      // NO compose. The AWARENESS half rides the sibling
      // `terminalWorkspace.snapshots` collection below, and the client joins the
      // two at read time (`useTerminalMetadata`). There is no server-side
      // re-fusion: the wire never carries a single fused record.
      readAll: () => registryMap((t) => t.meta),
      readOne: (key) => getTerminal(key as string)?.meta,
      // Server-internal collection: clients can't write. The registry IS the
      // store, so the `upsert`/`remove` no-ops only fan out to subscribers —
      // `terminalEndpoint/metadata.ts` calls `surfaceCtx.collections.authored
      // .upsert` on every authored flip (spawn / sleep / wake / client field).
      upsert: () => {},
      remove: () => {},
    },

    daemonStatus: {
      readAll: () => readDaemonStatuses(),
      readOne: (key) => readDaemonStatus(key as string),
      // Server-internal: `publishDaemonStatus` writes the store before calling
      // `surfaceCtx.collections.daemonStatus.upsert`, so these are no-ops (the
      // store is the authority, mirroring `authored`).
      upsert: () => {},
      remove: () => {},
    },
  },

  streams: {
    // fs/git streams are per-host one-shot ops bound to this endpoint. For now
    // they read the LOCAL endpoint off the `localEndpoint` alias
    // (`resolveTerminalEndpoint(LOCAL_LOCATION)`); R9.5's Code-tab rewrite makes
    // them resolve per-terminal so a remote tile's fs/git dials its host behind
    // the same TerminalEndpointFs / TerminalEndpointGit seam.
    gitStatus: {
      read: async (input) =>
        localEndpoint.git.getStatus(input.repoPath, input.mode),
      install: (input, cb) =>
        localEndpoint.fs.subscribeRepoChange(input.repoPath, cb),
      isEqual: gitStatusOutputEqual,
    },
    gitDiff: {
      read: async (input) =>
        localEndpoint.git.getDiff(
          input.repoPath,
          input.filePath,
          input.mode,
          input.oldPath,
        ),
      install: (input, cb) =>
        localEndpoint.fs.subscribeRepoChange(input.repoPath, cb),
      isEqual: gitDiffOutputEqual,
    },
    fsListAll: {
      read: async (input) => localEndpoint.fs.listAll(input.repoPath),
      install: (input, cb) =>
        localEndpoint.fs.subscribeRepoChange(input.repoPath, cb),
      isEqual: fsListAllOutputEqual,
    },
    fsReadFile: {
      read: async (input): Promise<FsReadFileOutput> => {
        if (isBinaryPreviewable(input.filePath)) {
          const mtimeMs = await localEndpoint.fs.statFileMtimeMs(
            input.repoPath,
            input.filePath,
          );
          return {
            kind: "binary",
            url: buildIframePreviewUrl(
              input.terminalId,
              input.filePath,
              mtimeMs,
            ),
          };
        }
        const { content, truncated } = await localEndpoint.fs.readFile(
          input.repoPath,
          input.filePath,
        );
        return { kind: "text", content, truncated };
      },
      install: (input, cb) =>
        localEndpoint.fs.subscribeFileChange(
          input.repoPath,
          input.filePath,
          cb,
        ),
      isEqual: fsReadFileOutputEqual,
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
  // kolu seeds the buildInfo cell with `{ commit }` and patches the rest
  // (`version` + `expectedKaval`) over it. `surfaceAppServer` returns the
  // buildInfo cell carrying `.connect` — the surface runtime fires it once the
  // cell ctx is built, republishing the resolved `{ commit, version,
  // expectedKaval }` through the same fragment when it settles (server-pushed,
  // so the `srv · kaval` rail fills in without a client reload). `expectedKaval`
  // is the server's OWN baked build constant, not the connected daemon's
  // reported identity (that rides `daemonStatus.identity`). No app-visible
  // connect to call, no hand-written `ctx.cells.buildInfo.set`.
  implementSurfaces(
    // `surfaces` (the keyed Surface map) is the single source shared with the
    // contract (`composeSurfaceContracts`) and the client (`surfaceClients`);
    // here we add only the server-only per-surface deps, keyed the same way.
    surfaces,
    {
      channel: <T>(name: string) => publisherChannel<T>(publisher, name),

      // Default subsequent-read error handler for poll-shape streams.
      // All four Kolu streams (gitStatus, gitDiff, fsListAll, fsReadFile)
      // log transient read failures the same way; per-stream overrides
      // are absent so this fires for every poll-shape stream.
      onStreamReadError: (err, info) =>
        log.error(
          { err: err instanceof Error ? err.message : String(err), ...info },
          "stream snapshot read failed",
        ),
    },
    {
      // ── surface-app's server deps (sibling under `surfaceApp`) ───────────
      // The build-identity cell's server fragment (skew axis), extended with
      // kolu's `expectedKaval` axis, PLUS the `identity.info` restart probe
      // pinned to kolu's boot UUID. `commit` is kolu's single source
      // (`serverCommit` ← `KOLU_COMMIT_HASH`); `expectedKaval` is a build
      // CONSTANT (the server's own baked KAVAL_BUILD_ID/KAVAL_COMMIT_HASH — the
      // build it would spawn), so it lands as a `Partial<KoluBuildInfo>` patch
      // over the library-seeded `{ commit }`. The connected daemon's *reported*
      // identity is NOT here — it rides `daemonStatus.identity`. Per-key deps are
      // typed against the surface's own spec, so this needs no cast.
      surfaceApp: surfaceAppServer<KoluBuildInfo>({
        buildInfo: async () => {
          // The kaval the server WOULD spawn — its OWN baked identity (a build
          // constant), the *expected* operand of B3.4's read-site currency nudge
          // (`expectedKaval.staleKey !== daemonStatus.identity.staleKey`). Off-nix
          // the id is "" — omit it then (nix-first, no dev identity), so the rail
          // shows no expected and the nudge stays silent.
          const expectedKaval = expectedKavalIdentity();
          return {
            version: serverVersion,
            ...(expectedKaval.staleKey ? { expectedKaval } : {}),
          };
        },
        commit: serverCommit,
        // surface-app's identity probe (restart axis) —
        // `surface.surfaceApp.identity.info`. Pin it to the existing boot UUID
        // (`serverProcessId`) so the value is stable within a process and
        // changes on restart. Composed, not hand-written.
        processId: serverProcessId,
        // `expectedKaval` is a build constant — this read can't fail — but keep
        // the fragment's error sink for the cell's contract.
        onError: (err) =>
          log.error(
            { err: err instanceof Error ? err.message : String(err) },
            "buildInfo expectedKaval axis failed",
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
        // exactly as `authored` projects `.meta` (the two halves share one
        // backing entry). Writes go through the sink's
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
        // QUIET-DEFAULT the framed event stream (PR-3): kolu folds its producer
        // IN-PROCESS, so nobody consumes kolu-server's `terminalEvents` — its
        // local awareness fold is untouched by the new wire. F-REMOTE consumes a
        // REMOTE host's stream (pulam serves the live one), never this one.
        terminalEvents: quietTerminalEvents,
        endpoint: localEndpoint,
        log,
      }),
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
