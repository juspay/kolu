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

/** The one field pair this mapping reads off a wire status row. Structural and
 *  `readonly`, so a decoded (readonly) `GitStatusOutput.files` row satisfies it
 *  directly — the decoded shape is consumed as-is, never copied to strip a
 *  `readonly`. */
type GitStatusFile = {
  readonly path: string;
  readonly status: GitChangeStatus;
};

/** Overlay two git-status layers into one decoration set, keyed by path.
 *  `fallback` is laid down first, then `primary` overwrites on conflict — so a
 *  path present in both takes its `primary` word. The Code-tab "All files" view
 *  uses this to overlay local status (primary) on branch status (fallback):
 *  "prefer Local". Order of the returned array is unspecified — Pierre matches
 *  entries to rows by `path`. */
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

/** Pairwise equality for two decoration sets, in the order
 *  {@link mergeGitStatusEntries} produced them. A status pulse that changed
 *  nothing re-derives an equal-but-fresh array; Pierre rolls every entry up
 *  into its ancestors' change counters on each application, so a memo that
 *  publishes such an array pays that whole roll-up for no change. Used as a
 *  memo `equals`, which is why `undefined` (no status stream yet) is a value
 *  here and only equals itself.
 *
 *  Order-sensitive on purpose: the producer builds both sides the same way
 *  from the same two layers, so equal inputs give equal order, and a sort
 *  would put O(n log n) on the per-pulse path to catch nothing. */
export function sameGitStatusEntries(
  a: readonly GitStatusEntry[] | undefined,
  b: readonly GitStatusEntry[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((entry, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      entry.path === other.path &&
      entry.status === other.status
    );
  });
}
