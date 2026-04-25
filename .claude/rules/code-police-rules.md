---
paths:
  - "packages/**/*.{ts,tsx}"
---

## Additional Code Police Rules

These rules extend the base code-police skill with Kolu-specific patterns. They are checked during Pass 1 (rule checklist) alongside the generic rules.

### subscription-use-pending

Never check `sub() === undefined` as a proxy for loading — use `sub.pending()`.
_Rationale_: Conflates "loading" with "no data" and misses error states.

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

### catch-must-surface-error

When catching an error to show a toast, always include `err.message` in the toast text.
Bad: `.catch(() => toast.error("Failed to set theme"))`
Good: `.catch((err: Error) => toast.error(\`Failed to set theme: ${err.message}\`))`
_Rationale_: Generic error toasts hide the server's actual error message, making debugging impossible. The server returns specific error details via oRPC — surface them.

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

### no-preference-prop-drilling

Components must read preferences from `usePreferences()` directly, not receive them as props from a parent. The singleton subscription guarantees shared reactivity — all callers read through one `createSubscription` instance. The same applies to the activity feed (`useActivityFeed()`) and saved session (`useSavedSession()`) — each domain has its own dedicated singleton hook.
Bad: `<Child scrollLock={preferences().scrollLock} />` then `props.scrollLock` in child
Good: `const { preferences } = usePreferences();` inside the child component
_Rationale_: Prop-drilling preferences creates unenforced coupling ("parent extracts the right field and passes it to the right consumer") and bloats App.tsx's wiring surface. Components that own their behavior should own their preference reads too.

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

### icons-in-registry

All SVG icons must be defined as named exports in `packages/client/src/ui/Icons.tsx`. Never inline SVG markup in component files.
Bad: `<svg viewBox="0 0 16 16" ...><path d="..." /></svg>` inside a component
Good: `export const FooIcon: Component<{ class?: string }> = ...` in Icons.tsx, then `<FooIcon />` at the call site
_Rationale_: Inline SVGs are invisible to search, duplicate across components, and bypass the existing icon registry convention. Centralizing icons in one file makes them discoverable, deduplicated, and consistent in sizing/color defaults.
