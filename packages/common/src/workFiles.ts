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

/** THE WALK. Answers every file under `.waterfall/`, and whether it stopped
 *  at {@link WORK_FILES_LISTED}. */
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
    let level: ReadonlyArray<string> = [WATERFALL_DIR.slice(0, -1)];
    while (level.length > 0) {
      const next: string[] = [];
      for (const folder of level) {
        const listed = yield* Effect.result(listDirectory(folder));
        if (Result.isFailure(listed)) {
          if (Predicate.isTagged(listed.failure, "FileGone")) continue;
          return yield* Effect.fail(listed.failure);
        }
        for (const path of [...listed.success.paths].sort()) {
          if (entries === WORK_FILES_LISTED) return done(true);
          entries += 1;
          if (path.endsWith("/")) next.push(path.slice(0, -1));
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
