/** `watchDirWhenReady` — attach an `fs.watch` to a directory that may not
 *  exist yet, waiting up the ancestor chain until it appears.
 *
 *  A plain `fs.watch(dir)` throws when `dir` is absent, and the caller that
 *  catches ENOENT has no signal for "the dir just got created" — the exact
 *  race an agent integration hits when it starts watching before the agent
 *  has ever run on the machine (`~/.pi/agent/sessions`, `~/.claude/sessions`
 *  on a fresh host). Retrying on a timer would work but adds a poll knob;
 *  watching the nearest existing ANCESTOR and descending as each level
 *  appears is event-driven and needs none.
 *
 *  A non-ENOENT attach failure (EMFILE/ENOSPC on inotify watches, EACCES) is
 *  LOUD and final for this subscription: it hits the error log once, the
 *  chain gives up, and the consumer's event flow stays dark until it
 *  re-subscribes or the process restarts. Deliberately no retry — the
 *  install contract of its consumer (`AgentAdapter.externalChanges`) is
 *  at-most-once, so a transient inotify exhaustion is a long blind window
 *  either way; the surfaced error, not a hidden poll, is the fix signal
 *  (raise `fs.inotify.max_user_watches`).
 *
 *  Semantics:
 *   - If `dir` exists, watch attaches synchronously and `onChange` fires once
 *     immediately (a reconcile kick: entries may have landed between the
 *     caller's earlier probe and the attach — never lose that window).
 *   - If `dir` (or any ancestor) is absent, the nearest existing ancestor is
 *     watched; each descendant level re-attaches as it appears, firing
 *     `onChange` once when the target watch finally attaches.
 *   - The returned unsubscribe tears the whole chain down and is idempotent.
 *
 *  This is the shared, level-general form of the ancestor-wait logic
 *  claude-code's `watchOrWaitForDir` carries privately; new consumers should
 *  live here rather than re-growing a copy per integration. */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "@kolu/log";

export function watchDirWhenReady(
  dir: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  let closed = false;
  let own: fs.FSWatcher | null = null;
  let ancestorStop: (() => void) | null = null;

  const attach = (): void => {
    if (closed || own) return; // already attached (ancestor event re-entry)
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, () => {
        if (!closed) onChange();
      });
    } catch (err) {
      // ENOENT is the expected "not there yet" — the ancestor watch retries
      // us. Anything else (EMFILE/ENOSPC on inotify watches, EACCES) kills
      // the watcher tree silently if swallowed, so it must hit the log.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.error({ err, dir }, "dir-appear watcher: fs.watch failed");
      }
      return;
    }
    own = watcher;
    // Attached: the ancestor chain has served its purpose — retire it, then
    // kick so anything written into `dir` before the attach is not missed.
    ancestorStop?.();
    ancestorStop = null;
    log?.info({ dir }, "dir-appear watcher attached");
    onChange();
  };

  attach();
  if (!own) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Filesystem root itself unwatchable — nothing above to wait on.
      log?.error({ dir }, "dir-appear watcher: no watchable ancestor");
    } else {
      ancestorStop = watchDirWhenReady(parent, attach, log);
      // The ancestor wire-up above fired `attach` synchronously if the
      // target appeared in the interim — if so, the just-returned stop
      // handle belongs to an already-retired chain (attach() retired the
      // PREVIOUS stop, not this one). Retire it now.
      if (own && ancestorStop) {
        ancestorStop();
        ancestorStop = null;
      }
    }
  }

  return () => {
    if (closed) return;
    closed = true;
    own?.close();
    ancestorStop?.();
  };
}
