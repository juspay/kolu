/**
 * Refcounted shared git metadata watcher.
 *
 * N terminals open in the same git repo collapse to one watcher entry
 * and one debounce timer that fans out to all listeners. First subscriber
 * installs; last unsubscribe tears down and drops the registry entry, so
 * a fresh subscribe after teardown installs a new watcher cleanly.
 *
 * Mirrors the refcounted-singleton pattern in
 * `packages/integrations/anyagent/src/wal-subscription.ts` — different
 * sharing strategy (module-scope `Map` keyed by gitDir vs factory-private
 * closure) for a different lifetime: WAL subscriptions are scoped to one
 * integration instance; git metadata watchers are scoped to system-wide paths.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";

const DEBOUNCE_MS = 150;

/** External surface of one shared watcher: a `subscribe` method that adds a
 *  listener and returns its own unsubscribe. The listener Set, watcher
 *  handle, and debounce timer are all closure-private — registry lifecycle
 *  and dispatch policy can evolve independently because callers can only
 *  reach what `subscribe` exposes. */
interface SharedGitMetadataWatcher {
  subscribe(onChange: () => void): () => void;
}

interface WatchTarget {
  dir: string;
  filenames: Set<string>;
}

interface WatcherIdentity {
  gitDir: string;
  commonGitDir: string;
}

function watcherFields(identity: WatcherIdentity): Record<string, unknown> {
  return {
    gitDir: identity.gitDir,
    commonGitDir: identity.commonGitDir,
  };
}

/** Module-scope registry: one entry per resolved gitDir/commonGitDir pair. */
const sharedGitMetadataWatchers = new Map<string, SharedGitMetadataWatcher>();

function installSharedGitMetadataWatcher(
  identity: WatcherIdentity,
  targets: WatchTarget[],
  onLast: () => void,
  log?: Logger,
): SharedGitMetadataWatcher | null {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const watchers: fs.FSWatcher[] = [];
  const dispatch = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      // Snapshot before iteration so a listener that unsubscribes
      // synchronously can't skip a peer for this event.
      for (const cb of [...listeners]) {
        try {
          cb();
        } catch (e) {
          log?.error(
            {
              err: e instanceof Error ? e.message : String(e),
              ...watcherFields(identity),
            },
            "git: metadata listener threw",
          );
        }
      }
    }, DEBOUNCE_MS);
  };

  try {
    for (const target of targets) {
      watchers.push(
        fs.watch(target.dir, (_, filename) => {
          const name = filename?.toString();
          if (!name || !target.filenames.has(name)) return;
          dispatch();
        }),
      );
    }
  } catch (e) {
    for (const watcher of watchers) watcher.close();
    log?.error(
      {
        err: e instanceof Error ? e.message : String(e),
        ...watcherFields(identity),
      },
      "git: failed to watch metadata",
    );
    return null;
  }
  log?.info(watcherFields(identity), "git: metadata watcher installed");

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        // `Set.delete` returns false if `onChange` was already removed,
        // which keeps the unsubscribe idempotent: a double-call from the
        // same caller can't double-tear-down. A later subscribe under the
        // same gitDir installs a fresh singleton; this closure stays bound
        // to the old one, so it can't accidentally tear that fresh entry
        // down.
        if (!listeners.delete(onChange)) return;
        if (listeners.size === 0) {
          if (timer) clearTimeout(timer);
          for (const watcher of watchers) watcher.close();
          onLast();
          log?.info(watcherFields(identity), "git: metadata watcher retired");
        }
      };
    },
  };
}

/**
 * Watch git metadata changes that affect GitInfo (branch switches, checkout,
 * remote add/remove/set-url, etc.).
 * Returns a cleanup function. Returns a no-op for non-git directories.
 *
 * N callers watching the same git dirs share one registry entry and a single
 * debounce timer. Cost per event is O(listeners) regardless of how many
 * terminals subscribed.
 */
export function watchGitMetadata(
  cwd: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  let gitDir: string;
  let commonGitDir: string;
  try {
    const gitDirResult = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const commonGitDirResult = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    gitDir = path.resolve(cwd, gitDirResult.trim());
    commonGitDir = path.resolve(cwd, commonGitDirResult.trim());
  } catch {
    // Expected in non-git directories — watchGitMetadata is called speculatively.
    return () => {};
  }

  const key = `${gitDir}\0${commonGitDir}`;
  let entry = sharedGitMetadataWatchers.get(key);
  if (!entry) {
    const gitDirTarget = {
      dir: gitDir,
      filenames: new Set(["HEAD", "config.worktree"]),
    };
    const targets: WatchTarget[] = [gitDirTarget];
    if (commonGitDir === gitDir) {
      gitDirTarget.filenames.add("config");
    } else {
      targets.push({ dir: commonGitDir, filenames: new Set(["config"]) });
    }
    const fresh = installSharedGitMetadataWatcher(
      { gitDir, commonGitDir },
      targets,
      () => sharedGitMetadataWatchers.delete(key),
      log,
    );
    if (!fresh) return () => {};
    sharedGitMetadataWatchers.set(key, fresh);
    entry = fresh;
  }
  return entry.subscribe(onChange);
}

/** Compatibility alias for older consumers; prefer `watchGitMetadata`. */
export const watchGitHead = watchGitMetadata;

/** Test-only inspector — number of distinct gitDir/commonGitDir pairs with active shared
 *  watchers. Used by unit tests to assert the singleton invariant without
 *  spying on `fs.watch`. */
export function _sharedGitMetadataWatcherCount(): number {
  return sharedGitMetadataWatchers.size;
}

/** Compatibility alias for older tests/tools; prefer `_sharedGitMetadataWatcherCount`. */
export const _sharedHeadWatcherCount = _sharedGitMetadataWatcherCount;
