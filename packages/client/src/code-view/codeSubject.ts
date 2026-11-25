/** WHAT A CODE VIEW IS ABOUT — its subject, built by whoever mounts the view.
 *
 *  Four facts, all from ONE read by the caller, and nothing the view reads
 *  about them from anywhere else:
 *
 *  - **whose place** it shows (an opaque {@link CodeOwner} the caller mints)
 *    — the owner an open request is scoped to. It comes in the same value as
 *    the root, so the view can never pair one owner with another's root;
 *  - **the host** the root is on — every read the view makes, and the address
 *    of a picture or a download, go to THIS host, never to whichever host the
 *    page happens to show;
 *  - **where git stands** — not read yet, not a repository, or a root and who
 *    lists it ({@link CodeLister}: git, or the disk for a folder git cannot
 *    list);
 *  - **a terminal, or none** — what a picture's and a download's address
 *    hangs on. Nothing else in the view needs one: the tree, the diffs and a
 *    text file are read by path;
 *  - **whose comments**, or none — the terminal's own queue for the Right
 *    panel, the work's for a work's view ({@link CommentQueue}). Its own
 *    fact: a work's comments never depend on which terminal is up. */

import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import type { CommentQueue } from "../comments/types";
import type { CodeLister } from "./codeLister";
import type { CodeOwner } from "./codeTabOpenController";

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
  /** `null` while there is nobody whose place to show (no pane). */
  readonly owner: CodeOwner | null;
  readonly host: HostKey;
  readonly git: CodeGit;
  readonly terminalId: TerminalId | null;
  /** The queue the view's comments are filed in, or `null` where nothing
   *  can be commented. */
  readonly comments: CommentQueue | null;
}

/** The one line for bytes that only a terminal's file route can fetch — a
 *  picture, a download — when the subject has no terminal standing in its
 *  root. Text and diffs are read by path and never need it. */
export function noTerminalToFetch(path: string): string {
  return `No terminal is up in this worktree to fetch ${path} through`;
}
