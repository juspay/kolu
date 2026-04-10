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

`just check` — fast static-correctness gate (`pnpm typecheck` under the hood). Runs across the workspace. CI's `ci::typecheck` step uses the same recipe.

### Format command

`just fmt`

### Test command

Run `just test-quick` with only the `.feature` files relevant to the changed code paths (e.g., `just test-quick features/worktree.feature`). Use `git diff master...HEAD --name-only` to identify changed files and match them to feature files.

If changes are purely server-internal with no UI impact, unit tests may suffice — skip e2e if no relevant scenarios exist.

### CI command

Run `just ci` via the **Monitor** tool with this filter so each finishing CI step becomes one event:

```
just ci 2>&1 | grep --line-buffered -oE 'context="ci/[^"]+" -f description="[^"]+"'
```

Each event corresponds to one GitHub status post by `just ci`. The `description` field encodes the step state:

- `srid · running` → step started
- `srid · Ns · <log path>` → step finished successfully
- `srid · failed after Ns · <log path>` → step failed

`just ci` is bound to the Monitor's lifetime — **stopping the monitor kills `just ci` mid-run**. Let it run to completion.

> **Brittleness:** the regex depends on `just ci` literally invoking `gh api ... context="ci/X" -f description="..."` on stdout. If that internal format ever changes, Monitor will silently emit zero events. The cleaner long-term fix is a `just ci::events` wrapper recipe that owns the event format. If you refactor the just recipe's status posting, update this filter too.

**Verification**: All step events arrive with success states (no `failed after`). After `just ci` exits, you can also cross-check via:

```
gh api "repos/<owner>/<repo>/statuses/<sha>" --jq '[.[] | select(.context | startswith("ci/"))] | group_by(.context) | map(max_by(.updated_at)) | .[] | "\(.context): \(.state)"'
```

**On failure** — read the log file (path is in the event's description) to diagnose.

**Retry individual steps**: `just ci::<step>` (e.g., `just ci::e2e`). Single-step retries are short enough to run via `Bash(run_in_background)` — Monitor only pays off for full `just ci` runs.

**Log flaky tests**: If a test fails once but passes on retry, post a comment on [issue #320](https://github.com/juspay/kolu/issues/320) capturing the failing scenario, platform, error excerpt, and the PR where it was observed. This keeps the flaky-test log current without manual curation.

## Local CI

`just ci` builds and tests across all systems. It:

- Runs preflight checks (clean worktree, commit pushed)
- Builds on x86_64-linux and aarch64-darwin in parallel
- Posts GitHub commit statuses per step
- Prints a summary table at the end

Run it via **Monitor** (see CI command above) for live step-by-step visibility. **Never pipe CI to `tail` or `head`** — broken pipes kill the CI process mid-run.

Individual steps: `just ci::nix-toplevel`, `just ci::e2e`, etc.
Target a specific system: `CI_SYSTEM=x86_64-linux just ci::e2e`
Logs are saved to `.logs/<short-sha>/<step>@<system>.log`.

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `tips.ts` and `useTips.ts` for the registry and API.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
