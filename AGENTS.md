# Agents

## Code Review

- After making changes, automatically run `/code-review` before declaring work complete.

## Testing

- Use `just test-dev` to run e2e tests against a running dev server (`just dev`). Faster than `just test` which does a full `nix build`.

## UI

- Extract reusable UI into Leptos components (one component per file in `client/src/`).

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
