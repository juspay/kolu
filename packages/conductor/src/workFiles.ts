/**
 * THE FILES OF A PIECE OF WORK, as the host reaches them — listed where the
 * work is happening, and copied into kolu when it ends.
 *
 * A PORT and nothing else, in a file of its own: its implementor lives in
 * another package (`kolu-server`'s `conductor/workFiles.ts`, over the padi
 * client of the host the member terminal is on), and a reader following one
 * end to the other should not have to find the declaration inside a module
 * about something else.
 *
 * Everything about it is volatile in a way the record is not: which daemon
 * answers, how a remote file is read back, where this machine's state root is.
 * What the work holds is a list of paths and, at the end, how many bytes of
 * each were kept.
 *
 * {@link workDirOf} is here for the same reason the port is: it is KOLU'S DISK
 * LAYOUT — the name a work's kept files sit under — and a directory-naming
 * scheme is a storage decision, not part of what a work IS. It lived in
 * `kolu-work` while nothing but its purity was asked of it, and every caller
 * of it is host-side.
 */

import type { WorkFilesListed } from "kolu-common/workFiles";
import type { KeptFile, WorkId } from "kolu-work";

/** THE DIRECTORY A WORK'S KEPT FILES SIT IN, under `<stateRoot>/works/`.
 *
 *  A work id holds a repository's absolute path: it is not a file name. So
 *  the directory is a hash of it — short, stable, and filesystem-safe on
 *  every platform. FNV-1a over the id's code units, twice (two 32-bit rounds
 *  seeded differently) for a 64-bit name. */
export const workDirOf = (id: WorkId): string => {
  const fnv = (seed: number): string => {
    let hash = seed;
    for (let at = 0; at < id.length; at += 1) {
      hash ^= id.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return `${fnv(0x811c9dc5)}${fnv(0x7fffffff)}`;
};

/** WHAT A KEEP DID — what the work's directory holds now, and the paths it
 *  left out because they would have taken that directory past
 *  `WORK_FILES_KEPT_BYTES` (`kolu-common/workFiles`). */
export interface WorkFilesKept {
  readonly kept: ReadonlyArray<KeptFile>;
  readonly tooBig: ReadonlyArray<string>;
}

export interface WorkFiles {
  /** Every file under `<worktree>/.waterfall/` on `host`, at any depth,
   *  worktree-relative (".waterfall/mockup/fonts/a.woff2") and in tree
   *  order — read by `kolu-common/workFiles`' one walk, so `more` says
   *  whether it stopped at its limit. An absent directory is no files.
   *  Rejects (with a sentence) when the host cannot be read. */
  list(at: { host: string; worktree: string }): Promise<WorkFilesListed>;
  /** Copy those files into `<stateRoot>/works/<work>/<path>` on THIS machine,
   *  in tree order (top-level files first), fetched through the host
   *  daemon's existing file read. The work's directory holds at most `WORK_FILES_KEPT_BYTES` in all,
   *  counting what an earlier ending of the same work left there: a file
   *  that would take it past that is skipped (and named in `tooBig`), and a
   *  smaller one after it can still land. */
  keep(at: {
    host: string;
    worktree: string;
    work: string;
    paths: ReadonlyArray<string>;
  }): Promise<WorkFilesKept>;
  /** RECONCILE the kept files to the works kolu still has: delete every
   *  `<stateRoot>/works/<id>` directory whose id is not in `keep`.
   *
   *  One rule rather than "delete this work's files", because the set of works
   *  can shrink in two ways — the history cap drops the oldest finished one,
   *  and a restored backup replaces the lot — and a per-work delete leaves the
   *  second one's orphans on disk for ever. A missing root is nothing to do. */
  sweep(keep: ReadonlyArray<string>): Promise<void>;
}
