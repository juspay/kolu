---
name: parcel
description: >-
  Kolu's project-wide default for filesystem monitoring is `@parcel/watcher`.
  Reach for this skill when adding or modifying any code that watches files
  or directories — recursive subtree watching, single-file observation,
  fs.watch alternatives, chokidar replacement, inotify/FSEvents/watchman
  backend selection, ignore globs, watcher debouncing, or refcounted shared
  subscriptions. Covers backend dispatch, the watchman invocation path,
  ignore handling, post-install reconciliation, and the failure modes Kolu's
  logger surfaces.
---

# `@parcel/watcher` integration

`@parcel/watcher` is Kolu's default filesystem watcher. Reach for it instead
of `chokidar`, raw `fs.watch`, or hand-rolled polling whenever a feature
needs to observe a directory subtree. Today's only consumer is the
working-tree watcher (`packages/integrations/git/src/working-tree-watcher.ts`)
— the git-dir watchers (`head-watcher`, `reflog-watcher`, `index-watcher`)
use plain `fs.watch` via `kolu-io`'s `refcounted-dir-watcher.ts` because they
target a single known file inside `.git/`, where parcel-watcher's recursive
model would be overkill. New fs-monitoring code should default to parcel-watcher
unless it has a similarly narrow target.

## Backend dispatch

Source: `node_modules/.pnpm/@parcel+watcher@2.5.6/node_modules/@parcel/watcher/src/Backend.cc:30-69`.

**Kolu pins the OS-native backend explicitly** (`inotify` / `fs-events` /
`windows`, chosen off `process.platform` — see `PARCEL_BACKEND` in
`working-tree-watcher.ts`). It does **not** use `backend: "default"`. The pin
skips the auto-dispatch order below — most importantly the `WatchmanBackend`
probe, whose per-subscribe `popen` leaks a zombie on watchman-less hosts (see
next section). If you write a new parcel consumer, pin the backend the same way.

`backend: "default"` would select in this order, first match wins:

1. `FSEvents` on macOS — native recursive, one stream per repo.
2. `WatchmanBackend` if `WatchmanBackend::checkAvailable()` returns true.
3. `WindowsBackend` on Windows — native recursive `ReadDirectoryChangesW`.
4. `InotifyBackend` on Linux — one inotify slot per non-ignored directory.
5. `KqueueBackend` on BSD.
6. `BruteForceBackend` — periodic full-tree stat; the fallback fallback.

So under `"default"` on Linux, watchman is *probed* (and preferred if reachable)
before inotify; on macOS watchman is never used (FSEvents wins). The explicit
pin lands directly on step 1/3/4 for the platform and never runs step 2's probe.

## How parcel invokes watchman

Source: `src/watchman/WatchmanBackend.cc`.

