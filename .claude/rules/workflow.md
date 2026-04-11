---
paths:
  - "**"
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

`just check` — fast static-correctness gate (`pnpm typecheck` under the hood). Runs across the workspace. CI's `ci::typecheck` step uses the same recipe.

### Format command

`just fmt`

### Test command

Run `just test-quick` with only the `.feature` files relevant to the changed code paths (e.g., `just test-quick features/worktree.feature`). Use `git diff master...HEAD --name-only` to identify changed files and match them to feature files.

If changes are purely server-internal with no UI impact, unit tests may suffice — skip e2e if no relevant scenarios exist.

### CI command

`just ci` is powered by **localci** — a reusable, forge-agnostic local CI library that lives at `ci/localci/`. It emits a structured NDJSON event stream that agents should tail instead of grepping stdout. See `ci/localci/.apm/instructions/ci-workflow.instructions.md` for the full event schema and agent workflow.

Run `just ci` in the background, then tail the event stream via Monitor:

```
tail -f .localci/logs/$(cut -c1-7 .localci/current)/events.ndjson
```

Each line is an NDJSON event with `event: step_start | step_end | run_start | run_end`. Step end events include `state`, `duration_s`, and `log` (path to raw output).

**Single-instance lock**: only one `just ci` runs per worktree at a time, enforced via perl `Fcntl::flock` on `.localci/current`. The file contents are the current-or-last sha — agents read it unconditionally.

**Verification**: all `step_end` events have `state: success` and there's a final `run_end` with `state: success`. After `just ci` exits, cross-check with `just ci::_summary` for a rendered two-column table (local state vs forge signoff state).

**On failure** — read the `log` path from the failing `step_end` event.

**Retry individual steps**: `just ci::<step>` (e.g., `just ci::e2e`). Single-step retries bypass the lock and are short enough to run via `Bash(run_in_background)`.

**Log flaky tests**: If a test fails once but passes on retry, post a comment on [issue #320](https://github.com/juspay/kolu/issues/320) capturing the failing scenario, platform, error excerpt, and the PR where it was observed. This keeps the flaky-test log current without manual curation.

## Local CI

`just ci` builds and tests across all systems. It:

- Acquires a single-instance lock (`perl Fcntl::flock` on `.localci/current`)
- Runs preflight checks (clean worktree, commit pushed)
- Builds on x86_64-linux and aarch64-darwin in parallel
- Emits NDJSON events to `.localci/logs/<sha>/events.ndjson`
- Posts GitHub commit statuses per step via the `forges/github.just` backend
- Prints a two-column summary table (local events vs forge signoffs)

**Never pipe CI to `tail` or `head`** — broken pipes kill the CI process mid-run. Tail the events.ndjson file instead (see CI command above).

Individual steps: `just ci::nix`, `just ci::e2e`, etc.
Target a specific system: `CI_SYSTEM=x86_64-linux just ci::e2e`
Step logs: `.localci/logs/<short-sha>/<step>@<system>.log`.

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `tips.ts` and `useTips.ts` for the registry and API.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
