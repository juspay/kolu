/** Pure mapping from kolu-git's porcelain status to Pierre's `GitStatusEntry`
 *  word form — no DOM, no toast, so it's unit-testable in a plain node env.
 *  The imperative tree-context-menu renderer lives next door in
 *  `pierreAdapters.ts` (which pulls `solid-sonner` and the clipboard). */

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

export function toGitStatusEntries(
  files: { path: string; status: GitChangeStatus }[],
): GitStatusEntry[] {
  return files.map((f) => ({
    path: f.path,
    status: GIT_STATUS_WORD[f.status],
  }));
}

/** Overlay two git-status layers into one decoration set, keyed by path.
 *  `fallback` is laid down first, then `primary` overwrites on conflict — so a
 *  path present in both takes its `primary` word. The Code-tab "All files" view
 *  uses this to overlay local status (primary) on branch status (fallback):
 *  "prefer Local". Order of the returned array is unspecified — Pierre matches
 *  entries to rows by `path`. */
export function mergeGitStatusEntries(
  primary: { path: string; status: GitChangeStatus }[],
  fallback: { path: string; status: GitChangeStatus }[],
): GitStatusEntry[] {
  const byPath = new Map<string, GitStatusEntry>();
  for (const f of fallback) {
    byPath.set(f.path, { path: f.path, status: GIT_STATUS_WORD[f.status] });
  }
  for (const f of primary) {
    byPath.set(f.path, { path: f.path, status: GIT_STATUS_WORD[f.status] });
  }
  return [...byPath.values()];
}
