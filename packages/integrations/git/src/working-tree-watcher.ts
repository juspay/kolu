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
 * The ignore set is derived from git, not a hardcoded list: `listIgnored`
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
 * One DELIBERATE exception to "shown ⇒ watched": the Code tab's "show ignored
 * files" toggle overlays gitignored entries onto the tree WITHOUT widening
 * this watch — recursively watching `node_modules` is exactly the inotify
 * storm the ignore set exists to prevent. Ignored rows therefore don't
 * live-update; the overlay refreshes when any watched change pulses or when
 * the toggle re-queries.
 *
 * Subscribers can pass a `filePath` to receive only events for that exact file
 * (the `BrowseFileView` case — one selected file, not the whole tree) or omit
 * it to receive every event (the `subscribeRepoChange` case). The filter
 * happens at the listener layer, so a single shared watcher per repo serves
 * both consumers — no separate single-file watcher.
 */

import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import {
  type AsyncSubscription,
  type BackendType,
  subscribe as parcelSubscribe,
} from "@parcel/watcher";
import type { Logger } from "kolu-shared";
import { listIgnored } from "./browse.ts";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

/** The one backend we must never hand parcel: `"watchman"` is the leaking one,
 *  and *omitting* the backend re-selects it. Narrowing the pin's type to exclude
 *  it makes the leak **unspellable** — `linux: "watchman"` or `?? "watchman"`
 *  become compile errors, so the invariant below is enforced by the type, not
 *  just trusted to the comment. */
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

/** `.git` is always ignored: git never lists its own dir, and the git-dir
 *  watchers (HEAD/reflog/index) cover the parts we care about — watching it
 *  here would just fire on every git operation. */
const ALWAYS_IGNORE_RELS = [".git"];

/** Degraded fallback when git can't enumerate ignores (not a repo, git error).
 *  Keeps `node_modules` — the one unbounded recursive subtree whose watch
 *  actually threatens the inotify budget — out of the watch, so a git hiccup
 *  can't unleash a watch storm. The healthy path derives the full set from
 *  git via `listIgnored`. */
const FALLBACK_IGNORE_RELS = ["node_modules"];

/** Absolute paths parcel must not emit events for. parcel treats a non-glob
 *  path entry as "ignore this file/dir and all its children", so absolute
 *  directory paths prune whole subtrees.
 *
 *  Exported under this file's `_` test-visibility convention (see
 *  {@link _sharedWorkingTreeWatcherCount}) so the parcel-ignore SHAPE is pinned
 *  where it is actually observable, rather than at a listing variant no
 *  consumer can tell apart. */
