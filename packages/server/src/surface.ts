/**
 * Server-side surface implementation — single source of truth for the
 * typed reactive layer.
 *
 *   - `surfaceRouter` — `oc.router({ surface: {...} })` fragment for the
 *     host router; spread alongside hand-listed raw oRPC procedures in
 *     `router.ts`.
 *   - `surfaceCtx` — typed `cells / collections / events` mutation map.
 *     Domain modules (`activity.ts`, `session.ts`, `terminals.ts`,
 *     `meta/state.ts`) import this and call `surfaceCtx.cells.X.set(...)`,
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
import { ORPCError, implement } from "@orpc/server";
import { match } from "ts-pattern";
import type {
  ActivityFeed,
  Preferences,
  SavedSession,
} from "kolu-common/surface";
import { contract } from "kolu-common/contract";
import { TerminalNotFoundError } from "kolu-common/errors";
import { surface } from "kolu-common/surface";
import {
  fsListAllOutputEqual,
  fsReadFileOutputEqual,
  type GitResult,
  getDiff,
  getStatus,
  gitDiffOutputEqual,
  gitStatusOutputEqual,
  listAll,
  readFile,
  subscribeFileChange,
  subscribeRepoChange,
} from "kolu-git";
import { log } from "./log.ts";
import { publisher } from "./publisher.ts";
import { getSavedSession } from "./session.ts";
import { store } from "./state.ts";
import { getTerminal, listTerminals } from "./terminal-registry.ts";

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

/** Unwrap a `GitResult` or throw an `ORPCError` for the client. Shared
 *  with the raw git handlers in `router.ts`. */
export function unwrapGit<T>(result: GitResult<T>): T {
  if (result.ok) return result.value;
  const { status, message } = match(result.error)
    .with({ code: "BASE_BRANCH_NOT_FOUND" }, (e) => ({
      status: "PRECONDITION_FAILED" as const,
      message: e.message,
    }))
    .with({ code: "WORKTREE_NAME_COLLISION" }, (e) => ({
      status: "CONFLICT" as const,
      message: e.message,
    }))
    .with({ code: "PATH_ESCAPES_ROOT" }, (e) => ({
      status: "INTERNAL_SERVER_ERROR" as const,
      message: `path escapes root: ${e.child}`,
    }))
    .with({ code: "GIT_FAILED" }, (e) => ({
      status: "INTERNAL_SERVER_ERROR" as const,
      message: e.message,
    }))
    .with({ code: "NOT_A_REPO" }, () => ({
      status: "INTERNAL_SERVER_ERROR" as const,
      message: "Not a git repository",
    }))
    .exhaustive();
  throw new ORPCError(status, { message });
}

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
      },
      terminalList: {
        // Live registry; the in-memory store has no persistent slot.
        store: { get: () => listTerminals(), set: () => {} },
      },
    },

    collections: {
      terminalMetadata: {
        readAll: () => {
          const map = new Map<
            string,
            ReturnType<typeof getTerminal> extends infer T
              ? T extends { info: { meta: infer M } }
                ? M
                : never
              : never
          >();
          for (const info of listTerminals()) {
            const term = getTerminal(info.id);
            if (term)
              (map as Map<string, unknown>).set(info.id, term.info.meta);
          }
          return map;
        },
        readOne: (key) => {
          const term = getTerminal(key as string);
          return term ? term.info.meta : undefined;
        },
        // Server-internal collection: clients can't write. The `upsert`/
        // `remove` no-ops let `surfaceCtx.collections.terminalMetadata.upsert`
        // publish without re-mutating the registry (the registry is the
        // store; meta/state.ts mutates entry.info.meta in place before
        // calling ctx.upsert).
        upsert: () => {},
        remove: () => {},
      },
    },

    streams: {
      gitStatus: {
        read: async (input) =>
          unwrapGit(await getStatus(input.repoPath, input.mode, log)),
        install: (input, cb) => subscribeRepoChange(input.repoPath, cb, log),
        isEqual: gitStatusOutputEqual,
      },
      gitDiff: {
        read: async (input) =>
          unwrapGit(
            await getDiff(
              input.repoPath,
              input.filePath,
              input.mode,
              log,
              input.oldPath,
            ),
          ),
        install: (input, cb) => subscribeRepoChange(input.repoPath, cb, log),
        isEqual: gitDiffOutputEqual,
      },
      fsListAll: {
        read: async (input) => ({
          paths: unwrapGit(await listAll(input.repoPath, log)),
        }),
        install: (input, cb) => subscribeRepoChange(input.repoPath, cb, log),
        isEqual: fsListAllOutputEqual,
      },
      fsReadFile: {
        read: async (input) =>
          unwrapGit(await readFile(input.repoPath, input.filePath, log)),
        install: (input, cb) =>
          subscribeFileChange(input.repoPath, input.filePath, cb, log),
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
