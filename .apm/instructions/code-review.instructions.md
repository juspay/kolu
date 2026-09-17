---
description: Kolu's code-review law — the rules a review pass applies, the hickey/löwy lens catalogs it reads a diff through, and the layer ladder it judges placement against
applyTo: "{packages/**,ci/**,nix/**}"
---

## Code-review rules

Kolu's review rules. Each states only the "what"; apply judgment. A new rule must
be the weakest wording that covers the incidents motivating it — state its
carve-outs up front rather than banning more than the evidence demands
(arXiv:2301.12987).

### no-re-export-bridge-modules

A module whose entire body is `export … from` another package must not exist — consumers import from the source. Re-export plus genuine local content is fine.

### no-thin-wrapper-functions

A function whose entire body forwards its arguments to one other function (optionally binding a constant or renaming params) must not exist — inline the call; bind constants as module-level consts. Allowed when it composes ≥2 calls, adds a null/error transform, narrows a type, or has ≥3 callers.

### subscription-use-pending

Never check `sub() === undefined` as a proxy for loading — use `sub.pending()`.

### solid-reactive-prop-passed-to-hook-must-be-reactive

Never call a hook with a reactive prop value at component-body scope (`const x = useHook(props.key)`) — wrap in `createMemo` or call inline at each use site; a setup-scope call captures the mount-time value and silently desyncs.

### solid-show-callback-accessor-must-stay-live

In a non-keyed `<Show>`/`<Match>` callback child, never unwrap the accessor into a `const` — call it inside JSX expressions. The callback runs only on the falsy→truthy transition, so a snapshot renders frozen data for as long as the condition stays truthy.

### no-untyped-escape-hatches

No "narrow `T | null | undefined` to `T` by throwing" helpers (`unwrap`, `fromJust`, `assertNonEmpty`, …). Push the invariant into the type at its source: `NonEmpty<T>` from `nonempty`, a localized tuple cast for regex groups, `neverthrow` `Result` at fallible boundaries, restructuring away post-construction `Map.get`, `<Show>` callback narrowing in JSX, plain `if (x === undefined) throw` in tests.

### toast-must-include-error-message

When catching an error for a toast, include `err.message` in the toast text.

### caught-error-must-not-collapse-to-empty

A `try`/`catch` that converts an error into "no data" (`undefined`/`null`/`[]`/`""`) must leave the failure distinguishable from a legitimate empty result on a user surface (toast, error signal, `Result`, error boundary) — `console.*` doesn't count.

### styling-tailwind-only

Tailwind utilities only in markup. No custom CSS unless truly impossible with Tailwind.

### prefer-ts-pattern

Dispatch-with-logic on a discriminated or string-literal union uses `ts-pattern`'s `match(...).exhaustive()`, not `if`/`switch` cascades (`P.union`/`P.select`/`P.shape`/`P.instanceOf`/`isMatching` where they fit). Exception: a pure static A→B mapping is a fresh `Record<Union, T>` literal at the typed declaration; two-variant `?:` is fine.

### integration-perf-hygiene

Integration code (`packages/integrations/`) runs in a long-lived Node process: `fs.watch` callbacks use a trailing-edge debounce unless O(1) and allocation-free; file reads stream in chunks, never whole-file buffers; directory watchers go through a refcounted shared singleton; debug-only collections are bounded with eviction.

### no-sync-blocking-on-the-serving-loop

No synchronous, unbounded blocking call on any path reachable while serving (RPC handler, watcher install/callback, streaming source): no `execSync`/`spawnSync`/`execFileSync` (use promisified async with a `timeout`), no sync fs calls on possibly-slow/hung/user-supplied paths (use `fs.promises.*`), no `Atomics.wait`/spin waits. A synchronous resolver passed into an async primitive counts. Carve-out: a fast, known-local, one-shot read, justified at the call site.

### no-preference-prop-drilling

Components read preferences via `usePreferences()` directly (likewise `useActivityFeed()`, `useSavedSession()`) — never as props from a parent.

### app-shell-stays-thin

