/** A WORK'S FILES, LISTED — every file under a worktree's `.waterfall/`, at
 *  any depth, read the one way the server and the browser both read it.
 *
 *  A waterfall writes FOLDERS as well as files (a planner's `mockup/`, its
 *  fonts in `mockup/fonts/`). The one list this answers feeds the card, the
 *  reader's tabs, the timeline's `file` events and what kolu keeps when the
 *  work ends — so the rule is written once, here, in `kolu-common`, which
 *  both kolu-server and the browser import. Each side hands in its own
 *  `fs.listDirectory`, bound to the worktree: the server's padi client, the
 *  browser's per-host procedures. Nothing else differs.
 *
 *  ## The walk
 *
 *  Level by level, shallowest first, each level's folders taken by name. A
 *  path ending in `/` is a folder (`listDirectory`'s own spelling of one). A
 *  folder that is not there — the root of a work that has written nothing,
 *  or a folder deleted between two reads — is an EMPTY list: padi's declared
 *  `FileGone`, not a failure. Any other failure fails the walk with its own
 *  sentence, because "the machine did not answer" must never read as "the
 *  work produced nothing".
 *
 *  ## The two limits
 *
 *  {@link WORK_FILES_LISTED} stops the walk: files and folders both count, so
 *  a mockup built with `npm install`, or a folder symlinked onto itself, ends
 *  rather than putting tens of thousands of rows on a timeline. Because the
 *  walk is shallowest-first, the top-level files — the plan — are always in
 *  the answer. {@link WORK_FILES_KEPT_BYTES} is how much kolu copies out of
 *  the worktree when a work ends. Both are fixed: no setting, no override. */

import { formatBytes, MIB } from "@kolu/byte-units";
import { Effect, Option, Predicate, Result } from "effect";
import {
  compareWaterfallPaths,
  WATERFALL_DIR,
  waterfallFileName,
} from "kolu-work";

/** How many entries (files and folders) one listing reads before it stops. */
export const WORK_FILES_LISTED = 200;

/** How many bytes of a work's files kolu keeps when it ends — 50 MiB, the
 *  figure `@kolu/byte-units` prints as "50 MiB". */
export const WORK_FILES_KEPT_BYTES = 50 * MIB;

/** What a listing found: every file, worktree-relative, in tree order — and
 *  whether the walk stopped at {@link WORK_FILES_LISTED} with more left. */
export interface WorkFilesListed {
  readonly paths: ReadonlyArray<string>;
  readonly more: boolean;
}

/** One level of a directory, as a host's `fs.listDirectory` answers it once
 *  bound to the worktree: paths worktree-relative, folders ending in `/`. */
export type ListDirectory<E> = (
  dirPath: string,
) => Effect.Effect<{ readonly paths: ReadonlyArray<string> }, E>;

/** THE WALK — see the header. Answers every file under `.waterfall/`, and
 *  whether it stopped at {@link WORK_FILES_LISTED}. */
export const listWorkFiles = <E>(
  listDirectory: ListDirectory<E>,
): Effect.Effect<WorkFilesListed, E> =>
  Effect.gen(function* () {
    const files: string[] = [];
    const done = (more: boolean): WorkFilesListed => ({
      paths: files.sort(compareWaterfallPaths),
      more,
    });
    let entries = 0;
    let level: ReadonlyArray<string> = [WATERFALL_DIR];
    while (level.length > 0) {
      const next: string[] = [];
      for (const folder of level) {
        // `listDirectory` takes a folder without its trailing slash.
        const listed = yield* Effect.result(
          listDirectory(folder.replace(/\/+$/, "")),
        );
        if (Result.isFailure(listed)) {
          if (Predicate.isTagged(listed.failure, "FileGone")) continue;
          return yield* Effect.fail(listed.failure);
        }
        for (const path of [...listed.success.paths].sort()) {
          if (entries === WORK_FILES_LISTED) return done(true);
          entries += 1;
          if (path.endsWith("/")) next.push(path);
          else files.push(path);
        }
      }
      level = next;
    }
    return done(false);
  });

/** WHY A KEEP LEFT FILES OUT, in one sentence — none when it left nothing
 *  out. Here beside the two limits, because it is the one place that says
 *  them: the files that did not fit in {@link WORK_FILES_KEPT_BYTES}, and a
 *  listing that stopped at {@link WORK_FILES_LISTED}. */
export const notKeptWhy = (left: {
  readonly tooBig: ReadonlyArray<string>;
  readonly more: boolean;
}): Option.Option<string> => {
  const why = [
    ...(left.tooBig.length === 0
      ? []
      : [
          `${left.tooBig.map(waterfallFileName).join(", ")} did not fit in the ${formatBytes(WORK_FILES_KEPT_BYTES)} kolu keeps of a work`,
        ]),
    ...(left.more
      ? [
          `kolu stopped listing ${WATERFALL_DIR} at ${WORK_FILES_LISTED} files and folders`,
        ]
      : []),
  ];
  return why.length === 0 ? Option.none() : Option.some(why.join("; "));
};
