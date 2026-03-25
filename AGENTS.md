# Agents

## Code Quality

- After making changes, automatically run `/code-review` before declaring work complete.
- Run `just pc` (pre-commit hooks) before declaring done.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

 # Dev workflow

Use the localci MCP tools — never run build/test commands directly.

1. Make changes, commit
2. Start CI by calling each step tool in parallel (list available tools to see them)
3. Poll `mcp__localci__status-all` to check progress until all complete
4. If failures: fix, commit, re-start failed steps
5. Once green and pushed: steps auto-post GitHub statuses

## UI

- Extract reusable UI into SolidJS components (one component per file in `client/src/`).
- Follow the [frontend-design skill](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md) for UI design decisions — bold intentionality over generic aesthetics.

## SolidJS Patterns

- **State per domain**: Extract shared state into `useXxx.ts` modules (singleton pattern — create store once, cache at module level). Keep App.tsx as a thin layout shell.
- **Components own their behavior**: If a component has a keyboard shortcut or toggle state, it should manage that internally (always mounted if needed), not leak it to the parent.
- **`createStore` over `createSignal<Record>`**: For keyed state (e.g. per-terminal metadata), use `createStore` from `solid-js/store` for fine-grained per-key reactivity.
- **`@solid-primitives`**: Prefer community primitives (`makePersisted`, `createResizeObserver`, `makeEventListener`) over hand-rolled equivalents.
- **Props stay reactive**: Never destructure props. Access via `props.xxx`. Pass accessors when needed.
- **Memos for multi-consumer derivations**: Use `createMemo` when 2+ reactive contexts read the same derived value. Use plain functions for single-consumer or trivial derivations.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
