---
description: Core workflow conventions — execute pipeline commands, CI, formatting, testing, git, feature discoverability, external libraries
applyTo: "**"
---

## Workflow

- Use `/do` to execute tasks end-to-end: sync → research → hickey → branch+PR → implement → check → docs → police → fmt → commit → test → CI → update-pr → done. Each step has a verification check.
- For standalone quality checks, run `/code-police` (includes rules checklist + fact-check + elegance passes).
- Run `just fmt` (formatting) before declaring done.
- **Quick e2e tests**: Run `just test-quick` (or `just test-quick features/foo.feature:42` for a single scenario) to verify UI changes. Fast — no nix build, no separate dev server.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

## Execute Pipeline Commands

These commands are used by the `/do` workflow's check, fmt, test, and ci steps.

### Check command

`just typecheck` — fast static-correctness gate (`pnpm typecheck` under the hood). Runs across the workspace. CI's `ci/typecheck` step is the same recipe, tagged with a localci `[metadata]` attribute.

### Format command

`just fmt` runs the CI format check (prettier + nixpkgs-fmt); `just fmt-write` formats files in place.

### Test command

Run `just test-quick` with only the `.feature` files relevant to the changed code paths (e.g., `just test-quick features/worktree.feature`). Use `git diff master...HEAD --name-only` to identify changed files and match them to feature files.

If changes are purely server-internal with no UI impact, unit tests may suffice — skip e2e if no relevant scenarios exist.

### CI command

`just ci` is powered by **localci**. See the `ci-workflow` rule (vendored from `ci/localci/.apm/instructions/ci-workflow.instructions.md`) for how to run it, the event schema, Monitor setup, lock semantics, and the summary table.

**Log flaky tests**: If a test fails once but passes on retry, post a comment on [issue #320](https://github.com/juspay/kolu/issues/320) capturing the failing scenario, platform, error excerpt, and the PR where it was observed. This keeps the flaky-test log current without manual curation.

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `tips.ts` and `useTips.ts` for the registry and API.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