export async function _computeIgnore(
  repoRoot: string,
  log?: Logger,
): Promise<string[]> {
  const ignored = await listIgnored(repoRoot, log);
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
  // `path.resolve` normalizes git's trailing directory slash away, so the
  // collapsed `node_modules/` entry and a bare `node_modules` prune
  // identically. That erasure is why the watcher needs no slash-stripped
  // listing of its own — it reads the same `listIgnored` the Code tab does.
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
const retiringWorkingTreeWatchers = new Map<string, Promise<void>>();

/** A trailing debounce must still make progress under a sustained event
 * stream. This ceiling is deliberately much larger than the normal editor-save
 * window, but finite so a checkout/build burst cannot postpone the Code tab
 * forever. */
const WATCHER_MAX_WAIT_MS = 1_000;

/** Directory repair is structural and expensive (a new recursive tree walk),
 * so collect a whole mkdir burst before doing it. The ceiling covers a command
 * that creates directories continuously without rebuilding once per mkdir. */
const DIRECTORY_REPAIR_DEBOUNCE_MS = WATCHER_DEBOUNCE_MS * 2;
const DIRECTORY_REPAIR_MAX_WAIT_MS = 2_000;

function installSharedWorkingTreeWatcher(
  repoRoot: string,
  onLast: (retirement: Promise<void>) => void,
  log?: Logger,
): SharedWorkingTreeWatcher {
  const listeners = new Set<Listener>();
  const pending = new Set<Listener>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingSince: number | undefined;
  let repairTimer: ReturnType<typeof setTimeout> | undefined;
  let repairSince: number | undefined;
  let subscription: AsyncSubscription | null = null;
  let installTask: Promise<void> | null = null;
  let resubscribeRequested = false;
  let cancelled = false;

  const firePending = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pendingSince = undefined;
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
  };

  /** Fire on the normal trailing edge, but no later than one second after the
   *  first pending event. A real sustained burst therefore refreshes the Code
   *  tab periodically instead of resetting the debounce forever. */
  const scheduleFire = (): void => {
    if (timer) clearTimeout(timer);
    const now = Date.now();
    pendingSince ??= now;
    const untilCeiling = WATCHER_MAX_WAIT_MS - (now - pendingSince);
    timer = setTimeout(
      firePending,
      Math.max(0, Math.min(WATCHER_DEBOUNCE_MS, untilCeiling)),
    );
  };

  const scheduleDirectoryRepair = (): void => {
    if (cancelled) return;
    if (repairTimer) clearTimeout(repairTimer);
    const now = Date.now();
    repairSince ??= now;
    const untilCeiling = DIRECTORY_REPAIR_MAX_WAIT_MS - (now - repairSince);
    repairTimer = setTimeout(
      () => {
        repairTimer = undefined;
        repairSince = undefined;
        requestSubscribe();
      },
      Math.max(0, Math.min(DIRECTORY_REPAIR_DEBOUNCE_MS, untilCeiling)),
    );
  };

  /** Linux inotify has a structural race when a whole nested subtree is made in
   *  one burst after subscription: it can observe `mkdir src`, add a watch for
   *  `src`, but miss `mkdir src/feature`, which happened before that new watch
   *  existed. Parcel then watches the parent forever while edits below the
   *  missed descendant are silent. A non-empty created directory (or a create
   *  that moved before inspection) schedules one bounded, trailing repair for
   *  the whole mkdir burst. Replacing the root subscription rebuilds the
   *  recursive watch set from the settled tree. Parcel shares a native watch
   *  for overlapping subscriptions, so rebuilding must retire the old root
   *  first; the post-install reconciliation below re-reads authoritative state
   *  and covers every mutation in that brief replacement window. */
  function repairCreatedDirectories(
    events: ReadonlyArray<{ path: string; type: string }>,
  ): void {
    const creates = events.filter((event) => event.type === "create");
    if (creates.length === 0) return;
    void Promise.all(
      creates.map(async (event): Promise<boolean> => {
        try {
          if (!(await lstat(event.path)).isDirectory()) return false;
          // An empty directory has no missed descendant to repair. If it gains
          // children later, the newly attached directory watch observes them.
          return (await readdir(event.path)).length > 0;
        } catch (e) {
          // A create that vanished before inspection may have been renamed;
          // the settled tree is then the only authority, so repair it too.
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
          log?.error(
            {
              err: e instanceof Error ? e.message : String(e),
              path: event.path,
              repoRoot,
            },
            "git: working-tree directory-create inspection failed",
          );
          return false;
        }
      }),
    ).then((needsRepair) => {
      if (needsRepair.some(Boolean)) scheduleDirectoryRepair();
    });
  }

  function onParcelEvents(
    err: Error | null,
    events: Array<{ path: string; type: "create" | "update" | "delete" }>,
  ): void {
    if (cancelled) return;
    if (err) {
      log?.error(
        { err: err.message, repoRoot },
        "git: working-tree watcher callback error",
      );
      return;
    }

    repairCreatedDirectories(events);

    // Bucket events into the listeners they match. A single batch can hit
    // several listeners (different filePaths) or none (all-ignored paths
    // slipped through somehow).
    for (const event of events) {
      // Normalize to NFC before comparing: macOS FSEvents reports filenames in
      // the filesystem's native form (often NFD — `e` + combining acute), while
      // `matchAbs` is derived from a git/client path that's usually NFC (`é`).
      const eventPath = event.path.normalize("NFC");
      for (const listener of listeners) {
        if (listener.matchAbs === null || listener.matchAbs === eventPath) {
          pending.add(listener);
        }
      }
    }

    if (pending.size > 0) scheduleFire();
  }

  /** Install the first root subscription, or atomically replace it to repair
   *  recursive coverage. Directory events first pass through the bounded
   *  trailing repair debounce above; requests arriving during installation
   *  further coalesce to one trailing replacement. */
  function requestSubscribe(): void {
    if (cancelled) return;
    if (installTask) {
      resubscribeRequested = true;
      return;
    }
    installTask = (async () => {
      try {
        const ignore = await _computeIgnore(repoRoot, log);
        if (cancelled) return;
        // A watcher reopened immediately after its final listener left must not
        // overlap Parcel's asynchronous native teardown for the same root.
        await retiringWorkingTreeWatchers.get(repoRoot);
        if (cancelled) return;
        const replacing = subscription !== null;
        if (subscription) {
          // Parcel reuses the same native backend for two concurrent root
          // subscriptions, including its stale recursive watch set. Retire the
          // old one first so `subscribe` performs a real tree walk.
          const previous = subscription;
          subscription = null;
          await previous.unsubscribe();
        }
        if (cancelled) return;
        const next = await parcelSubscribe(repoRoot, onParcelEvents, {
          ignore,
          // Pin the OS-native watcher and skip parcel's leaking watchman probe.
          backend: PARCEL_BACKEND,
        });

        if (cancelled) {
          await next.unsubscribe().catch((e: Error) => {
            log?.error(
              { err: e.message, repoRoot },
              "git: working-tree late-unsubscribe failed",
            );
          });
          return;
        }

        subscription = next;
        // Reconcile mutations from both the initial install window and a
        // replacement's restart window. The filter is irrelevant here: every
        // listener must re-derive its state against the settled tree. Dispatch
        // this reconciliation immediately: putting it through the trailing
        // event debounce would let repeated repairs starve the same refresh.
        if (listeners.size > 0) {
          for (const listener of listeners) pending.add(listener);
          firePending();
        }
        log?.info(
          { repoRoot },
          replacing
            ? "git: working-tree watcher rebuilt"
            : "git: working-tree watcher installed",
        );
      } catch (e) {
        log?.error(
          { err: e instanceof Error ? e.message : String(e), repoRoot },
          "git: working-tree watcher install failed",
        );
      }
    })();
    void installTask.finally(() => {
      installTask = null;
      if (!cancelled && resubscribeRequested) {
        resubscribeRequested = false;
        requestSubscribe();
      }
    });
  }

  requestSubscribe();

  return {
    subscribe(matchAbs, onChange) {
      const listener: Listener = { matchAbs, onChange };
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener)) return;
        pending.delete(listener);
        if (listeners.size === 0) {
          if (timer) clearTimeout(timer);
          if (repairTimer) clearTimeout(repairTimer);
          timer = undefined;
          pendingSince = undefined;
          repairTimer = undefined;
          repairSince = undefined;
          cancelled = true;
          resubscribeRequested = false;
          const current = subscription;
          subscription = null;
          const retirement = (async () => {
            if (current) {
              await current.unsubscribe().catch((e: Error) => {
                log?.error(
                  { err: e.message, repoRoot },
                  "git: working-tree unsubscribe failed",
                );
              });
            }
            // An initial install or replacement may still be between computing
            // ignores and receiving its Parcel subscription. Its cancelled path
            // retires that late handle before this promise settles.
            await installTask;
          })();
          onLast(retirement);
          void retirement.catch((e: unknown) => {
            // Every native unsubscribe above is already caught; this is a
            // fail-loud fence for an unexpected lifecycle rejection.
            log?.error(
              { err: e instanceof Error ? e.message : String(e), repoRoot },
              "git: working-tree retirement failed",
            );
          });
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
      : // NFC so it compares equal to NFC-normalized FSEvents paths (see the
        // event callback) regardless of the input path's composition form.
        path.resolve(repoRoot, options.filePath).normalize("NFC");
  let entry = sharedWorkingTreeWatchers.get(repoRoot);
  if (!entry) {
    let installed!: SharedWorkingTreeWatcher;
    installed = installSharedWorkingTreeWatcher(
      repoRoot,
      (retirement) => {
        if (sharedWorkingTreeWatchers.get(repoRoot) === installed) {
          sharedWorkingTreeWatchers.delete(repoRoot);
        }
        retiringWorkingTreeWatchers.set(repoRoot, retirement);
        void retirement.finally(() => {
          if (retiringWorkingTreeWatchers.get(repoRoot) === retirement) {
            retiringWorkingTreeWatchers.delete(repoRoot);
          }
        });
      },
      log,
    );
    entry = installed;
    sharedWorkingTreeWatchers.set(repoRoot, installed);
  }
  return entry.subscribe(matchAbs, onChange);
}

/** Test-only inspector — number of distinct repoRoots with active shared
 *  working-tree watchers. Mirrors `_sharedHeadWatcherCount`. */
export function _sharedWorkingTreeWatcherCount(): number {
  return sharedWorkingTreeWatchers.size;
}

/** Test-only retirement barrier. The public cleanup stays synchronous for
 * Solid/onCleanup consumers; real-watcher tests await this before deleting the
 * watched temporary tree. */
export async function _waitForWorkingTreeWatcherRetirement(
  repoRoot: string,
): Promise<void> {
  await retiringWorkingTreeWatchers.get(repoRoot);
}
