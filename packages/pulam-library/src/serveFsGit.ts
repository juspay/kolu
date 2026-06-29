/**
 * `@kolu/pulam-library/serveFsGit` — FACE B of the lifted fs/git wrapper:
 * the `implementSurface` deps that expose `createTerminalWorkspaceEndpoint`'s
 * one impl on the `terminalWorkspaceSurface` as procedures + watcher streams.
 * pulam spreads these alongside its `awareness`/`activity`/`version` deps so the
 * remote home serves the SAME fs/git the in-process home (kolu-server) does.
 *
 * The fs/git reads map 1:1 to procedures (request → response, location-
 * transparent under R8's mirror). The live deltas are watcher streams that
 * carry a `seq` PULSE, not data: a consumer re-queries the procedures on each
 * pulse. Each watcher uses the raw `source` arm — NOT the poll-shape
 * `{read,install,isEqual}` arm — because the `seq` counter must be allocated
 * PER SUBSCRIPTION: the framework calls a `source` thunk afresh per subscribe
 * (so the closure-local `seq` is private to that subscription), whereas the
 * poll-shape's `read`/`install` are one shared dep-object function whose closure
 * would leak `seq` across concurrent subscribers. Inside the thunk we still
 * reuse the framework's `pollOnEvent` (snapshot-then-deltas by construction) and
 * kolu-git's refcounted, @parcel/watcher-backed `subscribeRepoChange` /
 * `subscribeFileChange` — no hand-rolled snapshot loop, no second watcher.
 */

import { type ImplementSurfaceDeps, pollOnEvent } from "@kolu/surface/server";
import type { Logger } from "pino";
import type { TerminalWorkspaceEndpoint } from "./endpoint.ts";
import type { RepoChangePulse, terminalWorkspaceSurface } from "./surface.ts";

type WorkspaceDeps = ImplementSurfaceDeps<typeof terminalWorkspaceSurface.spec>;

/** A monotonic per-subscription pulse source over a callback watcher. Yields
 *  `{seq:0}` at subscribe (the snapshot frame), then a fresh incrementing `seq`
 *  on every debounced change — the distinct value is what defeats the stream's
 *  `isEqual` dedup so each change reaches the consumer. */
function changePulseSource(
  install: (onEvent: () => void) => () => void,
  signal: AbortSignal | undefined,
  log: Logger,
  label: string,
): AsyncIterable<RepoChangePulse> {
  let seq = 0;
  return pollOnEvent<RepoChangePulse>({
    read: () => Promise.resolve({ seq: seq++ }),
    isEqual: (a, b) => a.seq === b.seq,
    install,
    signal,
    onReadError: (err) =>
      log.error({ err }, `pulam-library: ${label} pulse read failed`),
  });
}

/** Build the `procedures` + the two watcher `streams` deps for
 *  `implementSurface(terminalWorkspaceSurface, …)`, backed by one
 *  `createTerminalWorkspaceEndpoint` instance. The caller spreads these into its
 *  full deps (its own `activity` stream rides alongside the watchers). */
export function fsGitSurfaceDeps(
  fsGit: TerminalWorkspaceEndpoint,
  log: Logger,
): {
  procedures: NonNullable<WorkspaceDeps["procedures"]>;
  streams: Pick<
    NonNullable<WorkspaceDeps["streams"]>,
    "subscribeRepoChange" | "subscribeFileChange"
  >;
} {
  return {
    procedures: {
      fs: {
        listAll: ({ input }) => fsGit.fs.listAll(input.repoPath),
        readFile: ({ input }) =>
          fsGit.fs.readFile(input.repoPath, input.filePath),
        statFileMtimeMs: ({ input }) =>
          fsGit.fs.statFileMtimeMs(input.repoPath, input.filePath),
      },
      git: {
        getStatus: ({ input }) =>
          fsGit.git.getStatus(input.repoPath, input.mode),
        getDiff: ({ input }) =>
          fsGit.git.getDiff(
            input.repoPath,
            input.filePath,
            input.mode,
            input.oldPath,
          ),
      },
    },
    streams: {
      subscribeRepoChange: {
        source: ({ repoPath }, signal) =>
          changePulseSource(
            (onEvent) => fsGit.fs.subscribeRepoChange(repoPath, onEvent),
            signal,
            log,
            "subscribeRepoChange",
          ),
      },
      subscribeFileChange: {
        source: ({ repoPath, filePath }, signal) =>
          changePulseSource(
            (onEvent) =>
              fsGit.fs.subscribeFileChange(repoPath, filePath, onEvent),
            signal,
            log,
            "subscribeFileChange",
          ),
      },
    },
  };
}
