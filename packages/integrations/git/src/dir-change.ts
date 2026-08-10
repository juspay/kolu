/**
 * `subscribeDirChange(rootPath, dirPath)` — the WATCH counterpart to
 * `browse.ts`'s `listDirectory`, for browse roots that are NOT git repos
 * (plain-directory browsing in the Code tab). Where `subscribeRepoChange`
 * stands on the recursive, gitignore-pruned working-tree watcher — affordable
 * only because git's ignore listing bounds it — this subscribes ONE directory,
 * non-recursively, so watching stays cheap no matter how large the subtree
 * beneath it is. Lazy listing and lazy watching are the same decision: only
 * what the user expanded is ever read or watched.
 *
 * Same traversal guard as every browse read — the directory key arrives over
 * the wire, so it resolves through `resolveExistingUnder` (lexical +
 * symlink-resolving) before any handle attaches. Resolution is async, so the
 * unsubscribe returns synchronously and the handle attaches on a later tick
 * (the `refcounted-dir-watcher` install pattern); a change landing in that
 * window is covered by the post-attach reconcile tick.
 */

import { subscribeDirChildren } from "kolu-io";
import type { Logger } from "kolu-shared";
import { resolveExistingUnder } from "./safe-path.ts";

/** Subscribe to debounced change ticks for one directory's direct children,
 *  `dirPath` relative to `rootPath` (`""` for the root itself). Returns the
 *  unsubscribe synchronously. A path that fails resolution — escaped root,
 *  vanished directory — installs nothing (the paired `listDirectory` read is
 *  the loud authority on that failure; `resolveExistingUnder` already logs the
 *  escape at error level). */
export function subscribeDirChange(
  rootPath: string,
  dirPath: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  void (async () => {
    const resolved = await resolveExistingUnder(rootPath, dirPath, log);
    if (cancelled || !resolved.ok) return;
    unsubscribe = subscribeDirChildren(resolved.value.abs, onChange, log);
    // Post-install reconciliation: the consumer snapshots (listDirectory) and
    // THEN subscribes; the realpath resolution above lands this attach a tick
    // later, and a change inside that window is in neither the snapshot nor a
    // future event. One reconcile tick makes the consumer re-read and
    // converge — same lost-update protection as `refcounted-dir-watcher`.
    try {
      onChange();
    } catch (e) {
      log?.error(
        { err: e instanceof Error ? e.message : String(e), rootPath, dirPath },
        "dir-change reconcile listener threw",
      );
    }
  })();
  return () => {
    cancelled = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}