`App.tsx` is a thin layout shell. No new domain state, wiring, or orchestration: no non-layout reactive primitives, no dialog open-state signals (use `createDisclosure` in the dialog, or `useCommandPalette`), no inline `ActionContext`/`CommandDeps` assembly, no per-feature re-threading of `store.*`/`crud.*` into children, no `window.__…`/`querySelector` for state a singleton owns reactively. The reactive-primitive budget is CI-enforced by `App.shell.test.ts`; a bump needs a stated layout-level justification in the PR.

### errors-must-log-at-error

Actual errors log at `error` level. `warn` is for degraded-but-recoverable; `debug` for expected-absent conditions.

### subscription-must-surface-errors

Every `createSubscription` includes an `onError` that surfaces the failure to the user (typically `toast.error` with the message).

### e2e-poll-async-state

E2e step definitions never assert synchronously on asynchronously-changing state (clipboard, DOM, reactive updates) — poll with `page.waitForFunction()` and `POLL_TIMEOUT`.

### no-vacuous-assertion

An assertion, wait, or guard must be able to fail: run it once against a deliberately broken subject, watch it go red, then restore. Watch for unreachable subjects, fakes handing back their own mutable state, asserted quantities nothing produces, and test hooks that bypass the guard under test (delete the hook, not the test).

### watcher-lifecycle-logs

Every long-lived `fs.watch` (or analogous resource subscription) logs at `info` on install and retire, formatted exactly `"<integration>: <subject> watcher installed"` / `"… watcher retired"`, with the watch target in the structured fields object, not the message string. Applies only to long-lived resource subscriptions, not general lifecycle events.

### silent-handler-required-on-void-subscriptions

A hook or subscription primitive that returns `void` (no error accessor in the result type) must require its error handler at the type level, never make it optional.

### callback-fanout-guarded-at-funnel

A watcher/subscription that invokes a caller-supplied callback from more than one emission path puts the try/catch at the single shared funnel every path passes through (the `emit` helper), never on a subset of call sites.

### migration-shape-guard

A migration that acts on a specific value shape early-returns when the on-disk shape doesn't match its preconditions. Never write transient orphan fields that later migrations are expected to strip.

### persisted-schema-stays-tolerant

Tightening a persisted schema's validation (a `.refine`, a newly-required field, a stricter type) is a backward-incompatible change to data already on disk. Old format released → `state.ts` migration plus `SCHEMA_VERSION` bump. Never released → no migration; validate shape only and enforce cross-field invariants by filtering at the read boundary. One bad record must never fatally reject a whole persisted array cell.

### icons-in-registry

All SVG icons are named exports in `packages/client/src/ui/Icons.tsx` — never inline SVG markup in components.

### new-package-has-readme

Every new workspace package ships a `README.md` in the same change: a one-line bold "what it is", what it owns, and explicitly what it knows nothing about (the boundary).

### no-overloaded-null

A nullable, sentinel, or optional whose absent value carries more than one meaning is a defect — replace it with a `{ kind: … }` discriminated union. Signals: the producer maps distinct causes to one absent value where at least one is a caught error/fault the domain should surface; read sites handle the absence divergently; a name/comment admits two absence-reasons a consumer should tell apart. Also flag string/number sentinels (`""`, `-1`) standing in for a state with a real name, and optionals a consumer treats as a named on/off domain state. Fine to leave alone: a single honest absence, two honest no-datum causes that every reader folds identically, a nullable discriminated to a sum at its sole read site, and a genuine two-state encoding where both values are named and needed.

### feature-subsystem-gets-a-directory

More than two non-test modules sharing one feature's vocabulary in a package's `src/` — or feature-specific helpers inlined in an entry file — move into a subdirectory named for the feature.

## Hickey — project complecting patterns

Rich Hickey's *Simple Made Easy* hands a review one question: is this
**complected** — are two ideas braided into one thing? These patterns extend his
catalog with the braids this project's SolidJS + Effect architecture actually
produces. The method, with two worked kolu cases, is
`website/src/content/blog/hickey-lowy.mdx`.