1. `checkAvailable()` (line 107) just calls `watchmanConnect()`.
2. `getSockPath()` (line 43) does the **only** `watchman` binary invocation:
   ```
   popen("watchman --output-encoding=bser get-sockname 2>/dev/null", "r")
   ```
   then parses BSER output for the `sockname` field. If `WATCHMAN_SOCK` env
   var is set, that wins and the binary isn't run at all.

   > **⚠ Zombie leak — why Kolu pins the backend (juspay/kolu#1691).** On a
   > host without watchman, this `popen` forks `/bin/sh`, the `watchman` exec
   > fails, and parcel's error path returns **without `pclose()`** — so the
   > `sh` is never `wait()`ed. `popen` bypasses `child_process`, so Node's
   > libuv can't reap it either: it lingers as a zombie **forever, one per
   > `subscribe`**. Free on CPU/RAM but a long-lived daemon (a remote-bound
   > padi serving a full e2e run) accumulates dozens and the event loop drags.
   > Pinning the native backend (above) skips `checkAvailable()` entirely, so
   > the `popen` never runs. Verified: per-subscribe leak → 0.
3. From there it's a Unix-domain socket carrying BSER-encoded JSON. No more
   subprocess spawns.

**Commands** (BSER arrays sent over the socket):

| Source | Command | Purpose |
|---|---|---|
| `watchmanWatch` (line 100) | `["watch", "/abs/dir"]` | start tracking |
| `clock` (line 230) | `["clock", "/abs/dir"]` | get baseline clock token |
| `subscribe` (line 281) | `["subscribe", "/abs/dir", "parcel-<ptr>", {fields,since,expression}]` | start receiving events |
| `unsubscribe` (line 330) | `["unsubscribe", "/abs/dir", id]` | tear down |

Subscription IDs are `"parcel-" + hex(watcher-pointer)`. Event mapping in
`handleFiles` (line 137):

- `new && exists` → create
- `exists && !S_ISDIR(mode)` → update
- `!new && !exists` → remove

**Ignore globs** are translated to a watchman expression
`["not", ["anyof", ["dirname", rel], ...]]` only for ignores that are direct
subpaths of the watched root (line 300). Glob-style ignores like
`**/node_modules` are filtered client-side after events arrive — pass them in
the `ignore` option but don't expect watchman-side filtering.

## Cookie files (`.watchman-cookie-*`)

Written by the **watchman daemon**, not parcel-watcher. The daemon drops these
files inside watched dirs to verify it can observe its own writes
(`watch`/`query` commands trigger the dance). Normally ephemeral. Stragglers
mean the daemon was killed mid-handshake. Add `.watchman-cookie-*` to
`.gitignore` if watchman is in use.

## Kolu's runtime status

As of #788, Kolu does **not** ship watchman with the production binary. The
`nix run` wrapper (`default.nix:156`) only adds `nodejs git gh` to PATH — so
even under `backend: "default"` the watchman probe would always fail and parcel
would fall through to inotify on Linux / FSEvents on macOS. Since #1692, Kolu
doesn't rely on that fall-through: it **pins** the native backend, so
`checkAvailable()` (and its leaking `popen`) never runs at all. Issue #788
tracks the watchman integration work; if it lands, the pin is where you'd
re-enable watchman deliberately (with a `WATCHMAN_SOCK` that avoids the probe).

## Kolu's wrapper invariants

`packages/integrations/git/src/working-tree-watcher.ts`:

- **Refcounted shared singleton per `repoRoot`** — N callers → one parcel
  subscription, listener-side filtering by optional `filePath`.
- **Trailing-edge debounce** at `WATCHER_DEBOUNCE_MS` (150ms) coalesces bursts
  into one fire per listener.
- **Hard-coded `IGNORE_GLOBS`** — `.git`, `node_modules`, `dist`, `build`,
  `target`, `.next`, `.turbo`, `.cache`, `.parcel-cache`, `.kolu-dev`,
  `.kolu-state`, `.DS_Store`. Not gitignore-aware. Over-firing on user build
  outputs is absorbed by the snapshot-equality check in
  `streamSnapshots(...)` upstream.
- **Post-install reconciliation tick** (line 176) — `parcelSubscribe` is
  async. Filesystem mutations between `subscribe()` call and parcel resolving
  are invisible to parcel; the streaming endpoint already yielded its initial
  snapshot. The reconciliation fires every current listener once parcel is
  ready, so consumers re-read state and catch the missed window. Without this
  the client sees a stale view that no future event corrects.
- **`cancelled` guard** on the `.then` — if the last subscriber unsubscribed
  before parcel resolved, late-unsubscribe the AsyncSubscription instead of
  storing it.
- **Per-`repoRoot` call chain** (`parcelCallChains`) — every `subscribe` and
  `unsubscribe` for a repo runs one at a time, in issue order. **Never let two
  parcel calls for the same directory overlap**; see the hazard below.

## What Kolu logs

Watcher lifecycle through `Logger` (kolu-shared). Grep these strings to verify
the watcher came up in production:

- `info  git: working-tree watcher installed` ← parcel resolved successfully
- `info  git: working-tree watcher retired` ← last subscriber gone
- `error git: working-tree watcher install failed` ← parcel `subscribe()` rejected
- `error git: working-tree watcher callback error` ← parcel reported event-stream error
- `error git: working-tree late-unsubscribe failed`
- `error git: working-tree unsubscribe failed`
- `error git: working-tree listener threw`

Individual filesystem events are **not logged** — too noisy. The bucket-and-
debounce path swallows event paths silently.

## Failure modes worth knowing

1. **Container/WSL2 bind mounts** — inotify/FSEvents may be unavailable.
   Nuance since the backend pin (#1692): `BruteForceBackend` (~1s polling) is
   parcel's *compile-time-last-resort* backend — under `"default"` it's reached
   only when no earlier backend is **compiled in**, not when a compiled one
   fails to construct at runtime. On Kolu's Linux build `INOTIFY` is compiled,
   so `"default"` selects `InotifyBackend` (after the failed watchman probe),
   and a bind mount that can't inotify makes *both* `"default"` and the pinned
   `"inotify"` fail identically (`error git: working-tree watcher install
   failed`) — the pin forgoes **no** polling path there. On the three targets
   the pin is behaviorally identical to `"default"`'s post-probe outcome, minus
   the leak. On an **untargeted** platform (not linux/darwin/win32) the pin
   throws at module init (`unsupported platform …`) rather than degrade to a
   silent poller — kolu targets exactly those three, and the repo's fail-fast
   philosophy forbids a graceful-degradation fallback. (If a BSD/other target
   ever became real, map it to its native backend — `kqueue` etc. — not to a
   poller.) Net: leak-free everywhere, and no platform silently degrades.
2. **Linux inotify slot exhaustion** — kernel default is
   `fs.inotify.max_user_watches=8192`. A typical Kolu repo uses ~500–2000
   slots; multiple worktrees compound. Watchman amortizes this across one
   daemon (#788).
3. **`detect-libc` glibc/musl picker** runs on `require('@parcel/watcher')`
   (`index.js:5`). The Nix build needs the matching native binary in
   `node_modules` — confirm `@parcel/watcher-linux-x64-glibc` is present
   under `node_modules/.pnpm/`.
4. **Overlapping `subscribe`/`unsubscribe` for the same key silently kills the
   watcher** (juspay/kolu#2065) — the worst failure mode here, because nothing
   reports it. Parcel keys its process-global `Watcher` registry
   (`Watcher::getShared`) AND its backend subscription set (`Backend::watch` /
   `Backend::unwatch`) on `(dir, ignorePaths, ignoreGlobs)`, and runs each
   call's backend half on a libuv threadpool thread. Two overlapping calls for
   the same key therefore land in arbitrary order, and one order loses: the new
   `subscribe` finds the retiring watcher still registered (equal by key) and
   installs **no OS watches**, then the retiring `unsubscribe` tears the
   existing ones down. The new subscription resolves, holds its callbacks, logs
   `watcher installed`, and receives **nothing, forever**.

   Measured on `@parcel/watcher@2.5.6`: an un-awaited `unsubscribe()` followed
   by an immediate re-`subscribe()` of the same dir + ignore set produced a dead
   watcher in 18/25 idle runs, and 10/10 when the libuv pool was saturated (at
   rebuild delays from 15ms to 200ms). Awaiting the teardown first: 0/25 and
   0/10. On an idle process the teardown usually wins on its own, which is why
   this hides in single-scenario runs and only bites a loaded parallel suite.

   Rule: **serialize a directory's parcel calls** (kolu does this in
   `sequenceParcelCall`). Pinned by
   `working-tree-watcher.churn.test.ts`, which loads the threadpool to force
   the lossy ordering — on linux/inotify only, for the reason below.
5. **macOS: delivery can run ~15s behind, and parcel's stream is the reason.**
   Parcel's `startStream` (`src/macos/FSEventsBackend.cc`) creates the stream
   *without* `kFSEventStreamCreateFlagNoDefer`, so the first event's delivery
   is deferred rather than immediate. On a volume under constant churn the
   defer window collapses to the daemon's maximum coalescing window. Measured
   on kolu's darwin CI box (`ci@petit`, macOS 26.5.2, juspay/kolu#2175): first
   event **14.2s** after the write, then batches every **15.0s**, 53/53 events
   delivered — nothing lost, everything late. `fs.watch` in the same process,
   on the same directory, answered in **1.3s**; libuv passes `NoDefer`.

   Two consequences. A test may not gate on a parcel event arriving on darwin
   (see `fs-watch-delivery.testlib.ts` — it also records a rarer case where a
   post-churn subscription delivered nothing at all for 60s+, reproduced with
   no kolu code in the loop). And on a macOS host whose filesystem is this
   busy, kolu's own Code tab is that far behind — worth remembering before
   chasing a "stale git status" report as a kolu bug.
6. **`dontFixup = true` in `default.nix`** skips patchELF on the native `.node`
   binary. Today the `@parcel/watcher` binary loads its own libstdc++ via
   fallback paths and works, but if a future parcel-watcher version pulls in
   a harder dynamic-link requirement, expect to revisit this.

## Quick references

- Backend dispatch: `node_modules/.pnpm/@parcel+watcher@2.5.6/node_modules/@parcel/watcher/src/Backend.cc:30`
- Watchman invocation: `node_modules/.pnpm/@parcel+watcher@2.5.6/node_modules/@parcel/watcher/src/watchman/WatchmanBackend.cc:43`
- Kolu wrapper: `packages/integrations/git/src/working-tree-watcher.ts`
- Composed watcher API: `packages/integrations/git/src/repo-change.ts`
- Watchman integration issue: juspay/kolu#788
- Streaming endpoints that consume the watcher: `packages/server/src/router.ts`
  (`onStatusChange`, `onDiffChange`, `onListAllChange`, `onReadFileChange`)
