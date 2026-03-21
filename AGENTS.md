# Agents

## Code Quality

- After making changes, automatically run `/code-review` before declaring work complete.
- Run `just pc` (pre-commit hooks) before declaring done.

## Testing

- Use `just test-dev` to run e2e tests against a running dev server (`just dev`). Faster than `just test` which does a full `nix build`.

## UI

- Extract reusable UI into SolidJS components (one component per file in `client/src/`).

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