| Construct                                                                                                            | What it complects                                            | Simpler alternative                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Imperative collection lifecycle in reactive framework (`Map` + `AbortController` + `createEffect` that diffs a list) | What + when + cleanup + identity tracking                    | `mapArray` / `indexArray` — framework manages per-item reactive owners and disposal                              |
| Manual subscription teardown (`AbortController` tracking per entity)                                                 | Lifecycle + state + identity                                 | Reactive owner disposal via `onCleanup` inside `mapArray` or `createRoot`                                        |
| Version-counter signals to force reactivity (`[version, setVersion] = createSignal(0)`)                              | Reactivity tracking + state + workaround for broken tracking | Fix the tracking root cause — use reactive primitives (`mapArray`, `createMemo`) that SolidJS can track natively |
| Dual stores for one concern (local `createStore` + subscription/query for same data)                                 | Value + time + two sources of truth                          | Single reactive source; only justify dual stores when async round-trip latency is measurable (>16ms)             |
| `createEffect` that writes to signals/stores (effect-as-state-machine)                                               | When + what + control flow                                   | `createMemo` for derived values, `mapArray` for per-item derivations, `on()` for explicit dependency tracking    |
| Hand-rolled snapshot+install+re-read loop in a streaming handler (`yield X; for await (ev of subscribe(...)) yield ev` × N routes) | wire protocol + transport + lifecycle + per-route identity | Framework primitive that owns the snapshot+deltas shape (`Cell` / `Stream` / `pollOnEvent` declarative form). Per-route code declares schema + read/install only; the framework handles snapshot ordering, equality suppression, and reconnect. |
| Manual `AbortController + subscribe + cleanup` triplet at consumer sites (`new AbortController(); consumeChannel(ch, abort.signal, on, err); return () => abort.abort()`) | what + cleanup + identity tracking | `Channel<T>.consume({ onEvent, onError })` returning the cleanup fn directly. Framework owns the controller. Generalizes to any subscription primitive — the cleanup return type is the seam. |

## Löwy — project volatility axes

Juval Löwy's *Righting Software* hands the other question: what here changes at a
rate different from what surrounds it, and does the code's shape admit that it
does? The method and its relationship to the Hickey lens are in
`website/src/content/blog/hickey-lowy.mdx`.

### Pattern-as-artifact — ask this before judging a boundary

Before evaluating boundaries within a diff, ask: **is the diff at the right altitude?** Specifically — is the *pattern* across N call sites itself the artifact that should be encapsulated, rather than the per-call-site cleanup the diff is currently proposing?

Hickey catches local complecting; this list catches local volatility-axis misalignment. Neither lens, as currently tuned, asks the meta-question of whether the pattern under review is a missing seam rather than a present problem. A diff that touches 12 call sites, each of which is locally clean and locally correct, can still be the wrong diff if those 12 call sites are running the same cassette of plumbing the framework should own.

When a review surfaces "this is the same shape every time" across consumers, treat that as a Layer-0 finding and recommend extraction *before* per-call-site fixes. The post-extraction diff usually deletes more lines than it adds, and the consumers it leaves behind are smaller than the ones it found.

### Areas of volatility

Surviving candidates from Kolu's own variable-vs-volatile screen. Each row names a volatility that has already shifted in this codebase and has a concrete encapsulation target. Rows are not findings — a review re-applies Lowy's bar (what + why + risk × likelihood × effect) and audits whether the boundaries under review actually encapsulate these, rather than leaking them into consumers.

