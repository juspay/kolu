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
    if (closed) return;
    try {
      own = fs.watch(dir, () => {
        if (!closed) onChange();
      });
    } catch {
      return; // still absent (or unwatchable) — ancestor watch will retry us
    }
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
    }
  }

  return () => {
    if (closed) return;
    closed = true;
    own?.close();
    ancestorStop?.();
  };
}
