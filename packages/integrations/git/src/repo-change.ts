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
 * LIFETIME (#2286). The subscriber set is driven by a BROWSER: the Code tab
 * re-keys its repo subscription onto the focused pane, so a refcount that tore
 * down on the last unsubscribe made a focus switch across two repos a
 * four-watcher teardown-and-rebuild — 120 of each per 5 minutes at the measured
 * 2.5 s cadence, with whatever arrived in the gap simply lost. The last
 * subscriber leaving now starts a {@link WATCHER_RETIRE_GRACE_MS} timer
 * instead, and a subscription taken inside that window reuses the live
 * upstreams.
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
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import { watchGitHead } from "./head-watcher.ts";
import { watchGitIndex } from "./index-watcher.ts";
import { watchGitReflog } from "./reflog-watcher.ts";
import { watchWorkingTree } from "./working-tree-watcher.ts";

/** How long a composed entry outlives its LAST reference before the upstream
 *  watchers come down (juspay/kolu#2286). The Code tab RE-KEYS its
 *  `subscribeRepoChange` onto whichever pane has focus, so a focus switch
 *  between two repos unsubscribed one repo and subscribed the other in the same
 *  tick: measured at 120 installs + 120 retires per 5 minutes at a 2.5s focus
 *  cadence — four inotify watchers (HEAD, reflog, index, working tree) torn
 *  down and rebuilt each time, with every event landing in the rebuild gap
 *  simply lost. A grace window makes the overwhelmingly common case (returning
 *  to a repo you just left) free: the entry is still live, so the re-subscribe
 *  is a `Set.add`. 30s is far past any focus / tab-switch cadence and far short
 *  of "a repo nobody is looking at any more". */
export const WATCHER_RETIRE_GRACE_MS = 30_000;

interface SharedComposed {
  subscribe(onChange: () => void): () => void;
}

const repoChangeWatchers = new Map<string, SharedComposed>();
const fileChangeWatchers = new Map<string, SharedComposed>();

/** Build a composed watcher backed by N upstream `subscribe` functions.
 *  Each upstream callback fires `tick()`, which trailing-edge-debounces
 *  fan-out across the listener set.
 *
 *  Lifetime is REFERENCE-counted over the listener set, and the teardown runs
 *  {@link WATCHER_RETIRE_GRACE_MS} AFTER the last one drops rather than on the
 *  drop itself. A reference taken inside that window cancels the pending
 *  retirement and reuses the live upstreams, which is what makes a client's
 *  re-key cost nothing. The disposer is sealed once (`retired`): the grace
 *  window is real time during which a straggler release can still arrive, and
 *  retiring twice would unsubscribe the upstreams twice and double-log the
 *  retire line #2286's measurement greps for. */
function compose(
  upstreamInstalls: ((onChange: () => void) => () => void)[],
  onLast: () => void,
  logLabel: string,
  logFields: Record<string, unknown>,
  log?: Logger,
): SharedComposed {
  const listeners = new Set<() => void>();
  let timer: NodeJS.Timeout | undefined;
  let retireTimer: NodeJS.Timeout | undefined;
  let retired = false;

  function tick(): void {
    clearTimeout(timer);
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

  /** A reference arrived — cancel any pending retirement, because the upstreams
   *  it was about to tear down are the ones this reference is about to use. */
  function acquired(): void {
    clearTimeout(retireTimer);
    retireTimer = undefined;
  }

  /** A reference left — arm the grace timer once the LAST one is gone. */
  function released(): void {
    if (retired || retireTimer || listeners.size > 0) return;
    retireTimer = setTimeout(retire, WATCHER_RETIRE_GRACE_MS);
    // A pending retirement is pure cleanup: it must never be the thing holding a
    // daemon that is otherwise ready to exit open for the rest of the window.
    retireTimer.unref();
  }

  function retire(): void {
    retireTimer = undefined;
    if (retired || listeners.size > 0) return;
    retired = true;
    clearTimeout(timer);
    for (const u of upstreamUnsubs) u();
    onLast();
    log?.info(logFields, `${logLabel} watcher retired`);
  }

  return {
    subscribe(onChange) {
      acquired();
      listeners.add(onChange);
      return () => {
        if (!listeners.delete(onChange)) return;
        released();
      };
    },
  };
}

/** The composed repo-change entry for `repoRoot`, created on the first
 *  subscription and kept alive through {@link WATCHER_RETIRE_GRACE_MS} after the
 *  last one leaves — so the Code tab's focus-driven re-key lands on the LIVE
 *  watcher: no install, no retire, and no window in which events go missing
 *  (#2286). */
function repoChangeEntry(repoRoot: string, log?: Logger): SharedComposed {
  let entry = repoChangeWatchers.get(repoRoot);
  if (!entry) {
    entry = compose(
      [
        (cb) => watchGitHead(repoRoot, cb, log),
        (cb) => watchGitReflog(repoRoot, cb, log),
        (cb) => watchGitIndex(repoRoot, cb, log),
        (cb) => watchWorkingTree(repoRoot, cb, log),
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
): () => void {
  return repoChangeEntry(repoRoot, log).subscribe(onChange);
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
): () => void {
  const key = `${repoRoot}\x00${filePath}`;
  let entry = fileChangeWatchers.get(key);
  if (!entry) {
    entry = compose(
      [
        (cb) => watchGitHead(repoRoot, cb, log),
        (cb) => watchWorkingTree(repoRoot, cb, log, { filePath }),
      ],
      () => fileChangeWatchers.delete(key),
      "git: file-change",
      { repoRoot, filePath },
      log,
    );
    fileChangeWatchers.set(key, entry);
  }
  return entry.subscribe(onChange);
}

/** Test-only — number of LIVE (repoRoot) entries: every entry whose upstream
 *  watchers are installed, whether it is currently referenced or sitting out its
 *  {@link WATCHER_RETIRE_GRACE_MS} window. An entry leaves this count only when
 *  it actually retires, which is exactly the install/retire churn #2286 measures. */
export function _sharedRepoChangeCount(): number {
  return repoChangeWatchers.size;
}

/** Test-only — number of LIVE (repoRoot, filePath) entries, on the same
 *  "installed, grace window included" basis as {@link _sharedRepoChangeCount}. */
export function _sharedFileChangeCount(): number {
  return fileChangeWatchers.size;
}