| Area of volatility                        | What changes                                                                                                                                                                                                                                                                                                                                         | Why volatile (likelihood × effect)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Expected encapsulation                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-pushed state delivery              | Transport and shape of live server state — Effect `Stream`s over Effect RPC today (oRPC async iterables before that), with prior iterations and likely future ones (SSE, WebSocket, RSC-style server signals)                                                                                                                                                                                       | Likelihood: the transport for live state has already moved in this codebase; streaming is a live concern (see `streaming.instructions.md`). Effect: every consumer of live server state would need rewriting if the transport leaked into components — blast radius is the entire reactive surface of the client.                                                                                                                                                                            | Behind the `createSubscription` seam (`packages/surface/src/solid/createSubscription.ts`, which the framework graduation moved out of the app). Consumers see a SolidJS-signal-shaped API with `reconcile` fine-grained reactivity and never reach for the underlying `Stream`, its fiber, or the retry fence directly. One-shot RPC calls go through plain `client.*` calls — they are a _different_ volatility and stay out of this seam.                                        |
| Async-initialization cleanup registration | SolidJS's global reactive `Owner` is null across any `await` boundary. `onCleanup(...)` calls made after the await — directly, or transitively via library helpers like `@solid-primitives/*` — land on a null owner and become silent no-ops. The set of async-init call sites changes whenever a component grows new setup work behind an `await`. | Observed twice already — [#598](https://github.com/juspay/kolu/pull/598) for direct `onCleanup` inside `Terminal.tsx` `onMount`; [#600](https://github.com/juspay/kolu/pull/600) for `@solid-primitives/resize-observer`'s internal `onCleanup`. Effect: whole subsystems leak (ResizeObservers, xterm `Terminal` instances, ~900 KB per leaked component) with no runtime error — only heap-snapshot retainer walks catch it. Every future `await` inside an `onMount` is a latent failure. | Capture `getOwner()` synchronously before the await; wrap the post-await body in `runWithOwner(owner, () => { ... })` so library-internal `onCleanup` calls register on the component's cleanup list. Subsystems (`scrollLock.attachToTerminal`, `registerDiagnostics`, etc.) should register their own `onCleanup` at attach time rather than returning manual `detach()` handles — the owner system is what enforces the contract.           |
| xterm private buffer / service path       | The shape of xterm.js's internals — `_core`, `_bufferService`, `buffers.normal/alt`, `BufferLine._data` — that diagnostic code must read to measure cell-grid bytes, atlas state, etc. xterm's public API exposes neither.                                                                                                                           | Likelihood: xterm is actively developed and private fields get renamed between majors. Effect: a direct reach-through from a component file crashes the whole render path when a rename lands. Low-likelihood-per-release × high-effect-on-hit.                                                                                                                                                                                                                                              | Behind `TerminalProbes` in `packages/client/src/terminal/terminalRefs.ts` (`webglAtlas`, `bufferBytes`, …) — each probe is a `() => T \| null` thunk registered from `Terminal.tsx` where the xterm instance lives. Consumers read `refs?.probes.X() ?? null` and render "unknown" on null. Adding a new private-path read means adding a probe, not a new reach-through from the consumer.                                                    |
| Canvas lifecycle + runtime geometry       | The set of still-alive `HTMLCanvasElement`s minted by xterm's `WebglAddon`, whether they are DOM-connected, whether their GL context is lost, and their pixel-buffer dimensions. Every terminal create/focus-swap/mode-toggle changes this set.                                                                                                      | Surfaced during the [#591](https://github.com/juspay/kolu/issues/591) zombie-context hunt and remains the key signal for post-#600 residual GPU memory. Effect: consumers that hand-walk the DOM for canvases (or `WeakRef` their own) duplicate state the tracker already owns, risking divergent counts.                                                                                                                                                                                   | In `packages/client/src/terminal/webglTracker.ts`. `webglLifecycleSnapshot()` emits `WebglLifecycleSnapshot` with aggregated counts (`aliveInDom`, `aliveDetached`, `gced`, `contextsLost`) and `aliveCanvases: CanvasSizeEntry[]` carrying `{ canvasId, terminalId, width, height, bytesEst, isConnected, contextLost }` per canvas. Consumers never touch `WeakRef`, DOM queries, or `gl.isContextLost()` directly — they read the snapshot. |
| Terminal grid measurement                 | Whether a pane's cols×rows is a REAL measurement of its own box or a fabrication — xterm's invented 80×24 before any fit, and `@xterm/addon-fit`'s 2×1 clamp floor for a present-but-degenerate box. A `display:none` or 0-sized pane is never measurable at all, and the addon reads the LAYOUT box while a bounding rect reports the transform-scaled visual one.                                                                                          | Observed: a split hidden at page load attached at the invented grid and never self-repaired — kaval no-ops a same-dimensions resize, so no SIGWINCH ever reached the process and only nudging the divider fixed it (#2075). Likelihood recurs with every new hidden-at-mount surface (collapsed splits, background sub-tabs, mobile single-pane) and with each xterm/fit-addon major. Effect: a stale garbled screen with no repair path — and now that the attach carries the grid, a fabricated one SIGWINCHes a live PTY to it.                                                       | Behind `XtermHandle.grid` / `XtermHandle.onceMeasured` in `@kolu/xterm-kit/solid` — `null` until the box is genuinely measured, with both fabrication modes declined inside `applyFit`, and the kit owning the wait-for-measurement latch. The attach request carries the measured grid (`resizeTo`) so the resize and the serialize are one act. Consumers never read `terminal.cols/rows` to decide whether a grid is real, and never re-derive "no grid, no bytes" by hand.                                                            |
| ssh dead-peer / link-silence policy       | Which ssh options spell dead-peer detection (`ServerAliveInterval`/`ServerAliveCountMax` today), how they render into argv vs the word-split `NIX_SSHOPTS` form Nix's forked ssh reads, and how a connection's IDENTITY must carry the policy — OpenSSH takes `ServerAlive*` from whichever process opened the `ControlMaster`. Also *who chooses* the tolerance: a baked ~30s const until #2231, per-dial thereafter.                                                                                 | Likelihood: already moved once (const → per-dial typed option, #2231), and the same fact is spelled twice more — `@kolu/port-forward`'s `SSH_OPTS` freezes it as an argv literal (deliberately independent: a forward is cheap to re-establish) and `@kolu/surface`'s heartbeat answers the CONNECTED-phase half in another unit under another ceiling. Effect: a wrong policy is INVISIBLE — right argv, wrong behaviour — which is the master-inheritance failure the socket keying exists to abolish.                                              | `SshKeepalive` + `sshKeepalive()` in `@kolu/surface-remote/src/keepalive.ts` — a branded value whose only producer validates it, so "valid" is a type fact rather than an assertion each accepting seam repeats; `sshConnector({ keepalive })` threads it, and `controlMaster.ts` keys the socket by it. Consumers render the complete opt set with `sshDialOpts` — the only shape the package exports. `@kolu/port-forward` deliberately does NOT track a dial's tolerance and keeps its own literal; if the two must ever agree, the shared pair graduates into a zero-dep receptacle both read. |

