---
description: Kolu-specific code-police rules — subscription, SolidJS, and union-dispatch patterns
applyTo: "**/*.{ts,tsx}"
---

## Additional Code Police Rules

These rules extend the base code-police skill with Kolu-specific patterns. They are checked during Pass 1 (rule checklist) alongside the generic rules.

### subscription-use-pending

Never check `sub() === undefined` as a proxy for loading — use `sub.pending()`.
_Rationale_: Conflates "loading" with "no data" and misses error states.

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

Integration code (under `integrations/`) runs in a long-lived Node process — performance bugs compound over hours. Apply the general `no-unbounded-growth` rule with these kolu-specific reinforcements:

- **`fs.watch` callbacks must debounce.** Claude streams tokens continuously; on Linux `fs.watch` fires multiple events per write. Any handler that does I/O, parsing, or allocation must use a trailing-edge debounce (see `TRANSCRIPT_DEBOUNCE_MS` in `session-watcher.ts`). A bare handler is only acceptable if the work is O(1) and allocation-free.
- **File reads must stream in chunks.** Transcripts grow without bound. Never `Buffer.alloc(fileSize)` or read an entire file into memory when the consumer processes it incrementally — use chunked reads with a remainder carried across calls (see `scanTasksIncremental` pattern).
- **Directory watchers must be shared.** Multiple callers watching the same directory (e.g. `SESSIONS_DIR`) must go through a refcounted singleton, not each install their own `fs.watch`. N watchers = N duplicate callbacks = N-fold cost per event.
- **Debug-only collections must be bounded.** Arrays that accumulate diagnostic state (e.g. `stateChanges`) need a cap with `shift()`-before-`push()` eviction (see `MAX_STATE_CHANGES`).

### no-preference-prop-drilling

Components must read preferences from `useServerState()` directly, not receive them as props from a parent. The singleton store guarantees shared reactivity — all callers share one `createStore` instance.
Bad: `<Child scrollLock={preferences().scrollLock} />` then `props.scrollLock` in child
Good: `const { preferences } = useServerState();` inside the child component
_Rationale_: Prop-drilling preferences creates unenforced coupling ("parent extracts the right field and passes it to the right consumer") and bloats App.tsx's wiring surface. Components that own their behavior should own their preference reads too.

### errors-must-log-at-error

Actual errors (failed I/O, failed queries, unexpected exceptions, callback throws) must log at `error` level, not `warn` or `debug`. Reserve `warn` for degraded-but-recoverable states (e.g. a non-critical fallback path). Reserve `debug` for expected-absent conditions (e.g. file not found on a machine that doesn't have the tool installed).
Bad: `log.warn({ err }, "query failed")` / `log.debug({ err }, "scan failed")`
Good: `log.error({ err }, "query failed")`
_Rationale_: Operators filter on `error` level for alerting. An actual failure logged at `warn` or `debug` is invisible in production. The `Logger` type in `kolu-integration-common` includes all four levels (`debug`, `info`, `warn`, `error`) — use the right one.
