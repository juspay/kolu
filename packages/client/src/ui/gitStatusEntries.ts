/** Pure mapping from kolu-git's porcelain status to Pierre's `GitStatusEntry`
 *  word form. */

import type { GitStatusEntry } from "@kolu/solid-pierre";
import type { GitChangeStatus } from "kolu-git/schemas";

const GIT_STATUS_WORD: Record<GitChangeStatus, GitStatusEntry["status"]> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  U: "modified",
  T: "modified",
  "?": "untracked",
};

/** The one field pair this mapping reads off a wire status row. */
type GitStatusFile = {
  readonly path: string;
  readonly status: GitChangeStatus;
};

/** Overlay two git-status layers into one decoration set, keyed by path:
 *  `fallback` first, then `primary` overwrites on conflict. Order of the
 *  returned array is unspecified — Pierre matches entries to rows by `path`. */
export function mergeGitStatusEntries(
  primary: readonly GitStatusFile[],
  fallback: readonly GitStatusFile[],
): GitStatusEntry[] {
  const toEntry = (f: GitStatusFile): GitStatusEntry => ({
    path: f.path,
    status: GIT_STATUS_WORD[f.status],
  });
  const byPath = new Map<string, GitStatusEntry>(
    fallback.map((f) => [f.path, toEntry(f)]),
  );
  for (const f of primary) {
    byPath.set(f.path, toEntry(f));
  }
  return [...byPath.values()];
}
