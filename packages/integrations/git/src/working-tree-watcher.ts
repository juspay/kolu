/**
 * Refcounted shared working-tree watcher.
 *
 * Catches axis 4 — editor saves, file create/delete/rename inside the repo.
 * Sibling to the three git-dir watchers (HEAD/reflog/index); together they
 * cover every filesystem-observable cause of "the Code view's data has
 * changed."
 *
 * Backed by `@parcel/watcher`. We chose it over chokidar specifically
 * because:
 *   - macOS uses native recursive FSEvents (one stream per repo, not one
 *     per directory).
 *   - Windows uses native recursive ReadDirectoryChangesW.
 *   - Auto-detects the watchman daemon if installed → zero per-process
 *     inotify watches on Linux for users who opt in.
 *   - VS Code switched here in 1.62 for the same reasons.
 *
 * On Linux without watchman both libraries pay one inotify slot per
 * directory — that's a kernel constraint, not a library choice. With
 * `.git`, `node_modules`, and common build outputs ignored, a typical repo
 * uses ~500–2000 slots out of the kernel's default budget.
 *
 * Container/WSL2 caveat: parcel-watcher silently falls back to ~1s polling
 * when neither inotify nor FSEvents nor watchman is available (e.g.
 * dev-containers on bind-mounted filesystems). Latency degrades but
 * correctness is preserved.
 *
 * Subscribers can pass a `filePath` to receive only events for that exact
 * file (the `BrowseFileView` case — one selected file, not the whole tree)
 * or omit it to receive every event (the `subscribeRepoChange` case). The
 * filter happens at the listener layer so a single shared watcher serves
 * both consumers — no separate single-file watcher module needed.
 */

import path from "node:path";
import {
  type AsyncSubscription,
  subscribe as parcelSubscribe,
} from "@parcel/watcher";
import type { Logger } from "kolu-shared";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

/** Hard-coded ignore list. Globs are matched against paths relative to the
 *  watched repo root by parcel-watcher's picomatch integration. The leading
 *  `**\/` wildcards catch nested instances (e.g. `packages/foo/node_modules`).
 *
 *  Not gitignore-aware. We accept some over-firing on user-generated build
 *  outputs that aren't in this list — the upstream debounce + the streaming
 *  endpoint's snapshot equality check absorb noise events. */
const IGNORE_GLOBS = [
  "**/.git",
  "**/.git/**",
  "**/node_modules",
  "**/node_modules/**",
  "**/.kolu-dev",
  "**/.kolu-dev/**",
  "**/.kolu-state",
  "**/.kolu-state/**",
  "**/dist",
  "**/dist/**",
  "**/build",
  "**/build/**",
  "**/target",
  "**/target/**",
  "**/.next",
  "**/.next/**",
  "**/.turbo",
  "**/.turbo/**",
  "**/.cache",
  "**/.cache/**",
  "**/.parcel-cache",
  "**/.parcel-cache/**",
  "**/.DS_Store",
];

interface Listener {
  /** Absolute path to match against incoming events, or `null` to receive
   *  every event (no filter). */
  matchAbs: string | null;
  onChange: () => void;
}

interface SharedWorkingTreeWatcher {
  subscribe(filePath: string | undefined, onChange: () => void): () => void;
}

const sharedWorkingTreeWatchers = new Map<string, SharedWorkingTreeWatcher>();

function installSharedWorkingTreeWatcher(
  repoRoot: string,
  onLast: () => void,
  log?: Logger,
): SharedWorkingTreeWatcher {
  const listeners = new Set<Listener>();
  const pending = new Set<Listener>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: AsyncSubscription | null = null;
  let cancelled = false;

  // Async install. Until the promise resolves, listeners can attach but no
  // events fire. The window is small (parcel does its initial readdir
  // walk); events during the gap are missed, which is acceptable for our
  // "snapshot on subscribe + live updates" model — the streaming endpoint
  // yields a fresh snapshot before subscribing here.
  parcelSubscribe(
    repoRoot,
    (err, events) => {
      if (cancelled) return;
      if (err) {
        log?.error(
          { err: err.message, repoRoot },
          "git: working-tree watcher callback error",
        );
        return;
      }

      // Bucket events into the listeners they match. A single batch can
      // hit several listeners (different filePaths) or none (all-ignored
      // paths slipped through somehow).
      for (const event of events) {
        for (const listener of listeners) {
          if (listener.matchAbs === null || listener.matchAbs === event.path) {
            pending.add(listener);
          }
        }
      }

      if (pending.size === 0) return;

      // Trailing-edge debounce — a burst of events fires the listeners
      // exactly once, after the burst settles. Reset on every new batch.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const fired = [...pending];
        pending.clear();
        for (const listener of fired) {
          try {
            listener.onChange();
          } catch (e) {
            log?.error(
              { err: e instanceof Error ? e.message : String(e), repoRoot },
              "git: working-tree listener threw",
            );
          }
        }
      }, WATCHER_DEBOUNCE_MS);
    },
    { ignore: IGNORE_GLOBS },
  )
    .then((sub) => {
      if (cancelled) {
        void sub.unsubscribe().catch((e: Error) => {
          log?.error(
            { err: e.message, repoRoot },
            "git: working-tree late-unsubscribe failed",
          );
        });
        return;
      }
      subscription = sub;
      log?.info({ repoRoot }, "git: working-tree watcher installed");
    })
    .catch((e: Error) => {
      log?.error(
        { err: e.message, repoRoot },
        "git: working-tree watcher install failed",
      );
    });

  return {
    subscribe(filePath, onChange) {
      const matchAbs =
        filePath === undefined ? null : path.resolve(repoRoot, filePath);
      const listener: Listener = { matchAbs, onChange };
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener)) return;
        pending.delete(listener);
        if (listeners.size === 0) {
          if (timer) clearTimeout(timer);
          cancelled = true;
          if (subscription) {
            void subscription.unsubscribe().catch((e: Error) => {
              log?.error(
                { err: e.message, repoRoot },
                "git: working-tree unsubscribe failed",
              );
            });
            subscription = null;
          }
          onLast();
          log?.info({ repoRoot }, "git: working-tree watcher retired");
        }
      };
    },
  };
}

export interface WatchWorkingTreeOptions {
  /** Restrict events to a specific file (repo-relative path). When omitted,
   *  the listener fires for every event in the working tree. */
  filePath?: string;
}

/**
 * Subscribe to working-tree changes for `repoRoot`. Returns a cleanup
 * function. N callers on the same `repoRoot` collapse to one shared
 * `@parcel/watcher` subscription; each listener installs its own optional
 * filePath filter without installing a separate OS handle.
 */
export function watchWorkingTree(
  repoRoot: string,
  onChange: () => void,
  log?: Logger,
  options?: WatchWorkingTreeOptions,
): () => void {
  let entry = sharedWorkingTreeWatchers.get(repoRoot);
  if (!entry) {
    entry = installSharedWorkingTreeWatcher(
      repoRoot,
      () => sharedWorkingTreeWatchers.delete(repoRoot),
      log,
    );
    sharedWorkingTreeWatchers.set(repoRoot, entry);
  }
  return entry.subscribe(options?.filePath, onChange);
}

/** Test-only inspector — number of distinct repoRoots with active shared
 *  working-tree watchers. Mirrors `_sharedHeadWatcherCount`. */
export function _sharedWorkingTreeWatcherCount(): number {
  return sharedWorkingTreeWatchers.size;
}
