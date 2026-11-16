import type { GitFact } from "@kolu/terminal-vocab/schema";

/** Who can list the focused pane's root for the Code tab.
 *
 *  - `"git"` — an ordinary checkout: the file list, ignored overlay, status and
 *    diffs all come from git.
 *  - `"disk"` — a repo with no working tree at its root (a bare repository's
 *    folder): git has no file list there, so the tree is read from disk one
 *    folder at a time, and the Code tab is browse-only.
 *  - `null` — nothing to list: git has not answered yet, or the cwd is not in
 *    a repository.
 *
 *  The ONE place this question is answered; every Code-tab reader asks it here.
 *  A folder outside any repository is `null` today and shows "Not in a git
 *  repository" — reading such a folder from disk (#2394) is an arm added here. */
export type CodeLister = "git" | "disk";

export function codeLister(git: GitFact | undefined): CodeLister | null {
  if (git?.kind !== "repo") return null;
  return git.info.isBare ? "disk" : "git";
}
