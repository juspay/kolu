/**
 * `@kolu/padi/fsDeps` — the FILESYSTEM WATCHER-STREAM backings for
 * `padiSurface`'s `subscribeRepoChange` / `subscribeFileChange` /
 * `subscribeDirChange` members, absorbed out of the retired
 * `@kolu/terminal-vocab/serveFsGit` (which served the dead
 * `terminalWorkspaceSurface`). The fs/git PROCEDURES already live inline in
 * `servePadi` (padi's own handlers carry the ENOENT→NOT_FOUND wrapping and the
 * worktree mutations `serveFsGit` never had), so only the pulse streams needed a
 * new home.
 *
 * NOT `fsGitDeps`: the axis these three members share is the FILESYSTEM, not
 * git. Two of them happen to read git state to decide what to watch and the
 * third (`subscribeDirChange`) never consults git at all — a name that has to
 * be excused in a comment beside its own member is a boundary that has already
 * moved, and a reader looking for the non-git pulse wiring would not look in a
 * file called `fsGitDeps`.
 *
 * The live deltas are watcher streams that carry a `seq` PULSE, not data: a
 * consumer re-queries the `fs.*` / `git.*` procedures on each pulse. The pulse
 * cassette itself is padi's ONE `pulseSource` (`./pulseSource.ts`) — shared with
 * the standing-subscription doorbell — over kolu-git's refcounted,
 * @parcel/watcher-backed `subscribeRepoChange` / `subscribeFileChange`. No
 * hand-rolled snapshot loop, no second watcher, and no second copy of the poll
 * shape to disagree with this one about read-failure reporting.
 */

import type { ImplementSurfaceDeps } from "@kolu/surface/server";
import type { Logger } from "pino";
import type { TerminalEndpoint } from "./endpoint.ts";
import { pulseSource } from "./pulseSource.ts";
import type { padiSurface } from "./surface.ts";

type PadiDeps = ImplementSurfaceDeps<typeof padiSurface.spec>;

/** Build the two watcher `streams` deps for `padiSurface`'s
 *  `subscribeRepoChange` / `subscribeFileChange`, backed by padi's own
 *  `TerminalEndpoint` fs watchers. `servePadi` spreads `...padiFsDeps(...).streams`
 *  into its full `streams` deps (its own `activity` + `terminalAttach` ride
 *  alongside).
 *
 *  **STREAMS-ONLY, deliberately: the fs/git PROCEDURES live in `servePadi`, which
 *  carries semantics the retired `serveFsGit` never had** — the ENOENT→NOT_FOUND
 *  mapping (each kolu-git read returns a structural `FILE_GONE` member that
 *  `unwrapGit` maps to a typed `NOT_FOUND`) and the worktree create/remove
 *  mutations. This helper absorbed only the *pulse* streams when
 *  `terminalWorkspaceSurface` was deleted (W2.3); pulling the procedures in
 *  here to "finish the dedupe" would REGRESS that richer serving. Keep the
 *  procedures in `servePadi`. */
export function padiFsDeps(
  endpoint: TerminalEndpoint,
  log: Logger,
): {
  streams: Pick<
    NonNullable<PadiDeps["streams"]>,
    "subscribeRepoChange" | "subscribeFileChange" | "subscribeDirChange"
  >;
} {
  return {
    streams: {
      subscribeRepoChange: {
        source: ({ repoPath }) =>
          pulseSource(
            (onEvent) => endpoint.fs.subscribeRepoChange(repoPath, onEvent),
            log,
            "subscribeRepoChange",
          ),
      },
      subscribeFileChange: {
        source: ({ repoPath, filePath }) =>
          pulseSource(
            (onEvent) =>
              endpoint.fs.subscribeFileChange(repoPath, filePath, onEvent),
            log,
            "subscribeFileChange",
          ),
      },
      // The browse pulse: one directory's direct children, non-recursive
      // (`kolu-git`'s `subscribeDirChange`, a config of `kolu-io`'s one
      // directory-watch receptacle — the same fs axis as its two siblings,
      // narrowed to a single level instead of a whole repo).
      subscribeDirChange: {
        source: ({ repoPath, dirPath }) =>
          pulseSource(
            (onEvent) =>
              endpoint.fs.subscribeDirChange(repoPath, dirPath, onEvent),
            log,
            "subscribeDirChange",
          ),
      },
    },
  };
}
