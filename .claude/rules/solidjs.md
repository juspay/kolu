---
paths:
  - "packages/client/src/**"
---

## UI

- Extract reusable UI into SolidJS components (one component per file in `packages/client/src/`).
- Follow the [frontend-design skill](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md) for UI design decisions — bold intentionality over generic aesthetics.

## SolidJS Patterns

- **State per domain**: Extract shared state into `useXxx.ts` modules (singleton pattern — create store once, cache at module level). Keep App.tsx as a thin layout shell.
- **Commands stay declarative**: `commands.ts` registers commands — it should not contain async RPC calls, error handling, or multi-step workflows. Those belong in `useXxx.ts` handlers. Commands just call `deps.handleFoo()`.
- **Components own their behavior**: If a component has a keyboard shortcut or toggle state, it should manage that internally (always mounted if needed), not leak it to the parent.
- **`createStore` over `createSignal<Record>`**: For keyed state (e.g. per-terminal metadata), use `createStore` from `solid-js/store` for fine-grained per-key reactivity.
- **`@solid-primitives`**: Prefer community primitives (`makePersisted`, `createResizeObserver`, `makeEventListener`) over hand-rolled equivalents.
- **Props stay reactive**: Never destructure props. Access via `props.xxx`. Pass accessors when needed.
- **Memos for multi-consumer derivations**: Use `createMemo` when 2+ reactive contexts read the same derived value. Use plain functions for single-consumer or trivial derivations.
- **Surface bound primitives for server streams**: Use `app.cells.X.use(...)`, `app.collections.X.use(...)`, `app.streams.X.use(inputFn)`, and `app.events.X.use(inputFn, handler, { onError })` from `wire.ts`'s `surfaceClient` for streaming server state. The framework owns snapshot+deltas, retry, and reconcile-vs-assign. For a SURFACE-scoped raw streaming RPC that doesn't fit a primitive (a bulk snapshot feed), use `client.rawStream(name, proc, input, { onItem })` — it enrols the stream into `client.health()` structurally (and throws if driven outside a reactive owner), so a raw stream can't silently escape the health fact. For a stream that ALREADY owns its `pending`/`error` (a `createSubscription` over a surface procedure), join it with `client.enroll(name, sub)`. The bare `streamCall` lives at `@kolu/surface/client` (NOT the `@kolu/surface/solid` barrel) and is only for a stream that is NOT a surface subscription — a ROOT RPC outside any surface (the terminal `attach`), where you enrol by hand or deliberately carve it out: `streamCall(client.X.Y, input, { signal, onRetry })`. For one-shot RPC calls, use plain `client.*` calls with `createSignal` or `createResource`.
- **`mapArray` for dynamic per-entity subscriptions**: When the set of subscriptions is driven by a reactive list (e.g., per-terminal metadata), use `mapArray` to create subscriptions. SolidJS handles lifecycle — each item gets its own reactive owner, automatically disposed when removed from the list. (`useCollection` already does this internally; reach for `mapArray` directly only when composing outside the framework.)
- **Plain client calls for mutations**: No mutation wrappers needed. Call `client.terminal.create(...)` directly and handle errors with `.catch((err: Error) => toast.error(...))`. Server pushes update subscriptions automatically.
