# Workflow bookkeeping — `do-results` and the task list

Reference for the two bookkeeping surfaces every step touches. Read once at
**sync**; after that the steps only need "bookend with `step-start` /
`step-end`, and flip the task state alongside it".

## Results Tracking

Every step is bookended by two `scripts/do-results` calls: `step-start <name>` before the work begins, and `step-end <status> <verification> [reason]` after verification. This is what keeps per-step timing accurate — collapsing both into a single end-of-step call produces zero-second durations and worthless timing tables. The script tracks workflow state and emits the final timing table during **done**.

**Trust the script's stdout.** Every mutation echoes a one-line confirmation. Treat that line as your confirmation that the write succeeded; the script is the only public surface, and whatever it persists internally is private.

**Lifecycle the script tracks intrinsically**:

- Step `status` — `passed`, `failed`, or `skipped`. A `skipped` step must include a `reason` (e.g. `"non-github forge: bitbucket"`, `"--no-git"`, `"--minimal"`, `"no check command configured"`).
- `active` — state enum (not a boolean). Set to `working` when the workflow starts (**sync**), `waiting` when the agent is idle waiting for an external process (e.g. background CI), back to `working` when that process returns, and `false` when **done** is reached. The stop hook uses this: `working` blocks exits; `waiting` and `false` allow them.
- Workflow `status` — `completed` when **done** finishes, `failed` if halted. Informational.

**Workflow fields /do also stashes via `set`** (the script doesn't interpret these — it just remembers them):

- `forge` — `github`, `bitbucket`, or `unknown`. Populated by `scripts/steps/sync` after forge detection.
- `noGit` — `true` or `false`. Reflects the `--no-git` flag. Git-mutating steps (**branch**, **commit**, **create-pr**) skip with `reason="--no-git"` when set.

**Commands** (invoke with the full path, e.g. `.../skills/do/scripts/do-results ...`):

- `init` — initialize the workflow's lifecycle skeleton. Echoes `init: startedAt=<ts>`.
- `step-start <name>` — call before step work. Echoes `pending: <name>`.
- `step-end <status> "<verification>" ["<reason>"]` — call after verification. Echoes `recorded: <name> <status> (steps=<count>, pending=<none|name>)`.
- `step <name> <status> "<verification>" <startedAt> <completedAt> ["<reason>"]` — single-call form used by `scripts/steps/sync` where `startedAt` was captured in shell. Echoes `recorded: <name> <status> (steps=<count>)`. Agent code should prefer `step-start` / `step-end`.
- `set <field> <value>` — set an arbitrary top-level field. Used both for lifecycle (`set active waiting`, `set status completed`) and for /do-specific values that sync stashes (`set forge github`, `set noGit false`). Echoes `set: <field>=<value>`.

**Discipline**:

- Bookend every step with `step-start` at the top and `step-end` at the bottom. Calling `step-end` without a prior `step-start` is an error; calling `step` with `now` for both timestamps collapses duration to 0 — neither pattern is allowed. Exceptions: `sync` is recorded by `scripts/steps/sync` itself, and skipped steps (duration always 0) may use back-to-back `step-start` / `step-end skipped`.
- Don't run `date` yourself or guess timestamps — `do-results` resolves UTC internally.

## Progress tracking

Drive Claude Code's native todo UI via the `TaskCreate` tool so the user sees a live checklist of the workflow. At the start of **sync** (or the chosen `--from` entry point), seed a task list with the step names in order:

```
sync, research, branch, implement, check, docs, fmt, commit, hickey+lowy, police, test, create-pr, ci, evidence, done
```

**Emit all `TaskCreate` calls as parallel `tool_use` blocks in a single assistant turn** — one model round-trip, not one per task. The seeded steps have no `addBlocks` / `addBlockedBy` dependencies, so there is nothing to serialize on. Sequential seeding (15 round-trips before any real work) is a regression: it adds latency to every `/do` invocation and clutters the transcript with 15 wrapper turns of "Task #N created successfully" before `sync` even starts.

**Under `--minimal`, omit the four steps the flag skips** (`docs`, `hickey+lowy`, `police`, `evidence`) from the seeded list — the user explicitly opted out of them, so they shouldn't clutter the human-facing checklist. The seeded list becomes 11 items in `--minimal` runs. (Run-inherent skips like `--no-git` and forge skips stay in the list — see the Skipped steps rule below.)

The `scripts/do-results` lifecycle still records `--minimal`-skipped steps with `status="skipped"` and `reason="--minimal"` via back-to-back `step-start` / `step-end` calls — that's what keeps the final timing table and `completed`-status logic correct. The task UI is independent of that recording.

At each step boundary, update task state **alongside** the `scripts/do-results` script call — they are not redundant. The script's state drives the stop hook; the task list is the human-facing UI. Miss either and the workflow is inconsistent.

Rules:

- **Flip to `in_progress` when a step starts, `completed` when it verifies.** One step `in_progress` at a time.
- **Retries stay `in_progress`.** If `check`, `test`, or `ci` loop through their retry budget, do **not** bounce the task state back to `pending` or flicker it — leave it `in_progress` until the step finally verifies (or the retries exhaust and the workflow fails).
- **`--from <step>` entry points**: still seed the full list (minus any `--minimal` omissions). Mark steps earlier than the entry point as `completed` immediately after seeding, so the checklist shows a consistent view regardless of entry point.
- **Skipped steps that stay in the list** (e.g. `branch`/`commit`/`create-pr` under `--no-git`, or PR steps on non-GitHub forges) go straight to `completed`. Record the skip with a back-to-back `scripts/do-results step-start <name>` / `scripts/do-results step-end skipped ... "<reason>"`; the task list just shows the step as done. `--minimal` skips are **not** in this category — they're omitted from the seeded list entirely (see above), so there's no task entry to flip.
- **Failure**: if retries exhaust and the workflow halts, leave the failing step `in_progress`, mark `done` `completed` after the failure summary is written, and run `scripts/do-results set status failed`.

