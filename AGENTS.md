# Agents

## Code Quality

- **Rapid feedback**: At the start of any code-editing task, run `just watch` in the background (Bash with `run_in_background: true`). This launches `cargo watch` which automatically re-runs `cargo clippy --workspace --all-targets` whenever `.rs` files change. Periodically check the background task output (via `TaskOutput`) to catch compilation errors and clippy warnings early, rather than discovering them at the end.
- After making changes, automatically run `/code-review` before declaring work complete.
- Run `just pc` (pre-commit hooks) before declaring done.

## Testing

- Use `just test-dev` to run e2e tests against a running dev server (`just dev`). Faster than `just test` which does a full `nix build`.

## UI

- Extract reusable UI into Leptos components (one component per file in `client/src/`).

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
