# Kolu code-police rules

Kolu-specific rules layered on top of the base `code-police` skill — read by `code-police` from this file (`.agency/code-police.md`) when it runs.

## Additional Code Police Rules

These rules extend the base code-police skill with Kolu-specific patterns. They are checked during Pass 1 (rule checklist) alongside the generic rules.

### no-re-export-bridge-modules

A module whose entire body is `export … from "another-package"` (no
locally-defined values, types, or doc) must not exist. Consumers should
import directly from the source.

Bad: a `kolu-common/integrations.ts` that just re-exports `GitInfoSchema`,
`PrResultSchema`, `ClaudeCodeInfoSchema`, … from their respective
integration packages. Or a `kolu-common/pr.ts` whose only content is
`export … from "kolu-github/schemas"`. Both create a fake fan-in: the
consumer's import path lies about where the symbol lives.

Good: consumers `import { GitInfo } from "kolu-git/schemas"` directly.
The integration package is the source of truth; one place to grep.

_Allowed_: a module that re-exports AND adds local content (a curated
narrow surface plus locally-defined helpers, schemas, or documented
boundary semantics). A pure re-export with a comment explaining "this
exists to avoid X bundling" is still a bridge — fix the underlying
issue (subpath the source package exposes for browser-safe types) or
let consumers reach for the source directly.

_Rationale_: re-export bridges add an indirection that consumers and
tools have to chase, drift over time (the bridge's set of re-exports
goes stale relative to the source), and create the illusion that
`kolu-common` owns concepts it doesn't. The `kolu-common` package
should hold things that are genuinely shared across the host app and
have no other natural home — not be a barrel for every external
schema the app happens to use.

### no-thin-wrapper-functions

A function whose entire body forwards its arguments to one other function —
optionally binding a constant or renaming params — adds no logic and must not
exist. Inline the call at its (single) site; when a bound constant is involved,
make it a module-level `const` next to the call, not a function. This is the
function-level sibling of `no-re-export-bridge-modules`: the same
fake-indirection smell, applied to call-forwarding instead of symbol
re-exporting.

Bad — a wrapper that only injects a constant codec and forwards every arg
(`iframePreviewNav.ts`, whose sole caller was `BrowseIframeRenderer`):

```ts
export function repoPathFromPreviewPathname(reported, currentUrl, currentPath) {
  return pathFromPreviewPathname(reported, currentUrl, currentPath, {
    encode: encodePreviewPath,
    decode: decodePreviewPath,
  });
}
```

Good — bind the constant once where it's used, call the real function directly:

```ts
const previewCodec = { encode: encodePreviewPath, decode: decodePreviewPath };
// …in the handler:
const next = pathFromPreviewPathname(pathname, props.url, props.path, previewCodec);
```

_Allowed_: a function that does real work beyond forwarding — composes ≥2 calls,
adds a null/error transform, narrows a type, or has ≥3 callers that would
otherwise repeat the same binding (the rule-of-three from `dry-rule-of-three`).
`resolveMarkdownImageSrc` (resolve → null-check → build a file-route URL) is
fine: it composes and transforms; it isn't a pass-through.

