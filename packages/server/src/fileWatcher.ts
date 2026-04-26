/** Refcounted, debounced chokidar singleton per `repoPath`.
 *
 *  One chokidar instance per repo, shared across all subscribers — see the
 *  `code-police-rules.md → integration-perf-hygiene` "Directory watchers
 *  must be shared" rule. The first subscribe spawns the watcher and seeds
 *  it with a `git ls-files` snapshot; subsequent subscribers reuse the
 *  same instance and pick up the cached snapshot synchronously. The last
 *  unsubscribe tears the watcher down so an idle server doesn't hold open
 *  fd's against directories nobody is looking at.
 *
 *  Snapshot truth comes from `git ls-files --cached --others
 *  --exclude-standard` (same source as `kolu-git`'s `listAll`), which
 *  honors `.gitignore` natively. Each chokidar event triggers a debounced
 *  re-list and we emit the diff against the previous snapshot — so
 *  ignored-but-not-`.git`/`node_modules` paths (e.g. `dist/`) cost one
 *  cheap `git ls-files` per debounce window and produce no client-visible
 *  delta. The watcher exclusions for `.git`/`node_modules` are a coarse
 *  optimization to avoid waking the handler on hot dirs that produce a
 *  lot of churn but never affect the tracked tree.
 *
 *  Renames are not detected as such: `git ls-files` doesn't surface them
 *  as a single op, so we emit them as paired `removed`/`added`. Pierre's
 *  `tree.batch()` handles the pair correctly — the rename UX (preserved
 *  selection across the rename) is a follow-up that would require git's
 *  `--find-renames` plumbing on top of this watcher. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type FSWatcher, watch } from "chokidar";
import { log } from "./log.ts";

const execFileAsync = promisify(execFile);

/** Trailing-edge debounce window for chokidar bursts. Mirrors
 *  `TRANSCRIPT_DEBOUNCE_MS` in `session-watcher.ts`. */
const DEBOUNCE_MS = 150;

/** Coarse exclusions that catch the two dirs known to produce huge churn
 *  with no effect on the tracked tree. Anything else gitignored fires
 *  chokidar but is filtered out by the next `git ls-files` call. */
const IGNORED = [/(^|[\\/])\.git(\/|$)/, /(^|[\\/])node_modules(\/|$)/];

/** Event delivered to subscribers. Mirrors `FsWatchEventSchema`. */
type FsWatchEvent =
  | { kind: "snapshot"; paths: string[] }
  | { kind: "delta"; added: string[]; removed: string[] };

type Subscriber = (event: FsWatchEvent) => void;

interface WatcherEntry {
  watcher: FSWatcher;
  /** Truth: current set of repo-relative tracked-or-untracked paths. */
  paths: Set<string>;
  subscribers: Set<Subscriber>;
  debounceTimer: NodeJS.Timeout | null;
  /** Coalesce overlapping re-list runs: a chokidar event arriving while a
   *  previous re-list is in flight just sets this flag, and the in-flight
   *  re-list re-runs once when it completes. Without this we'd fan out
   *  one `git ls-files` subprocess per event during bursts. */
  inFlight: boolean;
  rerunPending: boolean;
}

const watchers = new Map<string, WatcherEntry>();
/** Promise cache so concurrent `subscribe` calls for the same `repoPath`
 *  don't both kick off `chokidar.watch` + `git ls-files`. */
const pending = new Map<string, Promise<WatcherEntry>>();

async function listAllPaths(repoPath: string): Promise<Set<string>> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: repoPath, maxBuffer: 64 * 1024 * 1024 },
  );
  return new Set(stdout.split("\n").filter((l) => l.length > 0));
}

function diffSets(
  prev: Set<string>,
  next: Set<string>,
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const p of next) if (!prev.has(p)) added.push(p);
  for (const p of prev) if (!next.has(p)) removed.push(p);
  return { added, removed };
}

