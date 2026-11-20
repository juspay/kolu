import fs from "node:fs";
import path from "node:path";
import {
  type AsyncSubscription,
  type BackendType,
  subscribe as parcelSubscribe,
} from "@parcel/watcher";
import {
  distinctAskerLabels,
  type Measured,
  measured,
  unmeasured,
  type WatchAsker,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import { listIgnored } from "./browse.ts";
import { type GitError, type GitResult, ok } from "./errors.ts";
import { isInsideWorkTree, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import { watchGitIgnoreRules } from "./ignore-rules-watcher.ts";

type NonWatchmanBackend = Exclude<BackendType, "watchman">;

/** Pin parcel's watcher backend, per platform, instead of letting it
 *  auto-select — and pin a *named*, non-watchman backend on EVERY platform.
 *
 *  Auto-selection (parcel's default when `backend` is **omitted**) probes the
 *  **watchman** backend FIRST, on **every** `subscribe`, via a native
 *  `popen("watchman … get-sockname 2>/dev/null")` (parcel's
 *  `WatchmanBackend::checkAvailable`). On a host without watchman — every kolu
 *  pool box, most dev machines — that probe fails and parcel's error path never
 *  `pclose()`s the pipe, so the `/bin/sh` it forked leaks as an **unreaped
 *  zombie, one per subscribe**. libuv can't reap a native-`popen` child, so in a
 *  long-lived daemon (a remote-bound padi serving a whole e2e run) the zombies
 *  pile up unbounded — invisible to CPU/RAM, but they drag the event loop enough
 *  that Code-tab renders time out in the back half of a run. Surfaced by W3.4's
 *  remote-e2e lane; parcel@2.5.6 (#1691).
 *
 *  Naming a backend skips the probe. On kolu's targets the pin lands on the
 *  exact backend the default would have picked *after* the probe failed
 *  (`inotify` / `fs-events` / `windows`), so nothing changes but the removed
 *  leak. An untargeted platform (not linux/darwin/win32) hits the `throw`
 *  rather than a poller: kolu runs on exactly those three, and the repo's
 *  fail-fast philosophy forbids a silent graceful-degradation fallback — so we
 *  crash loudly instead. That throw also guarantees an omitted/`undefined`
 *  backend can never reach parcel to re-arm the probe. */
const PARCEL_BACKEND_BY_PLATFORM: Partial<
  Record<NodeJS.Platform, NonWatchmanBackend>
> = {
  darwin: "fs-events",
  linux: "inotify",
  win32: "windows",
};
const platformBackend = PARCEL_BACKEND_BY_PLATFORM[process.platform];
if (platformBackend === undefined) {
  throw new Error(
    `working-tree watcher: unsupported platform "${process.platform}" — kolu ` +
      "targets linux/darwin/win32; refusing to omit parcel's backend (that " +
      "re-selects the leaking watchman probe, #1691)",
  );
}
const PARCEL_BACKEND: NonWatchmanBackend = platformBackend;

const ALWAYS_IGNORE_RELS = [".git"];

/** Absolute paths parcel must not emit events for, or git's failure to list
 *  the repo's ignored paths. parcel treats a non-glob path entry as "ignore
 *  this file/dir and all its children", so absolute directory paths prune
 *  whole subtrees. */
export async function _computeIgnore(
  repoRoot: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  const ignored = await listIgnored(repoRoot, log);
  return ignored.ok ? ok(ignorePaths(repoRoot, ignored.value)) : ignored;
}

function ignorePaths(repoRoot: string, rels: readonly string[]): string[] {
  return [...ALWAYS_IGNORE_RELS, ...rels].map((rel) =>
    path.resolve(repoRoot, rel),
  );
}

type IgnoreComparison = "changed" | "unchanged" | "no-evidence";

/** `git ls-files` output order is stable, so an unchanged rule set yields an
 *  element-wise identical list. */
function ignoreSetChanged(
  previous: GitResult<string[]>,
  fresh: GitResult<string[]>,
): IgnoreComparison {
  if (!fresh.ok) return "no-evidence";
  if (!previous.ok) return "changed";
  const before = previous.value;
  return fresh.value.length === before.length &&
    fresh.value.every((p, i) => p === before[i])
    ? "unchanged"
    : "changed";
}

/** True when `eventPath` is a directory that ALREADY has an entry in it:
 *  parcel's `watchDir` adds the watch and never scans it, so whatever was
 *  inside when the watch went on stays invisible to parcel forever. */
function hasPreexistingEntries(eventPath: string, log?: Logger): boolean {
  let dir: fs.Dir;
  try {
    dir = fs.opendirSync(eventPath);
  } catch {
    return false;
  }
  try {
    return dir.readSync() !== null;
  } catch {
    return false;
  } finally {
    try {
      dir.closeSync();
    } catch (e) {
      log?.debug(
        { err: e instanceof Error ? e.message : String(e), eventPath },
        "git: working-tree subtree probe close failed",
      );
    }
  }
}

interface Listener {
  matchAbs: string | null;
  onChange: () => void;
  asker: WatchAsker;
}

/** Where an entry stands. `no-working-tree` is a root git says has none (a
 *  bare repo's folder): nothing is installed for it, by design. */
export type WorkingTreeWatcherState =
  | { readonly kind: "installing" }
  | { readonly kind: "watching" }
  | { readonly kind: "no-working-tree" }
  | { readonly kind: "failed"; readonly message: string };

/** One live working-tree entry, as a diagnostic row. */
export interface WorkingTreeWatcherRow {
  /** The watcher's label, the way the dir+filename watchers carry theirs. */
  readonly kind: "git: working-tree";
  readonly repoRoot: string;
  /** Directories covered. Parcel reports none for a recursive subscription,
   *  and counting would walk the tree again, so it is always unmeasured. */
  readonly directories: Measured<number>;
  readonly askers: readonly string[];
  readonly state: WorkingTreeWatcherState;
  /** Paths handed to parcel as ignored, from the latest successful listing. */
  readonly ignoredPaths: Measured<number>;
  readonly rebuilds: number;
  readonly lastRebuildReason: string | null;
  /** The last completed attach: parcel's unsubscribe plus subscribe. */
  readonly lastInstallMs: Measured<number>;
}

interface SharedWorkingTreeWatcher {
  subscribe(
    matchAbs: string | null,
    onChange: () => void,
    asker: WatchAsker,
  ): () => void;
  row(): WorkingTreeWatcherRow;
}

interface EntryDiagnostics {
  state: WorkingTreeWatcherState;
  ignoredCount?: number;
  rebuilds: number;
  lastRebuildReason: string | null;
  lastInstallMs?: number;
}

const sharedWorkingTreeWatchers = new Map<string, SharedWorkingTreeWatcher>();

/** Per-repoRoot serialization chain for EVERY parcel call — subscribe and
 *  unsubscribe alike. A repo's parcel calls run one at a time, in the order
 *  they were issued (juspay/kolu#2065).
 *
 *  Parcel keys BOTH its process-global `Watcher` registry and its backend
 *  subscription set on `(dir, ignorePaths, ignoreGlobs)`, and does each call's
 *  backend half on a libuv threadpool thread. Two overlapping calls for the
 *  same key therefore complete in arbitrary order, and one of those orders is
 *  silently lossy: the rebuild's `subscribe` finds the retiring watcher still
 *  registered (equal by key) and installs NO OS watches, then the retirement
 *  tears the existing ones down. The rebuilt subscription resolves, holds
 *  callbacks, and receives nothing — forever. That is a Code tab frozen on
 *  whatever `git status` said when its stream opened.
 *
 *  On an idle process the teardown wins that race on its own, which is why this
 *  only ever bit under a loaded suite: when every pool thread is busy, both
 *  calls queue and then start together. Serializing is a fix rather than a
 *  mitigation — parcel's per-key bookkeeping is only coherent when its calls
 *  don't overlap, so issuing overlapping ones is the defect.
 *
 *  A CHAIN, not a retirement barrier, deliberately: an install can be cancelled
 *  while its own `subscribe` is still in flight, and a "wait for pending
 *  teardowns" barrier would not yet know about the unsubscribe that install is
 *  about to need. Routing every call through one queue makes an overlap
 *  unexpressible rather than merely unlikely.
 *
 *  Failures are absorbed into the chain (each site logs its own): one bad call
 *  must not wedge every future watcher for the repo. */
const parcelCallChains = new Map<string, Promise<void>>();

function sequenceParcelCall(
  repoRoot: string,
  call: () => Promise<void>,
): Promise<void> {
  const prior = parcelCallChains.get(repoRoot) ?? Promise.resolve();
  const queued: Promise<void> = prior.then(call).finally(() => {
    if (parcelCallChains.get(repoRoot) === queued) {
      parcelCallChains.delete(repoRoot);
    }
  });
  parcelCallChains.set(repoRoot, queued);
  return queued;
}

function retireWorkingTreeSubscription(
  repoRoot: string,
  sub: AsyncSubscription,
  log?: Logger,
): void {
  void sequenceParcelCall(repoRoot, () =>
    sub.unsubscribe().catch((e: Error) => {
      log?.error(
        { err: e.message, repoRoot },
        "git: working-tree unsubscribe failed",
      );
    }),
  );
}

function installSharedWorkingTreeWatcher(
  repoRoot: string,
  onLast: () => void,
  log?: Logger,
): SharedWorkingTreeWatcher {
  const listeners = new Set<Listener>();
  const pending = new Set<Listener>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: AsyncSubscription | null = null;
  const retirement = new AbortController();
  let derivedIgnore: Promise<GitResult<string[]>>;
  let stopIgnoreRules: (() => void) | undefined;
  const diagnostics: EntryDiagnostics = {
    state: { kind: "installing" },
    rebuilds: 0,
    lastRebuildReason: null,
  };
  const askers = (): readonly string[] =>
    distinctAskerLabels([...listeners].map((listener) => listener.asker));

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

  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRebuild = (reason: string): void => {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      if (retirement.signal.aborted) return;
      log?.info({ repoRoot, reason }, "git: working-tree watcher rebuilding");
      diagnostics.rebuilds++;
      diagnostics.lastRebuildReason = reason;
      startAttach();
    }, WATCHER_DEBOUNCE_MS);
  };

  async function refreshIgnore(): Promise<void> {
    const fresh = await _computeIgnore(repoRoot, log);
    const previous = await derivedIgnore;
    if (ignoreSetChanged(previous, fresh) === "changed") {
      scheduleRebuild("ignore rules changed");
    }
  }

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleIgnoreRefresh = (): void => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (retirement.signal.aborted) return;
      void refreshIgnore();
    }, WATCHER_DEBOUNCE_MS);
  };

  const onParcelEvents: Parameters<typeof parcelSubscribe>[1] = (
    err,
    events,
  ) => {
    if (retirement.signal.aborted) return;
    if (err) {
      log?.error(
        { err: err.message, repoRoot },
        "git: working-tree watcher callback error",
      );
      return;
    }

    let sawBlindSubtree = false;
    let sawIgnoreRuleEdit = false;
    for (const event of events) {
      // macOS FSEvents reports filenames in the filesystem's native form
      // (often NFD — `e` + combining acute), so a raw `===` against an
      // NFC-normalized `matchAbs` would miss every unicode-named file.
      const eventPath = event.path.normalize("NFC");
      if (path.basename(eventPath) === ".gitignore") sawIgnoreRuleEdit = true;
      if (
        !sawBlindSubtree &&
        event.type === "create" &&
        hasPreexistingEntries(event.path, log)
      ) {
        sawBlindSubtree = true;
      }
      for (const listener of listeners) {
        if (listener.matchAbs === null || listener.matchAbs === eventPath) {
          pending.add(listener);
        }
      }
    }

    if (sawBlindSubtree) scheduleRebuild("new subtree parcel cannot see");
    if (sawIgnoreRuleEdit) scheduleIgnoreRefresh();
    if (pending.size === 0) return;

    scheduleFire();
  };

  const retireOutgoingSubscription = async (): Promise<void> => {
    const outgoing = subscription;
    subscription = null;
    diagnostics.state = { kind: "installing" };
    if (!outgoing) return;
    await outgoing.unsubscribe().catch((e: Error) => {
      log?.error(
        { err: e.message, repoRoot },
        "git: working-tree unsubscribe failed",
      );
    });
  };

  const discardLateSubscription = async (
    sub: AsyncSubscription,
  ): Promise<void> => {
    await sub.unsubscribe().catch((e: Error) => {
      log?.error(
        { err: e.message, repoRoot },
        "git: working-tree late-unsubscribe failed",
      );
    });
  };

  const reconcileAfterInstall = (): void => {
    if (listeners.size === 0) return;
    for (const listener of listeners) pending.add(listener);
    scheduleFire();
  };

  async function attach(
    ignoreSet: Promise<GitResult<string[]>>,
  ): Promise<void> {
    const derived = await ignoreSet;
    if (retirement.signal.aborted) return;
    if (!derived.ok) {
      installFailed(derived.error);
      return;
    }
    const ignore = derived.value;
    diagnostics.ignoredCount = ignore.length;
    await sequenceParcelCall(repoRoot, async () => {
      if (retirement.signal.aborted) return;
      const attachStartedAt = performance.now();
      await retireOutgoingSubscription();
      try {
        const sub = await parcelSubscribe(repoRoot, onParcelEvents, {
          ignore,
          backend: PARCEL_BACKEND,
        });
        if (retirement.signal.aborted) {
          await discardLateSubscription(sub);
          return;
        }
        subscription = sub;
        diagnostics.lastInstallMs = performance.now() - attachStartedAt;
        diagnostics.state = { kind: "watching" };
        log?.info({ repoRoot }, "git: working-tree watcher installed");
        reconcileAfterInstall();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        diagnostics.state = { kind: "failed", message };
        log?.error(
          { err: message, repoRoot },
          "git: working-tree watcher install failed",
        );
      }
    });
  }

  function startAttach(): void {
    derivedIgnore = _computeIgnore(repoRoot, log);
    void attach(derivedIgnore);
  }

  function installFailed(error: GitError): void {
    const message = "message" in error ? error.message : error.code;
    if (subscription === null) diagnostics.state = { kind: "failed", message };
    log?.error(
      { err: message, repoRoot },
      "git: working-tree watcher install failed",
    );
  }

  async function install(): Promise<void> {
    const probe = await isInsideWorkTree(repoRoot);
    if (retirement.signal.aborted) return;
    if (!probe.ok) {
      installFailed(probe.error);
      return;
    }
    if (!probe.value) {
      diagnostics.state = { kind: "no-working-tree" };
      log?.info(
        { repoRoot },
        "git: working-tree watcher not installed, no working tree",
      );
      return;
    }
    startAttach();
    stopIgnoreRules = watchGitIgnoreRules(
      repoRoot,
      askers,
      scheduleIgnoreRefresh,
      log,
    );
  }

  void install();

  const notMeasuredBecause = (): string =>
    diagnostics.state.kind === "no-working-tree"
      ? "no working tree, so nothing is installed"
      : diagnostics.state.kind === "failed"
        ? `install failed: ${diagnostics.state.message}`
        : "first install still in progress";

  return {
    row: () => ({
      kind: "git: working-tree",
      repoRoot,
      directories: unmeasured(
        "a recursive @parcel/watcher subscription reports no directory count; counting would walk the tree again (see the kernel's count)",
      ),
      askers: askers(),
      state: diagnostics.state,
      ignoredPaths:
        diagnostics.ignoredCount === undefined
          ? unmeasured(notMeasuredBecause())
          : measured(diagnostics.ignoredCount),
      rebuilds: diagnostics.rebuilds,
      lastRebuildReason: diagnostics.lastRebuildReason,
      lastInstallMs:
        diagnostics.state.kind !== "failed" &&
        diagnostics.lastInstallMs !== undefined
          ? measured(diagnostics.lastInstallMs)
          : unmeasured(notMeasuredBecause()),
    }),
    subscribe(matchAbs, onChange, asker) {
      const listener: Listener = { matchAbs, onChange, asker };
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener)) return;
        pending.delete(listener);
        if (listeners.size === 0) {
          if (timer) clearTimeout(timer);
          if (rebuildTimer) clearTimeout(rebuildTimer);
          clearTimeout(refreshTimer);
          retirement.abort();
          stopIgnoreRules?.();
          if (subscription) {
            retireWorkingTreeSubscription(repoRoot, subscription, log);
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
  asker: WatchAsker,
  onChange: () => void,
  log?: Logger,
  options?: WatchWorkingTreeOptions,
): () => void {
  const matchAbs =
    options?.filePath === undefined
      ? null
      : // NFC so it compares equal to NFC-normalized FSEvents paths (see the
        // event callback) regardless of the input path's composition form.
        path.resolve(repoRoot, options.filePath).normalize("NFC");
  let entry = sharedWorkingTreeWatchers.get(repoRoot);
  if (!entry) {
    entry = installSharedWorkingTreeWatcher(
      repoRoot,
      () => sharedWorkingTreeWatchers.delete(repoRoot),
      log,
    );
    sharedWorkingTreeWatchers.set(repoRoot, entry);
  }
  return entry.subscribe(matchAbs, onChange, asker);
}

export function _sharedWorkingTreeWatcherCount(): number {
  return sharedWorkingTreeWatchers.size;
}

/** One row per live working-tree entry in this process. */
export function listWorkingTreeWatcherRows(): WorkingTreeWatcherRow[] {
  return [...sharedWorkingTreeWatchers.values()].map((entry) => entry.row());
}
