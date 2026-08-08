# Kolu code-police rules

Kolu-specific rules layered on top of the base `code-police` skill — read by `code-police` from this file (`.agency/code-police.md`) when it runs. Each rule states only the "what"; apply judgment. A new rule must be the weakest wording that covers the incidents motivating it — state its carve-outs up front rather than banning more than the evidence demands (arXiv:2301.12987).

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
