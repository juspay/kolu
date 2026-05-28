/**
 * Server-side surface implementation — single source of truth for the
 * typed reactive layer.
 *
 *   - `surfaceRouter` — `oc.router({ surface: {...} })` fragment for the
 *     host router; spread alongside hand-listed raw oRPC procedures in
 *     `router.ts`.
 *   - `surfaceCtx` — typed `cells / collections / events` mutation map.
 *     Domain modules (`activity.ts`, `session.ts`, `terminals.ts`,
 *     `terminalBackend/metadata.ts`) import this and call `surfaceCtx.cells.X.set(...)`,
 *     `surfaceCtx.collections.X.upsert(k, v)`, `surfaceCtx.events.X.publish(i, p)`.
 *     The framework owns the apply+publish chain (and per-input event
 *     channel); domain code never sees a channel name string.
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
import type {
  ActivityFeed,
  Preferences,
  SavedSession,
  TerminalMetadata,
} from "kolu-common/surface";
import { contract } from "kolu-common/contract";
import { TerminalNotFoundError } from "kolu-common/errors";
import { surface } from "kolu-common/surface";
import {
  fsListAllOutputEqual,
  type FsReadFileOutput,
  fsReadFileOutputEqual,
  gitDiffOutputEqual,
  gitStatusOutputEqual,
} from "kolu-git";
import {
  buildIframePreviewUrl,
  isIframePreviewable,
} from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import { publisher } from "./publisher.ts";
import { cancelPendingAutosave, getSavedSession } from "./session.ts";
import { store } from "./state.ts";
// `getTerminalBackendFor` is part of an import cycle (terminalBackend/
// index.ts → remote.ts → metadata.ts → surface.ts). ESM tolerates the
// cycle because every consumer below accesses the binding lazily
// inside handler closures, never at module init.
import { getTerminalBackendFor } from "./terminalBackend/index.ts";
import type { TerminalBackend } from "kolu-common/terminalBackend";
import type { TerminalId } from "kolu-common/surface";
import {
  getTerminal,
  listTerminals,
  type TerminalProcess,
} from "./terminal-registry.ts";

/** Resolve `{terminal, backend}` for a stream input, or `null` if the
 *  terminal isn't registered. Returns the resolved `TerminalProcess`
 *  alongside the backend so callers (notably `fsReadFile`, which
 *  also reads `term.location.kind`) can reuse the lookup instead of
 *  re-resolving — a re-resolve would race with deregistration and
 *  silently coerce a just-removed remote terminal to "local" mode.
 *
 *  Streams dispatch via this so remote Code-tab reads hit the agent's
 *  fs/git, not the parent's. The null branch matters: falling back
 *  to the local backend would let a remote stream race with terminal
 *  cleanup read parent-side paths that happen to exist locally,
 *  surfacing the wrong files/diffs in the UI. */
function resolveTerminalStream(
  id: TerminalId,
): { term: TerminalProcess; backend: TerminalBackend } | null {
  const term = getTerminal(id);
  if (!term) return null;
  return { term, backend: getTerminalBackendFor(term.location) };
}

const NOOP_UNSUBSCRIBE = (): void => {};

/** Shared `read` policy: resolve the backend or throw a typed not-
 *  found error so oRPC wraps it as `ORPCError` (the client's
 *  `STREAM_RETRY` policy doesn't retry those). */
function readWithBackend<I extends { terminalId: TerminalId }, T>(
  input: I,
  fn: (backend: TerminalBackend, term: TerminalProcess, input: I) => Promise<T>,
): Promise<T> {
  const resolved = resolveTerminalStream(input.terminalId);
  if (!resolved) throw new TerminalNotFoundError(input.terminalId);
  return fn(resolved.backend, resolved.term, input);
}

/** Shared `install` policy: resolve the backend or return a no-op
 *  unsubscribe. The framework calls `install` only after the initial
 *  `read` succeeds, so a missing-terminal subscribe is a tear-down
 *  race we let lapse silently — `read`'s next throw is the signal. */
function installWithBackend<I extends { terminalId: TerminalId }>(
  input: I,
  fn: (backend: TerminalBackend, input: I) => () => void,
): () => void {
  const resolved = resolveTerminalStream(input.terminalId);
  if (!resolved) return NOOP_UNSUBSCRIBE;
  return fn(resolved.backend, input);
}

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
      // Each stream dispatches through `resolveTerminalStream` (via
      // the `readWithBackend` / `installWithBackend` policy helpers)
      // so remote terminals read fs/git on the agent host. The
      // resolver is identity-stable per terminal, so `install` and
      // `read` see the same backend across the lifetime of a
      // subscription.
      gitStatus: {
        read: (input) =>
          readWithBackend(input, (backend, _term, i) =>
            backend.git.getStatus(i.repoPath, i.mode),
          ),
        install: (input, cb) =>
          installWithBackend(input, (backend, i) =>
            backend.fs.subscribeRepoChange(i.repoPath, cb),
          ),
        isEqual: gitStatusOutputEqual,
      },
      gitDiff: {
        read: (input) =>
          readWithBackend(input, (backend, _term, i) =>
            backend.git.getDiff(i.repoPath, i.filePath, i.mode, i.oldPath),
          ),
        install: (input, cb) =>
          installWithBackend(input, (backend, i) =>
            backend.fs.subscribeRepoChange(i.repoPath, cb),
          ),
        isEqual: gitDiffOutputEqual,
      },
      fsListAll: {
        read: (input) =>
          readWithBackend(input, (backend, _term, i) =>
            backend.fs.listAll(i.repoPath),
          ),
        install: (input, cb) =>
          installWithBackend(input, (backend, i) =>
            backend.fs.subscribeRepoChange(i.repoPath, cb),
          ),
        isEqual: fsListAllOutputEqual,
      },
      fsReadFile: {
        read: (input): Promise<FsReadFileOutput> =>
          readWithBackend(input, async (backend, term, i) => {
            // Iframe preview is only available for local terminals —
            // the URL points at the parent's HTTP file route, which
            // reads from the parent's local FS. Remote files fall
            // back to text mode (agent already returns `{content,
            // truncated}` for every read). `term` comes from the same
            // resolver call as `backend`, so its `location.kind` is
            // race-free with respect to deregistration.
            const isLocal = term.location.kind === "local";
            if (isLocal && isIframePreviewable(i.filePath)) {
              const mtimeMs = await backend.fs.statFileMtimeMs(
                i.repoPath,
                i.filePath,
              );
              return {
                kind: "binary",
                url: buildIframePreviewUrl(i.terminalId, i.filePath, mtimeMs),
              };
            }
            const { content, truncated } = await backend.fs.readFile(
              i.repoPath,
              i.filePath,
            );
            return { kind: "text", content, truncated };
          }),
        install: (input, cb) =>
          installWithBackend(input, (backend, i) =>
            backend.fs.subscribeFileChange(i.repoPath, i.filePath, cb),
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
export const surfaceCtx = surfaceCtxBuilt;
