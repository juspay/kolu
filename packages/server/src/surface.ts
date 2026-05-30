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
  implementSurface,
  publisherChannel,
} from "@kolu/surface/server";
import { implement } from "@orpc/server";
import { contract } from "kolu-common/contract";
import { TerminalNotFoundError } from "kolu-common/errors";
import type {
  ActivityFeed,
  Preferences,
  SavedSession,
  TerminalMetadata,
} from "kolu-common/surface";
import { surface } from "kolu-common/surface";
import {
  type FsReadFileOutput,
  fsListAllOutputEqual,
  fsReadFileOutputEqual,
  gitDiffOutputEqual,
  gitStatusOutputEqual,
} from "kolu-git";
import { daemonStatusSnapshot } from "./daemon/supervisor.ts";
import {
  buildIframePreviewUrl,
  isIframePreviewable,
} from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import { publisher } from "./publisher.ts";
import { cancelPendingAutosave, getSavedSession } from "./session.ts";
import { store } from "./state.ts";
import { setSurfaceCtx } from "./surfaceCtx.ts";
import { getTerminal, listTerminals } from "./terminal-registry.ts";
import { getTerminalBackendFor } from "./terminalBackend/index.ts";

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

// ── Surface implementation ─────────────────────────────────────────────

const { router: surfaceRouterFragment, ctx: surfaceCtxBuilt } =
  implementSurface(surface, {
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

    cells: {
      preferences: {
        store: preferencesStore,
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
      daemonStatus: {
        // Computed from the supervisor's current handle; no persistent slot.
        // The in-memory `set` is a publish trigger only (mirrors
        // `terminalList`) — `restartLocalPtyHostDaemon` calls
        // `surfaceCtx.cells.daemonStatus.set(...)` to push the fresh status
        // after a restart; the value itself is always re-read via `get`.
        store: { get: () => daemonStatusSnapshot(), set: () => {} },
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
          if (isIframePreviewable(input.filePath)) {
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
          localBackend.fs.subscribeFileChange(
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
        // time (`TerminalNotFoundError` propagates as `ORPCError`, not
        // retried by `STREAM_RETRY`), then forward the first exit-channel
        // yield and return. The `bus` helper is the framework's per-input
        // channel — the same one `surfaceCtx.events.terminalExit.publish`
        // writes to.
        source: async function* (input, signal, { bus }) {
          if (!getTerminal(input.id)) throw new TerminalNotFoundError(input.id);
          for await (const exitCode of bus.subscribe(signal)) {
            yield exitCode;
            return;
          }
        },
      },
    },
  });

export const surfaceRouter = surfaceRouterFragment;
setSurfaceCtx(surfaceCtxBuilt);
