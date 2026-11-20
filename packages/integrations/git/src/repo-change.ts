import { distinctAskerLabels, type WatchAsker } from "kolu-io";
import type { Logger } from "kolu-shared";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import { watchGitHead } from "./head-watcher.ts";
import { watchGitIndex } from "./index-watcher.ts";
import { watchGitReflog } from "./reflog-watcher.ts";
import { watchWorkingTree } from "./working-tree-watcher.ts";

/** How long a composed entry outlives its LAST reference before the upstream
 *  watchers come down (juspay/kolu#2286). */
export const WATCHER_RETIRE_GRACE_MS = 30_000;

interface SharedComposed {
  subscribe(onChange: () => void, asker: WatchAsker): () => void;
}

interface ComposedListener {
  readonly onChange: () => void;
  readonly asker: WatchAsker;
}

type UpstreamInstall = (
  askers: () => readonly string[],
  onChange: () => void,
) => () => void;

const repoChangeWatchers = new Map<string, SharedComposed>();
const fileChangeWatchers = new Map<string, SharedComposed>();

/** A one-shot retirement: armed when the last reference leaves, cancelled when
 *  one returns. `retire` runs at most once, whatever the arm/cancel order. */
function armableRetirement(graceMs: number, retire: () => void) {
  let timer: NodeJS.Timeout | undefined;
  let retired = false;
  return {
    cancel(): void {
      clearTimeout(timer);
      timer = undefined;
    },
    arm(): void {
      if (retired || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        retired = true;
        retire();
      }, graceMs);
      timer.unref();
    },
  };
}

function compose(
  upstreamInstalls: UpstreamInstall[],
  onLast: () => void,
  logLabel: string,
  logFields: Record<string, unknown>,
  log?: Logger,
): SharedComposed {
  const listeners = new Set<ComposedListener>();
  let timer: NodeJS.Timeout | undefined;

  function tick(): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      for (const listener of [...listeners]) {
        try {
          listener.onChange();
        } catch (e) {
          log?.error(
            { err: e instanceof Error ? e.message : String(e), ...logFields },
            `${logLabel} listener threw`,
          );
        }
      }
    }, WATCHER_DEBOUNCE_MS);
  }

  const askers = (): readonly string[] =>
    listeners.size === 0
      ? [
          `${logLabel} (no subscriber; retiring within ${WATCHER_RETIRE_GRACE_MS / 1000} s)`,
        ]
      : distinctAskerLabels([...listeners].map((listener) => listener.asker));
  const upstreamUnsubs = upstreamInstalls.map((install) =>
    install(askers, tick),
  );
  log?.info(logFields, `${logLabel} watcher installed`);

  const retirement = armableRetirement(WATCHER_RETIRE_GRACE_MS, () => {
    clearTimeout(timer);
    for (const u of upstreamUnsubs) u();
    onLast();
    log?.info(logFields, `${logLabel} watcher retired`);
  });

  return {
    subscribe(onChange, asker) {
      retirement.cancel();
      const listener: ComposedListener = { onChange, asker };
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) retirement.arm();
      };
    },
  };
}

function repoChangeEntry(repoRoot: string, log?: Logger): SharedComposed {
  let entry = repoChangeWatchers.get(repoRoot);
  if (!entry) {
    entry = compose(
      [
        (askers, cb) => watchGitHead(repoRoot, askers, cb, log),
        (askers, cb) => watchGitReflog(repoRoot, askers, cb, log),
        (askers, cb) => watchGitIndex(repoRoot, askers, cb, log),
        (askers, cb) => watchWorkingTree(repoRoot, askers, cb, log),
      ],
      () => repoChangeWatchers.delete(repoRoot),
      "git: repo-change",
      { repoRoot },
      log,
    );
    repoChangeWatchers.set(repoRoot, entry);
  }
  return entry;
}

/** Subscribe to "any file or git-state change in this repo", refcounted per
 *  `repoRoot`. Composes `watchGitHead`, `watchGitReflog`, `watchGitIndex` and
 *  `watchWorkingTree`. */
export function subscribeRepoChange(
  repoRoot: string,
  asker: WatchAsker,
  onChange: () => void,
  log?: Logger,
): () => void {
  return repoChangeEntry(repoRoot, log).subscribe(onChange, asker);
}

/** Subscribe to "branch checkout, or this one file's working-tree changes",
 *  refcounted per `(repoRoot, filePath)`. Reuses `watchWorkingTree`'s shared
 *  upstream via its filePath filter. */
export function subscribeFileChange(
  repoRoot: string,
  filePath: string,
  asker: WatchAsker,
  onChange: () => void,
  log?: Logger,
): () => void {
  const key = `${repoRoot}\x00${filePath}`;
  let entry = fileChangeWatchers.get(key);
  if (!entry) {
    entry = compose(
      [
        (askers, cb) => watchGitHead(repoRoot, askers, cb, log),
        (askers, cb) =>
          watchWorkingTree(repoRoot, askers, cb, log, { filePath }),
      ],
      () => fileChangeWatchers.delete(key),
      "git: file-change",
      { repoRoot, filePath },
      log,
    );
    fileChangeWatchers.set(key, entry);
  }
  return entry.subscribe(onChange, asker);
}

export function _sharedRepoChangeCount(): number {
  return repoChangeWatchers.size;
}

export function _sharedFileChangeCount(): number {
  return fileChangeWatchers.size;
}
