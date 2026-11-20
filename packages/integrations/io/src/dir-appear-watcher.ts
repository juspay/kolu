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
    if (closed || own) return;
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, () => {
        if (!closed) onChange();
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.error({ err, dir }, "dir-appear watcher: fs.watch failed");
      }
      return;
    }
    own = watcher;
    ancestorStop?.();
    ancestorStop = null;
    log?.info({ dir }, "dir-appear watcher attached");
    onChange();
  };

  attach();
  if (!own) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      log?.error({ dir }, "dir-appear watcher: no watchable ancestor");
    } else {
      ancestorStop = watchDirWhenReady(parent, attach, log);
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
