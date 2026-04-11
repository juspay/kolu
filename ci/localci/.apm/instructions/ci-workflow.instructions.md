---
description: How to run localci and how agents should tail its structured event stream
applyTo: "**"
---

## Running localci

`just ci` runs all CI steps across all configured nix systems in parallel. It:

- Acquires a process-wide lock (one `localci` run per worktree at a time)
- Runs preflight checks (clean worktree, commit pushed)
- Builds across all target systems (local + remote via ssh + git bundle)
- Posts forge commit statuses per step (if a forge backend is configured)
- Emits a structured NDJSON event stream to `.localci/logs/<short-sha>/events.ndjson`
- Prints a two-column summary table (local vs signoff state) at the end

**Never pipe `just ci` to `tail` or `head`** — broken pipes kill the CI process mid-run.

Individual steps: `just ci::e2e`, `just ci::typecheck`, etc.
Target a specific system: `CI_SYSTEM=x86_64-linux just ci::e2e`
Logs: `.localci/logs/<short-sha>/<step>@<system>.log`

## Runtime state layout

```
.localci/
  current                   # flocked lock file; contents = current-or-last run sha
  logs/<short-sha>/
    events.ndjson           # structured event stream (agents tail this)
    <step>@<system>.log     # raw stdout/stderr per step
```

`.localci/current` is both the single-instance lock (held via perl `Fcntl::flock`) and the observability pointer to the current run. While a run is active, it contains the sha being tested. After the run exits (cleanly or via SIGKILL), the flock releases but the file contents persist as "last run sha."

## Agent Monitor setup

Agents watching a `just ci` run should **tail the structured event stream**, not grep stdout:

```
tail -f .localci/logs/$(cut -c1-7 .localci/current)/events.ndjson
```

Each line is an NDJSON event. Schema:

```json
{"v":1,"ts":"2026-04-11T14:23:01Z","event":"run_start","sha":"abc1234def"}
{"v":1,"ts":"...","event":"step_start","step":"e2e","system":"x86_64-linux","context":"e2e@x86_64-linux"}
{"v":1,"ts":"...","event":"step_end","step":"e2e","system":"x86_64-linux","context":"e2e@x86_64-linux","state":"success","duration_s":152,"log":".localci/logs/abc1234/e2e@x86_64-linux.log"}
{"v":1,"ts":"...","event":"run_end","state":"success"}
```

States: `success`, `failure`, `pending`. On step failure, the `log` field points to the raw output file — open it to diagnose.

**Verification**: all `step_end` events have `state: success` and there's a final `run_end` with `state: success`. After `just ci` exits, cross-check with `just ci::_summary` for a rendered table.

**On failure**: read the `log` path from the failing `step_end` event.

**Retry individual steps**: `just ci::<step>` (e.g., `just ci::e2e`). Single-step retries bypass the lock and are short enough to run via `Bash(run_in_background)`.

## Branch protection

`just ci::protect` (GitHub forge only) sets required status checks on the default branch. Contexts are auto-derived from the justfile — no prior CI run needed.

## Forge configuration

localci is forge-agnostic. The importing justfile selects a backend via `import 'localci/forges/<name>.just'`:

- `forges/github.just` — posts commit statuses via `gh api`
- `forges/none.just` — no-op; summary reads local events only

Bitbucket backend is planned but not yet implemented.
