# Agents

## Code Quality

- After making changes, automatically run `/code-review` before declaring work complete.
- Run `just pc` (pre-commit hooks) before declaring done.
- **Quick e2e tests**: Run `just test-quick` (or `just test-quick features/foo.feature:42` for a single scenario) to verify UI changes. Fast — no nix build, no separate dev server.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

## Local CI

Run `just ci` to build and test across all systems. It:

- Runs preflight checks (clean worktree, commit pushed)
- Builds on x86_64-linux and aarch64-darwin in parallel
- Posts GitHub commit statuses per step
- Prints a summary table at the end

**Always run CI in background** (`run_in_background`). Builds take several minutes.

Individual steps: `just ci::nix-toplevel`, `just ci::e2e`, etc.
Target a specific system: `CI_SYSTEM=x86_64-linux just ci::e2e`
Logs are saved to `.logs/<short-sha>/<step>@<system>.log`.

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

## Nix

- **DO NOT add flake inputs** to `flake.nix`. Each input adds ~1.5s to `nix develop` cold start. The flake intentionally has zero inputs — nixpkgs and other sources are managed by [npins](https://github.com/andir/npins) and imported via `fetchTarball`. Use `npins add`/`npins update` for new or updated sources.
- **Shared env vars** live in `koluEnv` (defined in `default.nix`). Both the build and the devShell consume it — don't duplicate env var definitions.
- **Measure `nix develop` time** after Nix changes: `time nix develop -c echo test`. Current target: ~2.6s cold, ~0.3s warm.

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `tips.ts` and `useTips.ts` for the registry and API.

## E2E Tests

- **Use semantic selectors**: Never match on CSS classes (`class*="bg-..."`) in test selectors — classes are styling concerns and break when visual design changes. Use `data-testid`, `data-active`, or other semantic `data-*` attributes instead.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
