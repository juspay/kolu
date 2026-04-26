/** Shared repo file-tree watcher.
 *
 *  Chokidar supplies cross-platform recursive notifications; git remains
 *  the source of truth for the visible tree. Each debounced burst refreshes
 *  `git ls-files --cached --others --exclude-standard`, so emitted snapshots
 *  and deltas respect `.gitignore` without duplicating git's matcher.
 */

import path from "node:path";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import type { Logger } from "anyagent";
import { err, type GitResult, ok } from "./errors.ts";
import { listAll } from "./browse.ts";
import type { FsWatchEvent } from "./schemas.ts";

const WATCH_DEBOUNCE_MS = 200;

type WatchListener = (event: GitResult<FsWatchEvent>) => void;

type WatcherEntry = {
  promise: Promise<GitResult<RepoFileWatcher>>;
  watcher?: RepoFileWatcher;
};

const watchers = new Map<string, WatcherEntry>();

function normalizeRepoPath(repoPath: string): string {
  return path.resolve(repoPath);
}

function sortPaths(paths: Iterable<string>): string[] {
  return Array.from(paths).sort((a, b) => a.localeCompare(b));
}

function hasEvents(event: Extract<FsWatchEvent, { kind: "delta" }>): boolean {
  return Boolean(
    event.added?.length ||
      event.removed?.length ||
      event.moved?.length ||
      event.changed?.length,
  );
}

function diffPathSets(
  previous: Set<string>,
  next: Set<string>,
  changedPaths: Set<string>,
): Extract<FsWatchEvent, { kind: "delta" }> | null {
  const added = sortPaths([...next].filter((p) => !previous.has(p)));
  const removed = sortPaths([...previous].filter((p) => !next.has(p)));
  const changed = sortPaths(
    [...changedPaths].filter((p) => previous.has(p) && next.has(p)),
  );

  const event: Extract<FsWatchEvent, { kind: "delta" }> = { kind: "delta" };
  if (added.length > 0) event.added = added;
  if (removed.length > 0) event.removed = removed;
  if (changed.length > 0) event.changed = changed;
  return hasEvents(event) ? event : null;
}

function ignoredByDefault(repoPath: string, candidate: string): boolean {
  const rel = path.isAbsolute(candidate)
    ? path.relative(repoPath, candidate)
    : candidate;
  return rel.split(/[\\/]+/).includes(".git");
}

class RepoFileWatcher {
  private readonly listeners = new Set<WatchListener>();
  private readonly watcher: FSWatcher;
  readonly ready: Promise<void>;
  private paths: Set<string>;
  private changedPaths = new Set<string>();
  private debounce: NodeJS.Timeout | undefined;

  constructor(
    private readonly repoPath: string,
    initialPaths: string[],
    private readonly log?: Logger,
  ) {
    this.paths = new Set(initialPaths);
    this.watcher = chokidarWatch(".", {
      cwd: repoPath,
      ignoreInitial: true,
      ignored: (candidate) => ignoredByDefault(repoPath, candidate),
      ignorePermissionErrors: true,
      followSymlinks: false,
    });
    this.ready = new Promise((resolve) => {
      this.watcher.on("ready", resolve);
    });

    this.watcher.on("all", (eventName, changedPath) =>
      this.scheduleRefresh(eventName === "change" ? changedPath : undefined),
    );
    this.watcher.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log?.error({ err: error, repoPath }, "repo file watcher failed");
      this.emit(
        err({
          code: "GIT_FAILED",
          message: `File watcher failed: ${message}`,
        }),
      );
    });
  }

  snapshot(): FsWatchEvent {
    return { kind: "snapshot", paths: sortPaths(this.paths) };
  }

  replacePaths(paths: string[]): void {
    this.paths = new Set(paths);
    this.changedPaths = new Set();
  }

  subscribe(listener: WatchListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  }

  private emit(event: GitResult<FsWatchEvent>): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private scheduleRefresh(changedPath?: string): void {
    if (changedPath) this.changedPaths.add(changedPath);
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.refresh();
    }, WATCH_DEBOUNCE_MS);
  }

  private async refresh(): Promise<void> {
    const result = await listAll(this.repoPath, this.log);
    if (!result.ok) {
      this.emit(result);
      return;
    }

    const next = new Set(result.value);
    const changedPaths = this.changedPaths;
    this.changedPaths = new Set();
    const delta = diffPathSets(this.paths, next, changedPaths);
    this.paths = next;
    if (delta) this.emit(ok(delta));
  }

  private close(): void {
    const entry = watchers.get(this.repoPath);
    if (entry?.watcher === this) watchers.delete(this.repoPath);
    if (this.debounce) clearTimeout(this.debounce);
    void this.watcher.close().catch((error: unknown) => {
      this.log?.error(
        { err: error, repoPath: this.repoPath },
        "failed to close repo file watcher",
      );
    });
  }
}

async function acquireWatcher(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<RepoFileWatcher>> {
  const normalized = normalizeRepoPath(repoPath);
  const existing = watchers.get(normalized);
  if (existing) return existing.promise;

  let entry: WatcherEntry | undefined;
  const promise = (async () => {
    const initial = await listAll(normalized, log);
    if (!initial.ok) {
      if (entry && watchers.get(normalized) === entry) {
        watchers.delete(normalized);
      }
      return initial;
    }

    const watcher = new RepoFileWatcher(normalized, initial.value, log);
    if (entry) entry.watcher = watcher;
    await watcher.ready;

    const refreshed = await listAll(normalized, log);
    if (refreshed.ok) watcher.replacePaths(refreshed.value);
    return ok(watcher);
  })();
  entry = { promise };

  watchers.set(normalized, entry);
  return entry.promise;
}

/** Subscribe to git-filtered repo file-tree changes.
 *
 *  The first yielded item is always a full snapshot. Subsequent items are
 *  debounced deltas shared across all subscribers for the same repo path.
 */
export async function* watchFiles(
  repoPath: string,
  log?: Logger,
  signal?: AbortSignal,
): AsyncIterable<GitResult<FsWatchEvent>> {
  const watcher = await acquireWatcher(repoPath, log);
  if (!watcher.ok) {
    yield watcher;
    return;
  }

  const queue: GitResult<FsWatchEvent>[] = [];
  let wake: (() => void) | undefined;
  const unsubscribe = watcher.value.subscribe((event) => {
    queue.push(event);
    wake?.();
    wake = undefined;
  });

  try {
    yield ok(watcher.value.snapshot());

    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            wake = undefined;
            resolve();
          };
          wake = () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      while (queue.length > 0) {
        const event = queue.shift();
        if (event) yield event;
      }
    }
  } finally {
    wake?.();
    unsubscribe();
  }
}

export function test__activeFileTreeWatcherCount(): number {
  return watchers.size;
}

export const test__watchDebounceMs = WATCH_DEBOUNCE_MS;
