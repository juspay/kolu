/**
 * `@kolu/padi/fsGitDeps` — the fs/git WATCHER-STREAM backings for
 * `padiSurface`'s `subscribeRepoChange` / `subscribeFileChange` members, absorbed
 * out of the retired `@kolu/terminal-vocab/serveFsGit` (which served the dead
 * `terminalWorkspaceSurface`). The fs/git PROCEDURES already live inline in
 * `servePadi` (padi's own handlers carry the ENOENT→NOT_FOUND wrapping and the
 * worktree mutations `serveFsGit` never had), so only the pulse streams needed a
 * new home.
 *
 * The live deltas are watcher streams that carry a `seq` PULSE, not data: a
 * consumer re-queries the `fs.*` / `git.*` procedures on each pulse. Each watcher
 * uses the raw `source` arm — NOT the poll-shape `{read,install,isEqual}` arm —
 * because the `seq` counter must be allocated PER SUBSCRIPTION: the framework
 * calls a `source` thunk afresh per subscribe (so the closure-local `seq` is
 * private to that subscription), whereas the poll-shape's `read`/`install` are one
 * shared dep-object function whose closure would leak `seq` across concurrent
 * subscribers. Inside the thunk we still reuse the framework's `pollOnEvent`
 * (snapshot-then-deltas by construction) and kolu-git's refcounted,
 * @parcel/watcher-backed `subscribeRepoChange` / `subscribeFileChange` — no
 * hand-rolled snapshot loop, no second watcher.
 */

import { type ImplementSurfaceDeps, pollOnEvent } from "@kolu/surface/server";
import type { RepoChangePulse } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import type { TerminalEndpoint } from "./endpoint.ts";
import type { padiSurface } from "./surface.ts";

type PadiDeps = ImplementSurfaceDeps<typeof padiSurface.spec>;

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
      log.error({ err }, `padi: ${label} pulse read failed`),
  });
}

/** Build the two watcher `streams` deps for `padiSurface`'s
 *  `subscribeRepoChange` / `subscribeFileChange`, backed by padi's own
 *  `TerminalEndpoint` fs watchers. `servePadi` spreads `...padiFsGitDeps(...).streams`
 *  into its full `streams` deps (its own `activity` + `terminalAttach` ride
 *  alongside).
 *
 *  **STREAMS-ONLY, deliberately: the fs/git PROCEDURES live in `servePadi`, which
 *  carries semantics the retired `serveFsGit` never had** — the ENOENT→NOT_FOUND
 *  mapping (`fileGoneAsNotFound`) and the worktree create/remove mutations. This
 *  helper absorbed only the *pulse* streams when `terminalWorkspaceSurface` was
 *  deleted (W2.3); pulling the procedures in here to "finish the dedupe" would
 *  REGRESS that richer serving. Keep the procedures in `servePadi`. */
export function padiFsGitDeps(
  endpoint: TerminalEndpoint,
  log: Logger,
): {
  streams: Pick<
    NonNullable<PadiDeps["streams"]>,
    "subscribeRepoChange" | "subscribeFileChange"
  >;
} {
  return {
    streams: {
      subscribeRepoChange: {
        source: ({ repoPath }, signal) =>
          changePulseSource(
            (onEvent) => endpoint.fs.subscribeRepoChange(repoPath, onEvent),
            signal,
            log,
            "subscribeRepoChange",
          ),
      },
      subscribeFileChange: {
        source: ({ repoPath, filePath }, signal) =>
          changePulseSource(
            (onEvent) =>
              endpoint.fs.subscribeFileChange(repoPath, filePath, onEvent),
            signal,
            log,
            "subscribeFileChange",
          ),
      },
    },
  };
}