async function rerun(repoPath: string, entry: WatcherEntry): Promise<void> {
  if (entry.inFlight) {
    entry.rerunPending = true;
    return;
  }
  entry.inFlight = true;
  try {
    const next = await listAllPaths(repoPath);
    const { added, removed } = diffSets(entry.paths, next);
    entry.paths = next;
    if (added.length > 0 || removed.length > 0) {
      const event: FsWatchEvent = { kind: "delta", added, removed };
      for (const sub of entry.subscribers) sub(event);
    }
  } catch (err) {
    log.error({ err, repoPath }, "fs watcher re-list failed");
  } finally {
    entry.inFlight = false;
    if (entry.rerunPending) {
      entry.rerunPending = false;
      // Schedule, don't await: we're in the in-flight cleanup tail.
      void rerun(repoPath, entry);
    }
  }
}

function scheduleRerun(repoPath: string, entry: WatcherEntry): void {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    void rerun(repoPath, entry);
  }, DEBOUNCE_MS);
}

async function createEntry(repoPath: string): Promise<WatcherEntry> {
  const paths = await listAllPaths(repoPath);
  const watcher = watch(repoPath, {
    ignored: IGNORED,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: false,
  });
  const entry: WatcherEntry = {
    watcher,
    paths,
    subscribers: new Set(),
    debounceTimer: null,
    inFlight: false,
    rerunPending: false,
  };
  watcher.on("all", () => scheduleRerun(repoPath, entry));
  watcher.on("error", (err) =>
    log.error({ err, repoPath }, "fs watcher chokidar error"),
  );
  log.debug({ repoPath, count: paths.size }, "fs watcher started");
  return entry;
}

async function ensureEntry(repoPath: string): Promise<WatcherEntry> {
  const existing = watchers.get(repoPath);
  if (existing) return existing;
  let promise = pending.get(repoPath);
  if (!promise) {
    promise = createEntry(repoPath).then((entry) => {
      watchers.set(repoPath, entry);
      pending.delete(repoPath);
      return entry;
    });
    pending.set(repoPath, promise);
    // Cleanup-only catch — the same rejection is delivered to the
    // awaiter via the returned promise (which surfaces via oRPC →
    // `onError` → toast). Logging here would double-log on every
    // failure.
    promise.catch(() => pending.delete(repoPath));
  }
  return promise;
}

function teardown(repoPath: string, entry: WatcherEntry): void {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  watchers.delete(repoPath);
  void entry.watcher
    .close()
    .catch((err: unknown) =>
      log.error({ err, repoPath }, "fs watcher close failed"),
    );
  log.debug({ repoPath }, "fs watcher stopped");
}

/** Subscribe to a repo's file-tree events. Yields one `snapshot` immediately,
 *  then `delta`s as files are added/removed. Renames surface as `removed`+
 *  `added` pairs.
 *
 *  Sharing semantics: every subscriber for the same `repoPath` rides one
 *  chokidar instance and one rolling `git ls-files` snapshot. The last
 *  subscriber to leave (signal abort) tears the watcher down. */
export async function* subscribeFileTree(
  repoPath: string,
  signal: AbortSignal | undefined,
): AsyncIterable<FsWatchEvent> {
  const entry = await ensureEntry(repoPath);

  // Per-subscriber inbox. `wakeup` resolves the pending await whenever a
  // new event lands or the signal aborts; the loop drains the queue
  // before re-arming the wait.
  const queue: FsWatchEvent[] = [];
  let wakeup: (() => void) | null = null;
  const handler: Subscriber = (event) => {
    queue.push(event);
    const w = wakeup;
    wakeup = null;
    w?.();
  };

  // Add handler before snapshotting so any delta in the same tick is
  // queued and replayed after the snapshot — single-threaded JS makes
  // this race-free as long as there's no await between these two lines.
  entry.subscribers.add(handler);
  const snapshot: FsWatchEvent = {
    kind: "snapshot",
    paths: [...entry.paths].sort(),
  };

  const onAbort = () => {
    const w = wakeup;
    wakeup = null;
    w?.();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    yield snapshot;
    while (!signal?.aborted) {
      while (queue.length > 0) {
        if (signal?.aborted) return;
        const next = queue.shift();
        if (next) yield next;
      }
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        wakeup = resolve;
      });
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    entry.subscribers.delete(handler);
    if (entry.subscribers.size === 0) teardown(repoPath, entry);
  }
}