_Rationale_: a single-caller pass-through is indirection a reader has to chase
only to discover it does nothing — the same drift/lie cost as a re-export
bridge, minus even the excuse of crossing a package boundary. Bind constants
where they're used and let the one caller reach the real function directly.
Codified after `repoPathFromPreviewPathname` ([kolu#1191](https://github.com/juspay/kolu/pull/1191)) —
a wrapper that existed only to inject kolu's preview-URL codec into
`@kolu/solid-browser`'s `pathFromPreviewPathname`.

### subscription-use-pending

Never check `sub() === undefined` as a proxy for loading — use `sub.pending()`.
_Rationale_: Conflates "loading" with "no data" and misses error states.

### solid-reactive-prop-passed-to-hook-must-be-reactive

A "hook" call that takes a reactive prop value as a key — `useComments(props.repoRoot)`, `useStore(props.id)`, `useThing(props.path)` — must be wrapped in `createMemo` or called inline at each use site. A bare `const x = useHook(props.key)` in the component body captures `props.key` at mount, locks the result to that initial value, and silently desyncs if the prop changes — by which point the component is bound to the wrong instance and no surface (toast, console, type error) flags it.

Bad:
```ts
const store = useComments(props.repoRoot);
return <Show when={store.comments().length > 0}>…</Show>;
```

Good:
```ts
const store = createMemo(() => useComments(props.repoRoot));
return <Show when={store().comments().length > 0}>…</Show>;
```

Also good — inline at an event-handler use site, where the prop is re-read at click time:
```ts
const submit = () => useComments(props.repoRoot).add(…);
```

_Rationale_: SolidJS re-renders don't re-execute a component's body — only JSX-embedded reactive reads do. A function call in the body that takes a prop value sees only the initial value. This is the same failure mode that "props stay reactive" (in `.claude/rules/solidjs.md`) covers for destructuring, but applied to function-argument passing — a subtler trap because no `const { x } = props` appears in the diff. Codified after the `CommentsTray` / `CommentTextSurface` / `CommentIframeSurface` first-comment regression: the tray captured `useComments(props.repoRoot)` at mount when `meta.git.repoRoot` hadn't streamed yet, so `props.repoRoot` was `""`; the composer (which reads `props.repoRoot` inside its submit handler — fresh) wrote to the real-repoRoot store, and the tray stayed bound to the empty-key one until a full refresh re-mounted it.

### no-untyped-escape-hatches

Don't introduce helpers like `unwrap`, `fromJust`, `assertNonEmpty`, or any other "narrow `T | undefined | null` to `T` by throwing" wrapper. The type system doesn't see the throw, callers can't handle it, and `catch (err: unknown)` swallows it the same as a `!`. Push the invariant to the type at its source.

- **Non-empty arrays** → use `NonEmpty<T> = readonly [T, ...T[]]` from the `nonempty` package. The smart constructor `nonEmpty(arr)` returns `NonEmpty<T> | null`, forcing the caller to narrow. For checked-in JSON whose regen pipeline guarantees non-emptiness, cast at the import boundary (`as [T, ...T[]]`) and back the cast with a unit test that loads the JSON and asserts `length > 0` — empty becomes a CI failure, not a runtime one.
- **Regex match groups** that the pattern guarantees but TS types as `string | undefined` → destructure with an explicit tuple cast (`const [, hex] = m as unknown as [string, string]`), localized to the parser. Don't repeat the cast at every consumer.
- **Genuine fallible boundaries** (parsing, I/O) → return `Result<T, E>` from `neverthrow` so the caller is forced to handle the error in the type.
- **`Map.get` after construction** → restructure so the lookup goes away (iterate `map.values()` instead of `keys.forEach(k => map.get(k))`, return zipped entries instead of a Map the caller has to look back up).
- **Solid signal reads in JSX** → `<Show when={…}>{(box) => …}` callback form narrows automatically.
- **TS-narrowing-but-not-quite** in tests → plain `if (x === undefined) throw new Error(...)`.

Bad: `unwrap(arr[i], "out of bounds")` — type system can't see the throw
Good: `arr[i] ?? arr[0]` on `NonEmpty<T>` — positional `arr[0]` is statically `T`, fallback is typed
_Rationale_: Every "untyped throw" wrapper is an escape hatch the compiler can't reason about. The fix is structural — make the data model carry the invariant — not packaging the same assertion behind a nicer name.

### toast-must-include-error-message

When catching an error to show a toast, always include `err.message` in the toast text.
Bad: `.catch(() => toast.error("Failed to set theme"))`
Good: `.catch((err: Error) => toast.error(\`Failed to set theme: ${err.message}\`))`
_Rationale_: Generic error toasts hide the server's actual error message, making debugging impossible. The server returns specific error details via oRPC — surface them.

### caught-error-must-not-collapse-to-empty

When a `try`/`catch` converts a thrown error into a "no data" return value (`undefined`, `null`, `[]`, `""`), the failure must be **distinguishable to the user from a legitimate empty result**. `console.warn` / `console.error` does not count — DevTools is not a user surface. Surface via toast, an error signal the caller renders, a `Result<T, E>` return, or an error boundary.

Bad: `try { return parse(raw); } catch (e) { console.warn(e); return undefined; }` — caller can't tell malformed-input from no-input
Good: `try { return ok(parse(raw)); } catch (e) { return err({ message: e.message }); }` — caller decides how to render the error

_Rationale_: A silent fallback to empty state means a malformed input renders identically to a missing one. The bug stays invisible until someone notices and instruments DevTools — by which point the data path has been wrong for weeks. This rule covers the gap `toast-must-include-error-message` leaves: that one is about *how* to format a toast you've already decided to show; this one is about whether the failure surfaces at all.

### styling-tailwind-only

Tailwind utilities only in markup. No custom CSS unless truly impossible with Tailwind.

### prefer-ts-pattern

When **dispatching with logic** on a discriminated union or string-literal union — nested conditions, multi-field tests, predicates, or sibling cases that share a handler — use `ts-pattern`'s `match(...).with(...).exhaustive()` instead of an `if`/`switch` cascade.

_Rationale_: `exhaustive()` is a compile-time check — adding a new variant to the union forces every match site to handle it. Cascades silently fall through to a default branch and the bug only surfaces at runtime, if ever.

Bad: `if (state === "a") ...; else if (state === "b") ...; else ...`
Good: `match(state).with("a", ...).with("b", ...).exhaustive()`

Also encouraged inside `match`:

- `P.union(a, b)` to collapse sibling cases that share a handler.
- `P.select()` / `P.select('name')` to extract subvalues into the handler argument instead of re-destructuring.
- `P.shape({...})` over hand-rolled type guards on discriminated unions.
- `P.instanceOf(ErrorClass)` for typed error handling in `catch` blocks.
- `isMatching(pattern, x)` inside `Show when={...}` and array filters when the predicate is structural.

**Exception — pure A→B mappings**: When the dispatch is a static lookup with no per-arm logic (no closures, no computation, no shared handlers), prefer `Record<Union, T>`. A fresh `Record<Union, T>` literal is already exhaustive at the type level — TypeScript's required-property check fires if a union member is added, and its excess-property check fires if one is removed (verified against `tsc`). Wrapping the table in `match` adds closures and indirection without removing any failure mode. Example: `const styles: Record<WsStatus, string> = { open: "bg-ok", closed: "bg-danger", connecting: "bg-warning" }`. The excess-property half of the guarantee only holds for _fresh_ literals written directly at the typed declaration — if the table is built into a variable first and then assigned, only the required-key half survives. Two-variant booleans / nullable checks where `?:` reads cleaner are also fine to leave alone.

### integration-perf-hygiene

Integration code (under `packages/integrations/`) runs in a long-lived Node process — performance bugs compound over hours. Apply the general `no-unbounded-growth` rule with these kolu-specific reinforcements:

- **`fs.watch` callbacks must debounce.** Claude streams tokens continuously; on Linux `fs.watch` fires multiple events per write. Any handler that does I/O, parsing, or allocation must use a trailing-edge debounce (see `TRANSCRIPT_DEBOUNCE_MS` in `session-watcher.ts`). A bare handler is only acceptable if the work is O(1) and allocation-free.
- **File reads must stream in chunks.** Transcripts grow without bound. Never `Buffer.alloc(fileSize)` or read an entire file into memory when the consumer processes it incrementally — use chunked reads with a remainder carried across calls (see `scanTasksIncremental` pattern).
- **Directory watchers must be shared.** Multiple callers watching the same directory (e.g. `SESSIONS_DIR`) must go through a refcounted singleton, not each install their own `fs.watch`. N watchers = N duplicate callbacks = N-fold cost per event.
- **Debug-only collections must be bounded.** Arrays that accumulate diagnostic state need a cap with `shift()`-before-`push()` eviction to prevent unbounded growth in long-lived processes.

### no-sync-blocking-on-the-serving-loop

The kolu server (`packages/server`) and the integration code it loads
(`packages/integrations/*`, `kaval`, `pulam`, …) run on a **single Node event
loop** that serves every HTTP/WebSocket request. A synchronous, unbounded
blocking call on a code path reachable while serving freezes that one loop —
*all* requests hang at once, at ~0 CPU, with no crash, until the blocking call
returns. Flag, on any path reachable from an RPC handler, a watcher
install/callback, or a streaming source:

- **Synchronous child processes** — `execSync` / `spawnSync` / `execFileSync`. Use
  the promisified async form (`promisify(execFile)`) with a **`timeout`** (and let
  the wait happen on a libuv thread). A subprocess wait (`waitpid`) is the worst
  offender: with no timeout it can hang forever (a contended repo, a stuck FS).
- **Synchronous filesystem calls on a path that may be slow/hung** —
  `readFileSync` / `statSync` / `realpathSync` / `accessSync` / `existsSync` on a
  worktree, mount, or user-supplied path. Prefer `fs.promises.*`. (A one-shot
  `*Sync` on a known-local, known-fast path — config read at boot — is fine; the
  rule targets the *serving* loop and *unbounded/remote* targets.)
- **Any other unbounded synchronous wait** reachable while serving (`Atomics.wait`,
  a `deasync`-style spin, a `while` loop with no bound).

A synchronous resolver passed into a generic async primitive counts too: if
`createDirFilenameWatcher`'s `resolveDir` (or any install hook) runs a blocking
call, the "async" wrapper doesn't save you — the block happens inline on
subscribe. Keep the blocking work off the loop, or hoist it into an already-async
caller. Where a residual sync call is genuinely justified (a fast, known-local
one-shot stat — e.g. `hasGitDir`), say so at the call site: the carve-out is for
*fast, local, one-shot* reads, never for a subprocess wait or a path that can be
remote/slow.

_Rationale_: a single synchronous `execSync('git rev-parse')` on the git-watcher
install path froze the production server's event loop for **25 minutes** on
2026-06-28 (browser unresponsive, ~0 CPU, no crash, all logging stopped at once),
recovering only on a manual redeploy ([#1615](https://github.com/juspay/kolu/pull/1615)).
`just check` never catches this — a sync call typechecks and lints clean; only a
reviewer who knows "this runs on the serving loop" does. This rule is that
reviewer.

### no-preference-prop-drilling

Components must read preferences from `usePreferences()` directly, not receive them as props from a parent. The singleton subscription guarantees shared reactivity — all callers read through one `createSubscription` instance. The same applies to the activity feed (`useActivityFeed()`) and saved session (`useSavedSession()`) — each domain has its own dedicated singleton hook.
Bad: `<Child scrollLock={preferences().scrollLock} />` then `props.scrollLock` in child
Good: `const { preferences } = usePreferences();` inside the child component
_Rationale_: Prop-drilling preferences creates unenforced coupling ("parent extracts the right field and passes it to the right consumer") and bloats App.tsx's wiring surface. Components that own their behavior should own their preference reads too.

### app-shell-stays-thin

`packages/client/src/App.tsx` is a thin layout shell — it mounts the chrome, the canvas surface, the dialogs, and the overlays, and composes domain singletons. It must NOT accrete new domain state, wiring, or orchestration. Reject a diff that, in `App.tsx`:

- adds a `createSignal` / `createMemo` / `createEffect` for anything other than layout-level state (the close-confirm target, the `canvasMode` memo, and the `workspaceEntries` command-source memo are the whole baseline);
- adds a new dialog/overlay open-state signal — push it into the dialog component via `createDisclosure` (`ui/createDisclosure.ts`), or into `useCommandPalette` for the palette;
- assembles `ActionContext` / `CommandDeps` wiring inline instead of in `useActionContext` / the owning `useXxx.ts`;
- adds a per-feature handler that re-threads `store.*` / `crud.*` into a child (the child should read the singleton — see `no-preference-prop-drilling`);
- reaches `window.__…` / `document.querySelector` for state a singleton already owns reactively (e.g. "is any dialog open" → `useDialogStack`).

New shared state goes in a `useXxx.ts` singleton (the pattern every other domain follows); new dialog open-state goes in the dialog component. The reactive-primitive budget is CI-enforced by `packages/client/src/App.shell.test.ts`. Bumping that budget is allowed only for genuinely layout-level reactive state, and the PR must say why — the bump is a deliberate, reviewable exception, not a silent ratchet.

Bad: `const [aboutOpen, setAboutOpen] = createSignal(false)` in App.tsx, drilled into the dialog
Good: `export const aboutDialog = createDisclosure()` in `AboutDialog.tsx`; App just mounts `<AboutDialog />`

_Rationale_: App.tsx is the catch-all every feature is tempted to land "a little wiring" in; left unchecked it drifts back into the 785-line kitchen-sink #1340 restored. The "thin layout shell" rule (`.claude/rules/solidjs.md`) had no teeth — this rule plus the budget test give it teeth. Codified after the #1340 decomposition.

### errors-must-log-at-error

Actual errors (failed I/O, failed queries, unexpected exceptions, callback throws) must log at `error` level, not `warn` or `debug`. Reserve `warn` for degraded-but-recoverable states (e.g. a non-critical fallback path). Reserve `debug` for expected-absent conditions (e.g. file not found on a machine that doesn't have the tool installed).
Bad: `log.warn({ err }, "query failed")` / `log.debug({ err }, "scan failed")`
Good: `log.error({ err }, "query failed")`
_Rationale_: Operators filter on `error` level for alerting. An actual failure logged at `warn` or `debug` is invisible in production. The `Logger` type in `anyagent` includes all four levels (`debug`, `info`, `warn`, `error`) — use the right one.

### subscription-must-surface-errors

Every `createSubscription` call must include an `onError` handler to surface failures to the user (typically via `toast.error()`). A subscription without `onError` silently swallows server-side failures — the stream dies and the user sees stale/missing data with no indication of what went wrong.
Bad: `const sub = createSubscription(() => stream.preferences());`
Good: `const sub = createSubscription(() => stream.preferences(), { onError: (err) => toast.error(\`Preferences subscription error: ${err.message}\`) });`
_Rationale_: oRPC application errors (`ORPCError`) are not retried by `ClientRetryPlugin`, so the stream dies permanently. Without `onError`, the failure is invisible — the user gets a blank or stale UI with no toast, no console warning, nothing.

### e2e-poll-async-state

E2e step definitions must never assert synchronously on state that changes asynchronously (clipboard, DOM content, reactive UI updates). Use `page.waitForFunction()` with `POLL_TIMEOUT` to poll until the expected condition is met.
Bad: `const text = await page.evaluate(() => navigator.clipboard.readText()); assert.ok(text.includes(expected));`
Good: `await page.waitForFunction((exp) => navigator.clipboard.readText().then(t => t.includes(exp)), expected, { timeout: POLL_TIMEOUT });`
_Rationale_: A bare `page.evaluate()` + `assert` is a race condition — the async operation (clipboard write, SolidJS reactivity flush, DOM update) may not have completed by the time the read fires. This passes on fast machines (x86_64-linux) and fails on slower ones (aarch64-darwin). The fix was applied in commit `36c82cd` for command palette tests; this rule prevents the pattern from recurring.

### watcher-lifecycle-logs

Every long-lived `fs.watch` (or analogous subscription — refcounted singleton, DB WAL watcher, per-session JSONL tail) must emit `info`-level logs at install and retire, formatted exactly:

```
"<integration>: <subject> watcher installed"
"<integration>: <subject> watcher retired"
```

Pass the watch target (`gitDir`, `dir`, `path`, `walPath`, `session`, etc.) in the **structured fields** object — not in the message string. The message owns the label; the fields own the identity.

Examples in tree (mirror these):

| Site | Label | Fields |
| --- | --- | --- |
| `git/head-watcher.ts` | `git: head` | `{ gitDir }` |
| `anyagent/wal-subscription.ts` | `<config.label>: wal` | `{ walPath }` |
| `claude-code/core.ts` `tryWatchDir` | `claude-code: dir` | `{ dir }` |
| `claude-code/session-watcher.ts` | `claude-code: transcript` | `{ path, session }` |
| `codex/session-watcher.ts` | `codex: session` | `{ session }` |
| `opencode/session-watcher.ts` | `opencode: session` | `{ session }` |

_Why_: operators correlating watcher counts in long-running processes need a single grep pattern (`grep "watcher \(installed\|retired\)"`) that catches every site. Format drift — different verbs, different prefix punctuation, label-in-fields-instead-of-message — silently breaks the correlation tool.

_What this rule is NOT_: a generic "log every lifecycle event" mandate. PTY spawn/exit, agent session match/end, and other lifecycle pairs use their own verbs and stay as ordinary `log.info({...}, "X started")` calls. This rule fires only when adding a long-lived `fs.watch` or analogous resource subscription.

_Bad_:

```ts
log.info({ dir, kind: "claude-code" }, "watcher installed: dir");
log.info({}, `claude-code dir watcher started at ${dir}`);
```

_Good_:

```ts
log?.info({ dir }, "claude-code: dir watcher installed");
log?.info({ dir }, "claude-code: dir watcher retired");
```

### silent-handler-required-on-void-subscriptions

When a hook or subscription primitive returns `void` (no `Subscription<T>` / `error()` accessor / `Result<T,E>` exposed in the result type), its error handler must be **required** at the type level — not optional. A void-returning subscription with optional `onError` silently swallows lifecycle failures: the source dies, the consumer never re-fires, no UI surface, no console warning, nothing.

Bad:
```ts
function useEvent(...): void {
  // catch (err) { if (options?.onError) options.onError(...); }
}
```

Good:
```ts
function useEvent(..., options: { onError: (err) => void; ... }): void {
  // catch (err) { options.onError(...); }
}
```

_Rationale_: a hook returning `Subscription<T>` with `.error()` lets consumers read the error reactively and render it — optional `onError` is fine there. Void return with no error surface in the result type is a category mismatch; the type system has to require the handler or the failure is invisible by construction. Codified after `useEvent.onError` and `pollOnEvent.onReadError` were tightened to required in `@kolu/surface`.

### callback-fanout-guarded-at-funnel

A watcher/subscription that invokes a caller-supplied callback (`onChange`, `onEvent`, an `emit` helper) from **more than one emission path** must place the try/catch at the single shared funnel the callback passes through — never on a subset of the call sites. A throwing consumer that escapes is not a benign log line: floated through a `void fetchAndEmit()` it surfaces as an **unhandled rejection** (fatal — the global handler in `index.ts` calls `process.exit(1)`), and from a synchronous `channel.consume({ onEvent })` callback it **breaks out of `buildConsume`'s `for await` loop** (`@kolu/surface`), silently freezing that subscription for the rest of the terminal's life.

Bad — boundary on the async path only, leaving the synchronous pending emit uncontained:
```ts
async function fetchAndEmit(root) {
  try { emit(await resolveGitHubPr(root)); } catch (err) { log?.error(…); }
}
function setGit(...) {
  emit({ kind: "pending" }); // ← still runs onChange synchronously, unguarded
  void fetchAndEmit(root);
}
```

Good — boundary inside `emit`, the one point every path funnels through:
```ts
function emit(pr) {
  if (stopped || prResultEqual(pr, lastPr)) return;
  lastPr = pr;
  try { onChange(pr); } catch (err) { log?.error({ err }, "…: emit failed"); }
}
```

_Rationale_: the dangerous escape is the *uncovered* path, and watchers routinely emit from several (a synchronous "pending" on change + an async resolved value + a poll tick). Guarding one path reads as "handled" in review while another stays a live throw vector. Putting the boundary at the shared invocation point makes "the consumer callback cannot throw out of this watcher" a single-site invariant instead of a per-call-site discipline. Complements `silent-handler-required-on-void-subscriptions` (which requires the *primitive's* `onError` at the type level); this rule is about the *watcher implementation* containing the consumer it fans out to. Codified after a `subscribeGitHubPr` fix guarded `fetchAndEmit` but missed `setGit`'s synchronous `emit({ pending })` ([kolu#1143](https://github.com/juspay/kolu/pull/1143)).

### migration-shape-guard

A `Conf` (or analogous schema) migration that acts on a specific value shape must early-return when the on-disk shape doesn't match its preconditions. Never write transient orphan fields that subsequent migrations are expected to destructure-out.

Bad:
```ts
"1.8.0": (store) => {
  const tab = rp.tab;
  // fires on undefined too — adds a `tab` orphan to the new flat shape
  const stale = tab !== "inspector" && tab !== "review";
  if (stale) store.set(..., { rightPanel: { ...rp, tab: "inspector" } });
}
```

Good:
```ts
"1.8.0": (store) => {
  if (typeof rp.tab !== "string") return;  // skip shapes this migration doesn't recognize
  const stale = rp.tab !== "inspector" && rp.tab !== "review";
  if (stale) store.set(..., { rightPanel: { ...rp, tab: "inspector" } });
}
```

_Rationale_: a migration that writes orphans assuming a downstream migration will clean them up couples migrations to each other — one can't be removed without breaking the next, and a fresh-install ladder accumulates write-then-strip cycles. The shape guard makes each migration idempotent on shapes it doesn't recognize. Caught when 1.13.0 destructured `codeMode` (a real new-schema field) alongside a `tab` orphan that 1.8.0 had spuriously written for fresh installs.

### persisted-schema-stays-tolerant

TIGHTENING the validation of a PERSISTED schema (a `Conf` key / surface cell the client reads back) — adding a `.refine`, a newly-required field, a stricter type, a `.min()` — is a backward-INCOMPATIBLE change to data that may already sit on disk. It needs a backward-compat path, or it silently rejects existing data. The sharp edge: when the cell value is an ARRAY, a per-record invariant the array parse treats as fatal makes ONE bad record fail the WHOLE cell — the client falls back to the default (empty) and the feature breaks for **everything**, not just the corrupt record.

Pick the path by whether the OLD format was ever RELEASED:

- **Released** → a `state.ts` migration that transforms/drops the incompatible data, plus a `SCHEMA_VERSION` bump.
- **Never released (still in-flight on this branch)** → NO migration — there is no production data to migrate; a migration here is dead code that migrates phantom data. Instead read GRACEFULLY: validate SHAPE in the schema, but enforce cross-field INVARIANTS by filtering at the read boundary, never by a fatal array rejection. Tolerance is the durable fix and guards against future corruption too.

Bad:
```ts
// backs a persisted cell `z.array(FooSchema)`
export const FooSchema = z.object({ id, items })
  .refine((r) => r.items.some((i) => i.id === r.id)); // one orphan ⇒ whole array rejected ⇒ cell empties
```

Good:
```ts
export const FooSchema = z.object({ id, items });            // SHAPE only
export const isWellFormedFoo = (r) => r.items.some((i) => i.id === r.id);
export const getFoos = () => store.get("foos").filter(isWellFormedFoo); // drop the bad one, keep the rest
```

_Rationale_: caught when the sleeping-terminals cell shipped a strict `.refine` (a record's root id must match one of its terminals) with no tolerance. A single legacy record (keyed by a UUID from an earlier cut of the same unmerged PR) failed the whole cell's validation, the client received an empty cell, and EVERY sleep silently lost its terminal. Because the format was never released, a migration would only have tidied a dev disk — reading tolerantly is what un-breaks the feature and survives any future corrupt record. The earlier gauntlet's `code-police` pass even ran `migration-shape-guard` and marked it "N/A — no migration added", never asking whether the schema tightening NEEDED a backward-compat path.

### icons-in-registry

All SVG icons must be defined as named exports in `packages/client/src/ui/Icons.tsx`. Never inline SVG markup in component files.
Bad: `<svg viewBox="0 0 16 16" ...><path d="..." /></svg>` inside a component
Good: `export const FooIcon: Component<{ class?: string }> = ...` in Icons.tsx, then `<FooIcon />` at the call site
_Rationale_: Inline SVGs are invisible to search, duplicate across components, and bypass the existing icon registry convention. Centralizing icons in one file makes them discoverable, deduplicated, and consistent in sizing/color defaults.

### new-package-has-readme

Every new workspace package (a new directory under `packages/` with its own `package.json`) must ship a `README.md` in the same change that introduces it. A package without a README is a black box: the next reader can't tell what it owns, why it exists, or where its boundary is, without reverse-engineering the source.

The README mirrors the convention every existing leaf already follows (`kaval`, `@kolu/terminal-protocol`, `@kolu/terminal-workspace`, the integration packages): a one-line **what it is** in bold, **what it owns**, and explicitly **what it knows nothing about** — the boundary that justifies the package existing at all (which app concerns it deliberately excludes, what its lone couplings are, who consumes it).

Bad: `packages/foo/` ships `package.json` + `src/` + `tsconfig.json`, no `README.md`.
Good: `packages/foo/README.md` states the package's purpose and boundary in prose a contributor reads before opening the source.

_Rationale_: a leaf package is a decomposition decision — pulling a concept out of where it was tangled. The README is where that decision is recorded and made greppable; without it the "why is this its own package" rationale lives only in a PR description that nobody re-reads. The boundary section is the load-bearing half: "it knows nothing about X" is what stops the package re-accreting the coupling it was extracted to escape. Codified alongside `@kolu/terminal-workspace` (the P1a extraction).
