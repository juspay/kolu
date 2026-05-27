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

`backend: "default"` (Kolu doesn't pass an explicit backend) selects in this
order, first match wins:

1. `FSEvents` on macOS — native recursive, one stream per repo.
2. `WatchmanBackend` if `WatchmanBackend::checkAvailable()` returns true.
3. `WindowsBackend` on Windows — native recursive `ReadDirectoryChangesW`.
4. `InotifyBackend` on Linux — one inotify slot per non-ignored directory.
5. `KqueueBackend` on BSD.
6. `BruteForceBackend` — periodic full-tree stat; the fallback fallback.

So on Linux, watchman is preferred over inotify whenever it's reachable; on
macOS watchman is never used by default (FSEvents wins).

## How parcel invokes watchman

Source: `src/watchman/WatchmanBackend.cc`.

1. `checkAvailable()` (line 107) just calls `watchmanConnect()`.
2. `getSockPath()` (line 43) does the **only** `watchman` binary invocation:
   ```
   popen("watchman --output-encoding=bser get-sockname 2>/dev/null", "r")
   ```
   then parses BSER output for the `sockname` field. If `WATCHMAN_SOCK` env
   var is set, that wins and the binary isn't run at all.
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
`nix run` wrapper (`default.nix:156`) only adds `nodejs git gh` to PATH, so
`checkAvailable()` always returns false at runtime and parcel falls through to
inotify on Linux / FSEvents on macOS. Issue #788 tracks the integration work.

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

1. **Container/WSL2 bind mounts** — neither inotify nor FSEvents nor watchman
   is available. parcel-watcher silently falls back to ~1s polling. Latency
   degrades, correctness preserved.
2. **Linux inotify slot exhaustion** — kernel default is
   `fs.inotify.max_user_watches=8192`. A typical Kolu repo uses ~500–2000
   slots; multiple worktrees compound. Watchman amortizes this across one
   daemon (#788).
3. **`detect-libc` glibc/musl picker** runs on `require('@parcel/watcher')`
   (`index.js:5`). The Nix build needs the matching native binary in
   `node_modules` — confirm `@parcel/watcher-linux-x64-glibc` is present
   under `node_modules/.pnpm/`.
4. **`dontFixup = true` in `default.nix`** skips patchELF on the native `.node`
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
