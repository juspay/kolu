/**
 * fs.watch shim for the #1754 repro.
 *
 * Both the claude-code and grok session watchers are *purely edge-triggered*:
 * they call `fs.watch(path, cb)` and re-read the transcript/events file only
 * when `cb` fires. There is no level-triggered poll / re-stat fallback.
 *
 * `fs.watch` is explicitly NOT a total function — Node's own docs say it "is
 * not 100% consistent across platforms, and is unavailable in some
 * situations", and that events "may be missing" / coalesced (macOS kqueue in
 * particular coalesces or drops an append that lands right after attach).
 *
 * This shim replaces the real `fs.watch` with a controllable one so the repro
 * can model that documented non-guarantee *deterministically*: it captures the
 * registered callbacks and lets the test decide whether to DELIVER an edge
 * (invoke the callback) or DROP it (never invoke it). Every other fs call —
 * statSync / openSync / readSync / the tail reads — runs against the REAL
 * filesystem and real temp files, so the state the watcher derives is the state
 * a real kolu would derive from the same bytes on disk. Only the *notification*
 * is under test control.
 */

import fs from "node:fs";

export interface WatchHandle {
  path: string;
  /** Deliver one "OS change event" for this watch (what a real fs.watch would
   *  fire on an append). */
  fire: () => void;
  closed: () => boolean;
}

export interface FsWatchShim {
  /** All watches registered since install, in order. */
  handles: WatchHandle[];
  /** Handles whose watched path ends with `suffix` and are still open. */
  forSuffix: (suffix: string) => WatchHandle[];
  /** Deliver one edge to every open watch whose path ends with `suffix`. */
  fireSuffix: (suffix: string) => number;
  uninstall: () => void;
}

/**
 * Install the shim. `fs.watch` is a property on the singleton `node:fs`
 * module object, which the watchers import by the same specifier — mutating it
 * here is seen by their `fs.watch(...)` calls. Restore with `uninstall()`.
 */
export function installFsWatchShim(): FsWatchShim {
  const real = fs.watch;
  const handles: WatchHandle[] = [];

  // deno-lint-ignore no-explicit-any
  const fake = ((watchPath: fs.PathLike, ...rest: any[]): fs.FSWatcher => {
    // fs.watch(path, listener) | fs.watch(path, options, listener)
    const listener = typeof rest[0] === "function" ? rest[0] : rest[1];
    let closed = false;
    const handle: WatchHandle = {
      path: String(watchPath),
      fire: () => {
        if (closed) return;
        // Mirror the real signature: (eventType, filename).
        listener?.("change", require_basename(String(watchPath)));
      },
      closed: () => closed,
    };
    handles.push(handle);
    // Minimal FSWatcher surface the watchers actually use: `.close()`.
    const watcher = {
      close: () => {
        closed = true;
      },
      // The watchers only call `.close()`, but keep the EventEmitter-ish
      // no-ops so nothing throws if that changes.
      on: () => watcher,
      ref: () => watcher,
      unref: () => watcher,
    } as unknown as fs.FSWatcher;
    return watcher;
  }) as typeof fs.watch;

  fs.watch = fake;

  return {
    handles,
    forSuffix: (suffix) =>
      handles.filter((h) => h.path.endsWith(suffix) && !h.closed()),
    fireSuffix: (suffix) => {
      const hs = handles.filter((h) => h.path.endsWith(suffix) && !h.closed());
      for (const h of hs) h.fire();
      return hs.length;
    },
    uninstall: () => {
      fs.watch = real;
    },
  };
}

function require_basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/** Sleep for `ms` using the REAL clock (the watchers use real setTimeout for
 *  their 150 ms debounce, so the repro must too). */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
