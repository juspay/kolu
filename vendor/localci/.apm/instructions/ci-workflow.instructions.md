---
description: How to run localci and how agents should tail its structured event stream
applyTo: "**"
---

## Running localci

This project uses **localci** for local CI orchestration. The entry point is
whatever `just` recipe the host project wires to localci's `_localci`
library recipe (typically `just ci`). It:

- Acquires a process-wide lock (one `localci` run per worktree at a time)
- Runs preflight checks (clean worktree, commit pushed)
- Builds across all target systems (local + remote via ssh + git bundle)
- Posts forge commit statuses per step (if a forge backend is configured)
- Emits a structured NDJSON event stream to `.localci/logs/<short-sha>/events.ndjson`
- Prints a two-column summary table (local vs signoff state) at the end

**Never pipe the CI invocation to `tail` or `head`** — broken pipes kill the
CI process mid-run. Tail the events.ndjson file instead.

Individual steps can be retried by name via the host project's step recipes
(consult the project's own justfile for step names). Setting `CI_SYSTEM=<name>`
targets a specific nix system for a single-step retry.

Step logs: `.localci/logs/<short-sha>/<step>@<system>.log`

## Runtime state layout

```
.localci/
  current                   # flocked lock file; contents = current-or-last run sha
  logs/<short-sha>/
    events.ndjson           # structured event stream (agents tail this)
    <step>@<system>.log     # raw stdout/stderr per step
```

`.localci/current` is both the single-instance lock (held via perl
`Fcntl::flock`) and the observability pointer to the current run. While a
run is active, it contains the sha being tested. After the run exits
(cleanly or via SIGKILL), the flock releases but the file contents persist
as "last run sha."

## Agent Monitor setup

Agents watching a running CI invocation should **tail the structured event
stream**, not grep stdout:

```
tail -f .localci/logs/$(cut -c1-7 .localci/current)/events.ndjson
```

Each line is an NDJSON event. Schema:

```json
{"v":1,"ts":"2026-04-11T14:23:01Z","event":"run_start","sha":"abc1234def"}
{"v":1,"ts":"...","event":"step_start","step":"<name>","system":"<nix-system>","context":"<name>@<nix-system>"}
{"v":1,"ts":"...","event":"step_end","step":"<name>","system":"<nix-system>","context":"<name>@<nix-system>","state":"success","duration_s":152,"log":".localci/logs/<short-sha>/<name>@<nix-system>.log"}
{"v":1,"ts":"...","event":"run_end","state":"success"}
```

`local`-lane steps omit the `@<nix-system>` suffix in their context name
(the context is just `<name>`).

States: `success`, `failure`, `pending`. On step failure, the `log` field
points to the raw output file — open it to diagnose.

**Verification**: all `step_end` events have `state: success` and there's a
final `run_end` with `state: success`. The host project's `_summary` recipe
renders a two-column table (local vs signoff) for a quick human view.

**On failure**: read the `log` path from the failing `step_end` event.

**Retry individual steps**: invoke the step recipe directly (bypassing the
lock). Consult the host project's justfile for recipe names. Single-step
retries are short enough to run via `Bash(run_in_background)`.

## Branch protection

`_contexts` (library recipe) lists every `<step>` or `<step>@<system>` pair
derived from the DAG. The GitHub forge backend exposes a `protect` recipe
that reads `_contexts` and sets required status checks on the default
branch. Consult the host project's justfile for how it's wired — it's
typically forwarded as `protect` at the top level or `<module>::protect`
when localci is mounted as a submodule.

## Forge configuration

localci is forge-agnostic. The host project selects a backend by importing
one of the forge files alongside `lib.just`:

- `forges/github.just` — posts commit statuses via `gh api`
- `forges/none.just` — no-op; summary reads local events only

Bitbucket backend is planned but not yet implemented.
