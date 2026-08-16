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
 * TWO parcel hazards this file has to work around, both of which end in the
 * same silent symptom — a subscription that looks installed and delivers
 * nothing (juspay/kolu#2065):
 *   - its per-`(dir, ignore)` bookkeeping is only coherent when its calls don't
 *     overlap, so every call for a repo is serialized (`parcelCallChains`);
 *   - it watches a newly created directory but never SCANS it, so anything
 *     already inside is invisible forever, and the subscription is rebuilt to
 *     re-cover it (`scheduleRebuild`).
 *
 * Subscribers can pass a `filePath` to receive only events for that exact file
 * (the `BrowseFileView` case — one selected file, not the whole tree) or omit
 * it to receive every event (the `subscribeRepoChange` case). The filter
 * happens at the listener layer, so a single shared watcher per repo serves
 * both consumers — no separate single-file watcher.
 */

import fs from "node:fs";
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

/** Run `call` after every parcel call already queued for `repoRoot`, and
 *  resolve when it finishes. The entry clears itself once it is the settled
 *  tail, so an idle repo holds nothing. */
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

/** Queue a live parcel subscription's teardown onto its repo's chain. Fire and
 *  forget by design — callers unsubscribe synchronously — but the chain keeps
 *  the next install behind it. */
function retireWorkingTreeSubscription(
  repoRoot: string,
  sub: AsyncSubscription,
  log?: Logger,
): void {
  void sequenceParcelCall(repoRoot, () =>
    sub
      .unsubscribe()
      .catch((e: Error) => {
        log?.error(
          { err: e.message, repoRoot },
          "git: working-tree unsubscribe failed",
        );
      })
      .then(() => settleParcelBackend()),
  );
}

/** FSEvents can resolve unsubscribe before the stream is actually gone.
 *  A new subscribe on the same (dir, ignore) then installs no watches. */
function settleParcelBackend(): Promise<void> {
  if (process.platform !== "darwin") return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 50));
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

  /** True when `eventPath` is a directory that ALREADY has an entry in it.
   *
   *  Parcel hands us the create event only after it has added the new
   *  directory's watch, so anything created AFTER that point is covered. What
   *  is not covered is anything that was already inside when the watch went on
   *  — parcel's `watchDir` adds the inotify watch and never scans, so those
   *  entries are invisible to it forever. "Empty right now" is therefore a
   *  sound, conservative all-clear, and it is the common case (`mkdir foo`)
   *  that this keeps off the rebuild path entirely.
   *
   *  Reads ONE entry via `opendir`, not a full `readdir`: a directory that
   *  appeared by rename can hold an arbitrary number of children, and all we
   *  ever ask is "any?". A non-directory throws ENOTDIR, which is the same
   *  answer — nothing to re-cover. */
  const hasPreexistingEntries = (eventPath: string): boolean => {
    let dir: fs.Dir | undefined;
    try {
      dir = fs.opendirSync(eventPath);
      return dir.readSync() !== null;
    } catch {
      // Not a directory, or already gone — either way nothing was missed.
      return false;
    } finally {
      try {
        dir?.closeSync();
      } catch {
        // Already closed by the failing read above; nothing to report.
      }
    }
  };

  /** Rebuild the parcel subscription so its recursive walk re-establishes
   *  watches over a subtree parcel is blind to (see `scheduleRebuild`).
   *  Trailing-edge debounced on the same window as the event dispatch, so
   *  `mkdir -p a/b/c` — or a `git checkout` that lands a whole tree — costs
   *  ONE rebuild rather than one per directory. */
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRebuild = (): void => {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      if (cancelled) return;
      log?.info({ repoRoot }, "git: working-tree watcher re-covering new dirs");
      void attach();
    }, WATCHER_DEBOUNCE_MS);
  };

  /** Parcel's event sink. Buckets events to the listeners they match, and
   *  notices when parcel has gone blind to a freshly created subtree. */
  const onParcelEvents: Parameters<typeof parcelSubscribe>[1] = (
    err,
    events,
  ) => {
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
    let sawBlindSubtree = false;
    for (const event of events) {
      // Normalize to NFC before comparing: macOS FSEvents reports
      // filenames in the filesystem's native form (often NFD —
      // `e` + combining acute), while `matchAbs` is derived from a
      // git/client path that's usually NFC (`é`). A raw `===` would
      // silently miss every event for a unicode-named file, breaking
      // the single-file watcher's live-reload. `matchAbs` is already
      // NFC-normalized at creation, so only the event path needs it here.
      const eventPath = event.path.normalize("NFC");
      if (
        !sawBlindSubtree &&
        event.type === "create" &&
        hasPreexistingEntries(event.path)
      ) {
        sawBlindSubtree = true;
      }
      for (const listener of listeners) {
        if (listener.matchAbs === null || listener.matchAbs === eventPath) {
          pending.add(listener);
        }
      }
    }

    if (sawBlindSubtree) scheduleRebuild();
    if (pending.size === 0) return;

    // Trailing-edge debounce — a burst of events fires the listeners
    // exactly once, after the burst settles. Reset on every new batch.
    scheduleFire();
  };

  /** (Re)install parcel's subscription for this repo, replacing whatever is
   *  currently attached. The teardown and the fresh subscribe run as ONE
   *  queued call on the repo's parcel chain, so they can neither overlap each
   *  other nor a sibling entry's calls (see `parcelCallChains`).
   *
   *  Called once at construction, and again whenever `scheduleRebuild` finds
   *  parcel blind to a new subtree. The ignore set is re-derived each time, so
   *  a rebuild also picks up a `.gitignore` written since the last attach.
   *
   *  Filesystem mutations between this call and parcel's resolve are invisible
   *  to parcel — the streaming endpoint already yielded its initial snapshot
   *  before this ran, so any change landing in that window leaves the client
   *  with a stale view that no future event would correct on its own. The
   *  reconciliation tick at the end is what closes that window: consumers
   *  re-read state and converge. */
  async function attach(): Promise<void> {
    const ignore = await _computeIgnore(repoRoot, log);
    if (cancelled) return;
    await sequenceParcelCall(repoRoot, async () => {
      if (cancelled) return;
      // Retire the outgoing subscription first, in this same queued call —
      // parcel's per-key bookkeeping only stays coherent when its calls don't
      // overlap, and a rebuild is exactly the overlap that would otherwise
      // leave the replacement holding no watches at all.
      const outgoing = subscription;
      subscription = null;
      if (outgoing) {
        await outgoing.unsubscribe().catch((e: Error) => {
          log?.error(
            { err: e.message, repoRoot },
            "git: working-tree unsubscribe failed",
          );
        });
        await settleParcelBackend();
      }
      try {
        const sub = await parcelSubscribe(repoRoot, onParcelEvents, {
          // `backend` pins the OS-native watcher and skips parcel's leaking
          // per-subscribe watchman probe — see PARCEL_BACKEND above.
          ignore,
          backend: PARCEL_BACKEND,
        });

        if (cancelled) {
          // Retired while parcel was subscribing. Unsubscribe INLINE rather
          // than re-queueing: we are already this repo's queued call, so
          // awaiting here keeps the teardown ordered, while re-queueing would
          // deadlock behind ourselves. Its own catch keeps a failed teardown
          // reported as one, not miscast as an install failure below.
          await sub.unsubscribe().catch((e: Error) => {
            log?.error(
              { err: e.message, repoRoot },
              "git: working-tree late-unsubscribe failed",
            );
          });
          return;
        }
        subscription = sub;
        log?.info({ repoRoot }, "git: working-tree watcher installed");

        // Reconcile any mutations that landed in the (re)install window —
        // parcel didn't see them, but the listener's own re-read will. Add
        // every current listener to `pending` (the filter doesn't matter here;
        // reconciliation is a "re-derive your state" signal, not a
        // path-specific event) and schedule one debounced fire. After a
        // rebuild this is also what surfaces whatever the blind subtree was
        // hiding, without waiting for its next edit.
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
    });
  }

  void attach();

  return {
    subscribe(matchAbs, onChange) {
      const listener: Listener = { matchAbs, onChange };
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener)) return;
        pending.delete(listener);
        if (listeners.size === 0) {
          if (timer) clearTimeout(timer);
          if (rebuildTimer) clearTimeout(rebuildTimer);
          cancelled = true;
          if (subscription) {
            // Queue the teardown BEFORE `onLast()` drops the registry entry:
            // the very next `watchWorkingTree` for this repo builds a fresh
            // entry, and its install must find this call already on the chain
            // to queue behind (juspay/kolu#2065).
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
  return entry.subscribe(matchAbs, onChange);
}

/** Test-only inspector — number of distinct repoRoots with active shared
 *  working-tree watchers. Mirrors `_sharedHeadWatcherCount`. */
export function _sharedWorkingTreeWatcherCount(): number {
  return sharedWorkingTreeWatchers.size;
}