## Layer ladder and ecosystem hints

### The layer ladder (lowest honest layer wins)

`solid-generic (no surface concept)` < `@kolu/surface` (+ `/solid`, `/server`) < `@kolu/surface-app` (app-shell glue) < `@kolu/surface-nix-host` (ssh/Nix hosting) < `@kolu/surface-daemon(-supervisor)` (daemon lifecycle) < app policy (`packages/client`, `packages/server`). A pure-solid helper in surface-app is a placement smell; app policy in surface-app is a leak.

### Ecosystem hints (what "already ships this?" means here)

- SolidJS-native libraries are the house default (conventions.md). Check **@solid-primitives/*** first — `rootless` (createSingletonRoot/createSubRoot), `storage`, `event-listener`, `scheduled`, `media`, `resize-observer`, `trigger`, `memo`, `static-store`, `deep`. Several are already direct or transitive deps — **check `pnpm-lock.yaml`, not just package.json** (a transitive dep costs zero to promote).
- **solid-js built-ins** are ecosystem too: `mapArray`/`indexArray` (keyed roots with owner-tied disposal), `on`, `untrack`, `createMemo`, `mergeProps`.
- **node built-ins**: `node:events` `once(emitter, event, {signal})`, `AbortSignal.timeout`.
- In-repo framework exports before hand-rolling: `@kolu/surface*`, `@kolu/padi-client/dial`, `createSharedRoot` (NOT a `createSingletonRoot` duplicate — audited 2026-07-06: rootless ref-counts, all 18 kolu consumers require never-teardown; the semantic distinction is documented in its header).
