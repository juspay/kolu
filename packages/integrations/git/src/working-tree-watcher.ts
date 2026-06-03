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
 * directory — that's a kernel constraint, not a library choice. With git's
 * ignored paths (`node_modules`, gitignored build outputs) pruned, a typical
 * repo uses ~500–2000 slots out of the kernel's default budget.
 *
 * Container/WSL2 caveat: parcel-watcher silently falls back to ~1s polling
 * when neither inotify nor FSEvents nor watchman is available (e.g.
 * dev-containers on bind-mounted filesystems). Latency degrades but
 * correctness is preserved.
 *
 * The ignore set is derived from git, not a hardcoded list: `listIgnoredPaths`
 * runs the exact complement of the browse tree's `git ls-files --cached
 * --others --exclude-standard`, so *anything the Code-tab tree shows is
 * watched* and anything git ignores is skipped. That single source of truth is
 * what lets Atlas's **committed** `docs/atlas/dist/*.html` live-reload while a
 * normal repo's **gitignored** `dist/` stays unwatched — the two used to
 * disagree (tree gitignore-aware, watcher hardcoded), which silently broke
 * live-reload for committed build outputs. `.git` is added explicitly (git
 * never lists its own dir; the git-dir watchers cover it). The set is a
 * snapshot at install time — a `.gitignore` edit mid-watch isn't reflected
 * until the next (re)subscribe.
 *
 * Subscribers can pass a `filePath` to receive only events for that exact file
 * (the `BrowseFileView` case — one selected file, not the whole tree) or omit
 * it to receive every event (the `subscribeRepoChange` case). The filter
 * happens at the listener layer, so a single shared watcher per repo serves
 * both consumers — no separate single-file watcher.
 */

import path from "node:path";
import {
  type AsyncSubscription,
  subscribe as parcelSubscribe,
} from "@parcel/watcher";
import type { Logger } from "kolu-shared";
import { listIgnoredPaths } from "./browse.ts";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

/** `.git` is always ignored: git never lists its own dir, and the git-dir
 *  watchers (HEAD/reflog/index) cover the parts we care about — watching it
 *  here would just fire on every git operation. */
const ALWAYS_IGNORE_RELS = [".git"];

/** Degraded fallback when git can't enumerate ignores (not a repo, git error).
 *  Keeps `node_modules` — the one unbounded recursive subtree whose watch
 *  actually threatens the inotify budget — out of the watch, so a git hiccup
 *  can't unleash a watch storm. The healthy path derives the full set from
 *  git via `listIgnoredPaths`. */
const FALLBACK_IGNORE_RELS = ["node_modules"];

/** Absolute paths parcel must not emit events for. parcel treats a non-glob
 *  path entry as "ignore this file/dir and all its children", so absolute
 *  directory paths prune whole subtrees. */
async function computeIgnore(
  repoRoot: string,
  log?: Logger,
): Promise<string[]> {
  const ignored = await listIgnoredPaths(repoRoot, log);
  let rels: string[];
  if (ignored.ok) {
    rels = [...ALWAYS_IGNORE_RELS, ...ignored.value];
  } else {
    log?.warn(
      { repoRoot },
      "git: working-tree ignore enumeration failed, using fallback ignore set",
    );
    rels = [...ALWAYS_IGNORE_RELS, ...FALLBACK_IGNORE_RELS];
  }
  return rels.map((rel) => path.resolve(repoRoot, rel));
}

interface Listener {
  /** Absolute path to match against incoming events, or `null` to receive
   *  every event (no filter). */
  matchAbs: string | null;
  onChange: () => void;
}

interface SharedWorkingTreeWatcher {
  subscribe(matchAbs: string | null, onChange: () => void): () => void;
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

  /** Fire all current listeners after a debounce. Both real events and the
   *  post-install reconciliation share this dispatch path. */
  const scheduleFire = (): void => {
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
  };

  // Async install: derive the ignore set from git, then subscribe. Filesystem
  // mutations between this call and parcel's resolve are invisible to parcel —
  // the streaming endpoint already yielded its initial snapshot before this
  // ran, so any change landing in that window leaves the client with a stale
  // view that no future event would correct on its own. Fire a synthetic tick
  // once parcel is ready so consumers re-read state and reconcile.
  void (async () => {
    const ignore = await computeIgnore(repoRoot, log);
    if (cancelled) return;
    try {
      const sub = await parcelSubscribe(
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
              if (
                listener.matchAbs === null ||
                listener.matchAbs === event.path
              ) {
                pending.add(listener);
              }
            }
          }

          if (pending.size === 0) return;

          // Trailing-edge debounce — a burst of events fires the listeners
          // exactly once, after the burst settles. Reset on every new batch.
          scheduleFire();
        },
        { ignore },
      );

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

      // Reconcile any mutations that landed in the install window — parcel
      // didn't see them, but the listener's own re-read will. Add every
      // current listener to `pending` (the filter doesn't matter here;
      // reconciliation is a "re-derive your state" signal, not a path-specific
      // event) and schedule one debounced fire.
      if (listeners.size > 0) {
        for (const listener of listeners) pending.add(listener);
        scheduleFire();
      }
    } catch (e) {
      log?.error(
        { err: e instanceof Error ? e.message : String(e), repoRoot },
        "git: working-tree watcher install failed",
      );
    }
  })();

  return {
    subscribe(matchAbs, onChange) {
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
 *
 * The watch is always rooted at `repoRoot`; the optional `filePath` only
 * narrows which events a listener receives (it's resolved to an absolute path
 * and compared against parcel's event paths), so it can't steer the watch root
 * or escape the repo.
 */
export function watchWorkingTree(
  repoRoot: string,
  onChange: () => void,
  log?: Logger,
  options?: WatchWorkingTreeOptions,
): () => void {
  const matchAbs =
    options?.filePath === undefined
      ? null
      : path.resolve(repoRoot, options.filePath);
  let entry = sharedWorkingTreeWatchers.get(repoRoot);
  if (!entry) {
    entry = installSharedWorkingTreeWatcher(
      repoRoot,
      () => sharedWorkingTreeWatchers.delete(repoRoot),
      log,
    );
    sharedWorkingTreeWatchers.set(repoRoot, entry);
  }
  return entry.subscribe(matchAbs, onChange);
}

/** Test-only inspector — number of distinct repoRoots with active shared
 *  working-tree watchers. Mirrors `_sharedHeadWatcherCount`. */
export function _sharedWorkingTreeWatcherCount(): number {
  return sharedWorkingTreeWatchers.size;
}
