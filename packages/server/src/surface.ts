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
 *     `terminalBackend/local.ts`, `terminalBackend/metadata.ts`) import
 *     `surfaceCtx` from `./surfaceCtx.ts` — not from here — and call
 *     `surfaceCtx.cells.X.set(...)`, `.collections.X.upsert(k, v)`,
 *     `.events.X.publish(i, p)`. The framework owns the apply+publish
 *     chain; domain code never sees a channel name string. Routing the
 *     ctx through `./surfaceCtx.ts` is what breaks the bidirectional
 *     import cycle that would otherwise form (#1005).
 *
 * Publisher channel names are framework-derived: `<surface-key>:changed`
 * for cells, `<surface-key>:keys` + `<surface-key>:<key>` for collections,
 * `<surface-key>:<JSON.stringify(input)>` for events.
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
import { implement } from "@orpc/server";
import { contract } from "kolu-common/contract";
import type {
  ActivityFeed,
  KoluBuildInfo,
  Preferences,
  SavedSession,
  TerminalMetadata,
} from "kolu-common/surface";
import { koluSurface, surfaceAppSurface_kolu } from "kolu-common/surface";
import {
  type FsReadFileOutput,
  fsListAllOutputEqual,
  fsReadFileOutputEqual,
  gitDiffOutputEqual,
  gitStatusOutputEqual,
} from "kolu-git";
import { isBinaryPreviewable } from "kolu-common/preview";
import { serverCommit, serverProcessId } from "./hostname.ts";
import { buildIframePreviewUrl } from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import { publisher } from "./publisher.ts";
import { cancelPendingAutosave, getSavedSession } from "./session.ts";
import { store } from "./state.ts";
import { setSurfaceCtx } from "./surfaceCtx.ts";
import {
  getTerminal,
  listTerminals,
  terminalNotFound,
} from "./terminal-registry.ts";
import { getTerminalBackendFor } from "./terminalBackend/index.ts";
import { ptyHostIdentity } from "./terminalBackend/local.ts";

const localBackend = getTerminalBackendFor({ kind: "local" });

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
  },

  collections: {
    terminalMetadata: {
      readAll: () => {
        const map = new Map<string, TerminalMetadata>();
        for (const info of listTerminals()) {
          const term = getTerminal(info.id);
          if (term) map.set(info.id, term.meta);
        }
        return map;
      },
      readOne: (key) => {
        const term = getTerminal(key as string);
        return term ? term.meta : undefined;
      },
      // Server-internal collection: clients can't write. The `upsert`/
      // `remove` no-ops let `surfaceCtx.collections.terminalMetadata.upsert`
      // publish without re-mutating the registry (the registry is the
      // store; `terminalBackend/metadata.ts` mutates entry.meta in place before
      // calling ctx.upsert).
      upsert: () => {},
      remove: () => {},
    },
  },

  streams: {
    // fs/git streams are per-host one-shot ops; R-1 has only the
    // local backend, but every read/install dispatches through the
    // resolver so R-2 can branch on a `location` input without
    // touching this block again.
    gitStatus: {
      read: async (input) =>
        localBackend.git.getStatus(input.repoPath, input.mode),
      install: (input, cb) =>
        localBackend.fs.subscribeRepoChange(input.repoPath, cb),
      isEqual: gitStatusOutputEqual,
    },
    gitDiff: {
      read: async (input) =>
        localBackend.git.getDiff(
          input.repoPath,
          input.filePath,
          input.mode,
          input.oldPath,
        ),
      install: (input, cb) =>
        localBackend.fs.subscribeRepoChange(input.repoPath, cb),
      isEqual: gitDiffOutputEqual,
    },
    fsListAll: {
      read: async (input) => localBackend.fs.listAll(input.repoPath),
      install: (input, cb) =>
        localBackend.fs.subscribeRepoChange(input.repoPath, cb),
      isEqual: fsListAllOutputEqual,
    },
    fsReadFile: {
      read: async (input): Promise<FsReadFileOutput> => {
        if (isBinaryPreviewable(input.filePath)) {
          const mtimeMs = await localBackend.fs.statFileMtimeMs(
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
        const { content, truncated } = await localBackend.fs.readFile(
          input.repoPath,
          input.filePath,
        );
        return { kind: "text", content, truncated };
      },
      install: (input, cb) =>
        localBackend.fs.subscribeFileChange(input.repoPath, input.filePath, cb),
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
  // kolu's build identity has a boot-time-async axis (the pty-host's
  // `system.version` over the in-process link). `surfaceAppServer` returns the
  // buildInfo cell carrying `.connect` — the surface runtime fires it once the
  // cell ctx is built, republishing the resolved `{ commit, ptyHost }` through
  // the same fragment when it settles (server-pushed, so a client connected
  // before the pty-host answered fills in its `srv · pty` rail without a reload).
  // No app-visible connect to call, no hand-written `ctx.cells.buildInfo.set`.
  implementSurfaces(
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
      // ── surface-app served as a sibling ──────────────────────────────────
      // The build-identity cell's server fragment (skew axis), extended with
      // kolu's pty-host column, PLUS the `identity.info` restart probe pinned to
      // kolu's boot UUID. `commit` is kolu's single source (`serverCommit` ←
      // `KOLU_COMMIT_HASH`); the pty-host axis is the boot-time-async source — the
      // in-process pty-host reports its identity async (via `system.version`), so
      // it lands as a `Partial<KoluBuildInfo>` patch after the cell is seeded with
      // `{ commit }`. A failed probe leaves `ptyHost` undefined (the fragment
      // swallows it); the rail's column shows `—`.
      surfaceApp: {
        surface: surfaceAppSurface_kolu,
        // biome-ignore lint/suspicious/noExplicitAny: entry deps are `any`-spec'd; the surfaceAppServer bundle's concretely-typed cell entry rejects the `unknown`-typed member contravariantly. Runtime shape is exact.
        deps: surfaceAppServer<KoluBuildInfo>({
          buildInfo: async () => {
            const identity = await ptyHostIdentity;
            return identity ? { ptyHost: identity } : {};
          },
          commit: serverCommit,
          // surface-app's identity probe (restart axis) —
          // `surface.surfaceApp.identity.info`. Pin it to the existing boot UUID
          // (`serverProcessId`) so the value is stable within a process and
          // changes on restart. Composed, not hand-written.
          processId: serverProcessId,
          // Surface a failed boot-time pty-host probe — `ptyHost` legitimately
          // stays undefined when the probe resolves empty, but a *rejection* is a
          // fault we log rather than swallow (the rail's column shows `—` either way).
          onError: (err) =>
            log.error(
              { err: err instanceof Error ? err.message : String(err) },
              "buildInfo pty-host axis failed",
            ),
        }) as any,
      },

      // ── kolu's own primitives served as a sibling ────────────────────────
      // `koluDeps` (above) is the concretely-typed deps; cast only at this
      // `any`-spec'd entry boundary.
      // biome-ignore lint/suspicious/noExplicitAny: entry deps are `any`-spec'd; the concretely-typed koluDeps rejects the `unknown`-typed member contravariantly. Runtime shape is exact.
      kolu: { surface: koluSurface, deps: koluDeps as any },
    },
  );

export const surfaceRouter = surfaceRouterFragment;
// Domain modules mutate only kolu's OWN primitives, so register the `kolu`
// surface's ctx (`implementSurfaces(...).ctx.kolu`). surface-app's buildInfo is
// driven by the runtime-fired cell `.connect`, not by domain code.
setSurfaceCtx(surfaceCtxBuilt.kolu);
