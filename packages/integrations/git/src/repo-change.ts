/**
 * Composed primitives that drive the live Code-view streaming endpoints.
 *
 *   `subscribeRepoChange(repoRoot)`  → axes 1+2+3+4 collapsed
 *   `subscribeFileChange(repoRoot, filePath)`  → axes 1+4 narrowed
 *
 * Both refcounted per their key, both fan out to listeners through one
 * shared upstream subscription each, both add a trailing-edge debounce
 * (150ms) that coalesces events from different watcher primitives into a
 * single tick. Listeners get an undifferentiated "something changed"
 * signal — they re-run their own query (`git status`, `git diff`,
 * `readFile`) and dedup with their own equality predicate.
 *
 * Why two primitives, not one with a config knob: `onFileContentChange`
 * (BrowseFileView) only cares about HEAD checkouts and saves to the one
 * file the user has selected. Routing it through `subscribeRepoChange`
 * would cause `git commit` and `git add` to fire wasted re-reads. Naming
 * the narrower scope as its own primitive surfaces the axis coverage at
 * the call site (Lowy: encapsulate the volatility being subscribed to).
 *
 * Extraction trigger for a future `subscribeHeadChange` (axes 1+2 only —
 * for an "ahead/behind count" UI, say): bottom-up re-assembly. Add the
 * narrower primitive only when a real consumer needs it — don't split
 * `subscribeRepoChange` speculatively.
 */

import type { Logger } from "kolu-shared";
import type { Executor } from "kolu-io";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import { watchGitHead } from "./head-watcher.ts";
import { watchGitIndex } from "./index-watcher.ts";
import { watchGitReflog } from "./reflog-watcher.ts";
import { watchWorkingTree } from "./working-tree-watcher.ts";

interface SharedComposed {
  subscribe(onChange: () => void): () => void;
}

const repoChangeWatchers = new Map<string, SharedComposed>();
const fileChangeWatchers = new Map<string, SharedComposed>();
type UpstreamInstall = (onChange: () => void) => () => void;

/** Build a composed watcher backed by N upstream `subscribe` functions.
 *  Each upstream callback fires `tick()`, which trailing-edge-debounces
 *  fan-out across the listener set. Returns the entry's `subscribe`
 *  function plus a sealed-once disposer the registry runs on last
 *  unsubscribe. */
function compose(
  upstreamInstalls: UpstreamInstall[],
  onLast: () => void,
  logLabel: string,
  logFields: Record<string, unknown>,
  log?: Logger,
): SharedComposed {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function tick(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      for (const cb of [...listeners]) {
        try {
          cb();
        } catch (e) {
          log?.error(
            { err: e instanceof Error ? e.message : String(e), ...logFields },
            `${logLabel} listener threw`,
          );
        }
      }
    }, WATCHER_DEBOUNCE_MS);
  }

  const upstreamUnsubs = upstreamInstalls.map((install) => install(tick));
  log?.info(logFields, `${logLabel} watcher installed`);

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        if (!listeners.delete(onChange)) return;
        if (listeners.size === 0) {
          if (timer) clearTimeout(timer);
          for (const u of upstreamUnsubs) u();
          onLast();
          log?.info(logFields, `${logLabel} watcher retired`);
        }
      };
    },
  };
}

function watcherPrefix(executor?: Executor): string {
  return executor ? `executor:${executor.id}` : "local";
}

function repoChangeKey(repoRoot: string, executor?: Executor): string {
  return `${watcherPrefix(executor)}\x00${repoRoot}`;
}

function fileChangeKey(
  repoRoot: string,
  filePath: string,
  executor?: Executor,
): string {
  return `${watcherPrefix(executor)}\x00${repoRoot}\x00${filePath}`;
}

function repoChangeUpstreams(
  repoRoot: string,
  log?: Logger,
  executor?: Executor,
): UpstreamInstall[] {
  if (executor) {
    return [
      (cb) =>
        watchExecutorRoot(
          executor,
          repoRoot,
          () => true,
          cb,
          "git: repo-change",
          { repoRoot, executor: executor.id },
          log,
        ),
    ];
  }
  return [
    (cb) => watchGitHead(repoRoot, cb, log),
    (cb) => watchGitReflog(repoRoot, cb, log),
    (cb) => watchGitIndex(repoRoot, cb, log),
    (cb) => watchWorkingTree(repoRoot, cb, log),
  ];
}

