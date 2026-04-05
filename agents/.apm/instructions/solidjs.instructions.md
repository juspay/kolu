---
description: SolidJS patterns and UI component conventions
applyTo: "client/src/**"
---

## UI

- Extract reusable UI into SolidJS components (one component per file in `client/src/`).
- Follow the [frontend-design skill](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md) for UI design decisions — bold intentionality over generic aesthetics.

## SolidJS Patterns

- **State per domain**: Extract shared state into `useXxx.ts` modules (singleton pattern — create store once, cache at module level). Keep App.tsx as a thin layout shell.
- **Commands stay declarative**: `commands.ts` registers commands — it should not contain async RPC calls, error handling, or multi-step workflows. Those belong in `useXxx.ts` handlers. Commands just call `deps.handleFoo()`.
- **Components own their behavior**: If a component has a keyboard shortcut or toggle state, it should manage that internally (always mounted if needed), not leak it to the parent.
- **`createStore` over `createSignal<Record>`**: For keyed state (e.g. per-terminal metadata), use `createStore` from `solid-js/store` for fine-grained per-key reactivity.
- **`@solid-primitives`**: Prefer community primitives (`makePersisted`, `createResizeObserver`, `makeEventListener`) over hand-rolled equivalents.
- **Props stay reactive**: Never destructure props. Access via `props.xxx`. Pass accessors when needed.
- **Memos for multi-consumer derivations**: Use `createMemo` when 2+ reactive contexts read the same derived value. Use plain functions for single-consumer or trivial derivations.
- **Use `createSubscription` for server streams**: Use `createSubscription` from `solid-live/solid` for all streaming server state (terminal list, metadata, server state). For one-shot data, use SolidJS's `createResource`. For mutations, use plain `client.*` calls. No TanStack Query.
