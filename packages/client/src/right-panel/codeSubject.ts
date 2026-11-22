/** WHAT A CODE VIEW IS ABOUT — its subject, built by whoever mounts the view.
 *
 *  Three facts, and nothing the view reads about them from anywhere else:
 *
 *  - **the host** the root is on — every read the view makes, and the address
 *    of a picture or a download, go to THIS host, never to whichever host the
 *    page happens to show;
 *  - **where git stands** — not read yet, not a repository, or a root and who
 *    lists it ({@link CodeLister}: git, or the disk for a folder git cannot
 *    list);
 *  - **a terminal, or none** — what a picture's and a download's address and
 *    the comments hang on. Nothing else in the view needs one: the tree, the
 *    diffs and a text file are read by path.
 *
 *  The Right panel's subject is its focused pane ({@link codeSubjectOf}). */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { GitFact } from "@kolu/terminal-vocab/schema";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type CodeLister, repoLister } from "./codeLister";

/** Where git stands for a Code view's subject. `unresolved` is git not having
 *  answered yet, which is drawn blank rather than guessed at; `none` is an
 *  answer — not in a repository. */
export type CodeGit =
  | { readonly kind: "unresolved" }
  | { readonly kind: "none" }
  | {
      readonly kind: "repo";
      readonly root: string;
      readonly lister: CodeLister;
    };

export interface CodeSubject {
  readonly host: HostKey;
  readonly git: CodeGit;
  readonly terminalId: TerminalId | null;
}

/** A terminal's git reading as a Code view's {@link CodeGit}. No reading at
 *  all — no terminal shown — is no repository either. */
export function codeGitOf(git: GitFact | undefined): CodeGit {
  if (git === undefined) return { kind: "none" };
  if (git.kind !== "repo") return { kind: git.kind };
  return {
    kind: "repo",
    root: git.info.repoRoot,
    lister: repoLister(git.info),
  };
}

/** The subject of a Code view about ONE TERMINAL — the Right panel's focused
 *  pane: its host, its own git reading, and the terminal itself. */
export function codeSubjectOf(
  host: HostKey,
  terminalId: TerminalId | null,
  meta: TerminalMetadata | null,
): CodeSubject {
  return { host, git: codeGitOf(meta?.git), terminalId };
}

/** The one line for bytes that only a terminal's file route can fetch — a
 *  picture, a download — when the subject has no terminal standing in its
 *  root. Text and diffs are read by path and never need it. */
export function noTerminalToFetch(path: string): string {
  return `No terminal is up in this worktree to fetch ${path} through`;
}