function fileChangeUpstreams(
  repoRoot: string,
  filePath: string,
  log?: Logger,
  executor?: Executor,
): UpstreamInstall[] {
  if (executor) {
    return [
      (cb) =>
        watchExecutorRoot(
          executor,
          repoRoot,
          (relPath) =>
            relPath === "" ||
            relPath === filePath ||
            relPath.startsWith(".git"),
          cb,
          "git: file-change",
          { repoRoot, filePath, executor: executor.id },
          log,
        ),
    ];
  }
  return [
    (cb) => watchGitHead(repoRoot, cb, log),
    (cb) => watchWorkingTree(repoRoot, cb, log, { filePath }),
  ];
}

/**
 * Subscribe to "any file or git-state change in this repo." Refcounted per
 * `repoRoot`. Composes all four watcher primitives:
 *
 *   1. `watchGitHead`          — branch identity (`.git/HEAD`)
 *   2. `watchGitReflog`        — HEAD movement (`.git/logs/HEAD`)
 *   3. `watchGitIndex`         — staging (`.git/index`)
 *   4. `watchWorkingTree`      — saves / creates / deletes / renames
 *
 * Drives `git.onStatusChange` and `git.onDiffChange`.
 */
export function subscribeRepoChange(
  repoRoot: string,
  onChange: () => void,
  log?: Logger,
  executor?: Executor,
): () => void {
  const key = repoChangeKey(repoRoot, executor);
  let entry = repoChangeWatchers.get(key);
  if (!entry) {
    entry = compose(
      repoChangeUpstreams(repoRoot, log, executor),
      () => repoChangeWatchers.delete(key),
      "git: repo-change",
      executor ? { repoRoot, executor: executor.id } : { repoRoot },
      log,
    );
    repoChangeWatchers.set(key, entry);
  }
  return entry.subscribe(onChange);
}

/**
 * Subscribe to "branch checkout, or this one file's working-tree changes."
 * Refcounted per `(repoRoot, filePath)` so two BrowseFileView consumers
 * looking at the same file share one composed entry. Reuses
 * `watchWorkingTree`'s shared upstream via its filePath filter — does NOT
 * install a separate per-file watcher.
 *
 * Drives `fs.onReadFileChange`. Reacts only to axes 1 and 4 because
 * commits and staging do not change a working-tree file's bytes.
 */
export function subscribeFileChange(
  repoRoot: string,
  filePath: string,
  onChange: () => void,
  log?: Logger,
  executor?: Executor,
): () => void {
  const key = fileChangeKey(repoRoot, filePath, executor);
  let entry = fileChangeWatchers.get(key);
  if (!entry) {
    entry = compose(
      fileChangeUpstreams(repoRoot, filePath, log, executor),
      () => fileChangeWatchers.delete(key),
      "git: file-change",
      executor
        ? { repoRoot, filePath, executor: executor.id }
        : { repoRoot, filePath },
      log,
    );
    fileChangeWatchers.set(key, entry);
  }
  return entry.subscribe(onChange);
}

function watchExecutorRoot(
  executor: Executor,
  root: string,
  accepts: (relPath: string) => boolean,
  onChange: () => void,
  logLabel: string,
  logFields: Record<string, unknown>,
  log?: Logger,
): () => void {
  let handle: { stop(): void } | null = null;
  let stopped = false;

  const tick = (relPath: string): void => {
    if (!accepts(relPath)) return;
    onChange();
  };

  void executor
    .watch(root, tick, { recursive: true })
    .then((h) => {
      if (stopped) h.stop();
      else handle = h;
    })
    .catch((err) =>
      log?.warn({ err, ...logFields }, `${logLabel} watch install failed`),
    );

  return () => {
    stopped = true;
    handle?.stop();
  };
}

/** Test-only — number of distinct (repoRoot) entries holding active
 *  shared `subscribeRepoChange` listener sets. */
export function _sharedRepoChangeCount(): number {
  return repoChangeWatchers.size;
}

/** Test-only — number of distinct (repoRoot, filePath) entries holding
 *  active shared `subscribeFileChange` listener sets. */
export function _sharedFileChangeCount(): number {
  return fileChangeWatchers.size;
}
