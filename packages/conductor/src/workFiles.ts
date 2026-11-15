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

export interface WorkFiles {
  /** Worktree-relative paths (".waterfall/plan.md") of the files directly in
   *  `<worktree>/.waterfall/` on `host`; `[]` when the directory is absent.
   *  Rejects (with a sentence) when the host cannot be read. */
  list(at: { host: string; worktree: string }): Promise<ReadonlyArray<string>>;
  /** Copy those files into `<stateRoot>/works/<work>/<path>` on THIS machine,
   *  fetched through the host daemon's existing file read; answers what
   *  landed. */
  keep(at: {
    host: string;
    worktree: string;
    work: string;
    paths: ReadonlyArray<string>;
  }): Promise<ReadonlyArray<KeptFile>>;
  /** RECONCILE the kept files to the works kolu still has: delete every
   *  `<stateRoot>/works/<id>` directory whose id is not in `keep`.
   *
   *  One rule rather than "delete this work's files", because the set of works
   *  can shrink in two ways — the history cap drops the oldest finished one,
   *  and a restored backup replaces the lot — and a per-work delete leaves the
   *  second one's orphans on disk for ever. A missing root is nothing to do. */
  sweep(keep: ReadonlyArray<string>): Promise<void>;
}
