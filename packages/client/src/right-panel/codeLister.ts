import type { CodeTabView } from "@kolu/padi-client/surface";
import type { GitFact } from "@kolu/terminal-vocab/schema";
import type { GitInfo } from "kolu-git/schemas";

/** Who can list a Code view's root, from the git reading of the terminal
 *  standing in it.
 *
 *  - `"git"` — an ordinary checkout: the file list, ignored overlay, status and
 *    diffs all come from git.
 *  - `"disk"` — a repo with no working tree at its root (a bare repository's
 *    folder): git has no file list there, so the tree is read from disk one
 *    folder at a time, and the Code view is browse-only.
 *  - `null` — nothing to list: git has not answered yet, or the cwd is not in
 *    a repository.
 *
 *  The ONE place this question is answered; every Code-tab reader asks it here.
 *  A folder outside any repository is `null` today and shows "Not in a git
 *  repository" — reading such a folder from disk (#2394) is an arm added here. */
export type CodeLister = "git" | "disk";

export function codeLister(git: GitFact | undefined): CodeLister | null {
  return git?.kind === "repo" ? repoLister(git.info) : null;
}

/** Who lists a root git has read. */
export function repoLister(info: GitInfo): CodeLister {
  return info.isBare ? "disk" : "git";
}

/** The mode a Code view SHOWS, from the mode its home stores. A root git
 *  cannot list (`"disk"`) has nothing to diff, so it browses whatever mode is
 *  stored; the stored mode is not written, so it comes back when the view is
 *  about a working tree again. Said once, here, for every home a Code view's
 *  place is kept in. */
export function codeModeFor(
  lister: CodeLister | null,
  stored: CodeTabView,
): CodeTabView {
  return lister === "disk" ? "browse" : stored;
}
