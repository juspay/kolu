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
 * filter happens at the listener layer, so a single shared watcher serves
 * both consumers. The one exception: a previewed file that lives under an
 * ignored build-output dir (Atlas commits and previews `docs/atlas/dist/`)
 * re-roots parcel at the file's own directory (`watchRootFor`) — otherwise
 * the repo-root ignore globs would prune the very file the user opened and
 * its live-reload would silently never fire.
 */

import path from "node:path";
import {
  type AsyncSubscription,
  subscribe as parcelSubscribe,
} from "@parcel/watcher";
import type { Logger } from "kolu-shared";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import { resolveUnder } from "./safe-path.ts";

/** Directory basenames the watch skips: VCS internals, dependency trees, and
 *  build outputs. Single source of truth — the parcel ignore globs below AND
 *  `watchRootFor` (which re-roots a single-file watch out of an ignored
 *  ancestor) both derive from this list, so "what the repo-wide watch skips"
 *  and "which previewed files the repo root would hide" can't drift apart. */
const IGNORED_DIR_BASENAMES = [
  ".git",
  "node_modules",
  ".kolu-dev",
  ".kolu-state",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  ".cache",
  ".parcel-cache",
];

/** Globs are matched against paths relative to the watched root by
 *  parcel-watcher's picomatch integration. The leading `**\/` wildcards catch
 *  nested instances (e.g. `packages/foo/node_modules`).
 *
 *  Not gitignore-aware. We accept some over-firing on user-generated build
 *  outputs that aren't in this list — the upstream debounce + the streaming
 *  endpoint's snapshot equality check absorb noise events. */
const IGNORE_GLOBS = [
  ...IGNORED_DIR_BASENAMES.flatMap((d) => [`**/${d}`, `**/${d}/**`]),
  "**/.DS_Store",
];

/** Pick the parcel watch root for a subscription.
 *
 *  The repo-wide watch (no `filePath`) roots at `repoRoot` and lets the ignore
 *  globs prune build outputs — correct, since the tree/status views don't care
 *  about `dist/`. But a single-file preview watch for a file that LIVES under
 *  an ignored dir (Atlas commits and previews `docs/atlas/dist/*.html`) would
 *  get zero events: parcel never reports an ignored path. So when the
 *  previewed file sits under an ignored ancestor, root parcel at the file's own
 *  directory instead. The ignore globs are matched relative to the watch root,
 *  so the file — now directly under the root — is no longer swallowed by
 *  `**\/dist/**`, while any `node_modules`/`.git` *within* that directory stay
 *  ignored. Files outside ignored dirs keep `repoRoot` and so keep sharing the
 *  one repo-wide watcher (no extra OS handles for the common case).
 *
 *  `rel`/`abs` must already have passed `resolveUnder` — re-rooting at a file's
 *  own directory means the ignore globs no longer protect against escaping the
 *  repo, so the lexical boundary check has to happen *before* we get here.
 *  `rel` is the normalized repo-relative path (no `..`, never absolute). */
function watchRootFor(
  repoRoot: string,
  rel: string | undefined,
  abs: string | undefined,
): string {
  if (rel === undefined || abs === undefined) return repoRoot;
  const dirSegments = rel.split(path.sep).slice(0, -1);
  if (dirSegments.some((seg) => IGNORED_DIR_BASENAMES.includes(seg))) {
    return path.dirname(abs);
  }
  return repoRoot;
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
  watchRoot: string,
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
            { err: e instanceof Error ? e.message : String(e), watchRoot },
            "git: working-tree listener threw",
          );
        }
      }
    }, WATCHER_DEBOUNCE_MS);
  };

  // Async install. Filesystem mutations between this call and parcel's
  // resolve are invisible to parcel — the streaming endpoint already
  // yielded its initial snapshot before this subscribe ran, so any change
  // landing in that window leaves the client with a stale view that no
  // future event will correct on its own. Fire a synthetic tick once
  // parcel is ready so consumers re-read state and reconcile.
  parcelSubscribe(
    watchRoot,
    (err, events) => {
      if (cancelled) return;
      if (err) {
        log?.error(
          { err: err.message, watchRoot },
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
      scheduleFire();
    },
    { ignore: IGNORE_GLOBS },
  )
    .then((sub) => {
      if (cancelled) {
        void sub.unsubscribe().catch((e: Error) => {
          log?.error(
            { err: e.message, watchRoot },
            "git: working-tree late-unsubscribe failed",
          );
        });
        return;
      }
      subscription = sub;
      log?.info({ watchRoot }, "git: working-tree watcher installed");

      // Reconcile any mutations that landed in the install window —
      // parcel didn't see them, but the listener's own re-read will. Add
      // every current listener to `pending` (the filter doesn't matter
      // here; reconciliation is a "re-derive your state" signal, not a
      // path-specific event) and schedule one debounced fire.
      if (listeners.size > 0) {
        for (const listener of listeners) pending.add(listener);
        scheduleFire();
      }
    })
    .catch((e: Error) => {
      log?.error(
        { err: e.message, watchRoot },
        "git: working-tree watcher install failed",
      );
    });

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
                { err: e.message, watchRoot },
                "git: working-tree unsubscribe failed",
              );
            });
            subscription = null;
          }
          onLast();
          log?.info({ watchRoot }, "git: working-tree watcher retired");
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
 * function. Callers sharing a watch root collapse to one shared
 * `@parcel/watcher` subscription; each listener installs its own optional
 * filePath filter without installing a separate OS handle. A single-file
 * watch whose file lives under an ignored build-output dir re-roots at that
 * file's directory (see `watchRootFor`) so it isn't pruned by the ignore
 * globs — otherwise it shares `repoRoot` with the repo-wide watch.
 */
export function watchWorkingTree(
  repoRoot: string,
  onChange: () => void,
  log?: Logger,
  options?: WatchWorkingTreeOptions,
): () => void {
  // Validate the caller-supplied filePath *before* it can steer the watch
  // root. `watchWorkingTree` is exported, so we can't trust the raw string:
  // a crafted `dist/../../../etc/passwd` would otherwise re-root parcel
  // outside the repo (re-rooting bypasses the ignore globs that are this
  // module's only other escape guard). On escape, install nothing and hand
  // back a no-op unsubscribe.
  let resolved: { abs: string; rel: string } | undefined;
  if (options?.filePath !== undefined) {
    const guard = resolveUnder(repoRoot, options.filePath, log);
    if (!guard.ok) return () => {};
    resolved = guard.value;
  }
  const watchRoot = watchRootFor(repoRoot, resolved?.rel, resolved?.abs);
  const matchAbs = resolved?.abs ?? null;
  let entry = sharedWorkingTreeWatchers.get(watchRoot);
  if (!entry) {
    entry = installSharedWorkingTreeWatcher(
      watchRoot,
      () => sharedWorkingTreeWatchers.delete(watchRoot),
      log,
    );
    sharedWorkingTreeWatchers.set(watchRoot, entry);
  }
  return entry.subscribe(matchAbs, onChange);
}

/** Test-only inspector — number of distinct watch roots with active shared
 *  working-tree watchers. Mirrors `_sharedHeadWatcherCount`. */
export function _sharedWorkingTreeWatcherCount(): number {
  return sharedWorkingTreeWatchers.size;
}
