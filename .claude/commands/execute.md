---
argument-hint: <github-issue-url | prompt> [--review] [--from <step>]
description: Execute a task end-to-end — implement, PR, CI loop, ship
---

# Execute Workflow

Take a task and execute it top-to-bottom: research, implement, open a draft PR, pass CI, refine, and ship.

**Fully autonomous.** Do NOT use `AskUserQuestion` at any point (unless `--review` is active during the planning pause). Make sensible default choices and keep moving.

## Arguments

Parse the arguments string: `[--review] [--from <step-id>] <task description or github-issue-url>`

- `--review`: Pause after **hickey** for user plan approval via `EnterPlanMode`/`ExitPlanMode`, then continue autonomously
- `--from <step-id>`: Start from a specific step (see entry points below)

## Results Tracking

After each step's verification, write/update `.execute-results.json`:

```json
{
  "workflow": "execute",
  "startedAt": "<ISO timestamp>",
  "active": true,
  "status": "running",
  "steps": [
    {
      "name": "sync",
      "status": "passed",
      "verification": "...",
      "completedAt": "..."
    }
  ]
}
```

- Set `active` to `true` when the workflow starts (**sync**), and `false` when it ends (**done**). The stop hook uses this field to block premature exits.
- Set `status` to `"completed"` when **done** is reached, or `"failed"` if halted. This field is informational only.
- Use the Write tool to update the file after each step.

## Steps

Print a progress line before each step:

```
[execute] ✓sync ✓research ▸hickey · branch · implement · docs · police · fmt · commit · test · ci · update-pr · done
```

### sync

Run: `git fetch origin && git remote set-head origin --auto`

If current branch is behind origin, fast-forward with `git pull --ff-only`.

**Verify**: git fetch ran without error.

---

### research

Research the task thoroughly before writing code.

- If given a GitHub issue URL, fetch with `gh issue view`
- Use Explore subagents, Grep, Glob, Read — whatever it takes to understand the problem
- **Never assume** how something works. Read the code. Check the config.
- If the prompt involves external tools/libraries, use WebSearch/WebFetch

**Verify**: Can articulate what needs to change, where, and why.

---

### hickey

Evaluate the planned approach for structural simplicity. Invoke the `hickey` skill via the Skill tool.

- Identify concerns. Check for complecting. Suggest simplifications.
- Revise the approach to eliminate accidental complexity before proceeding.

**If `--review`**: After hickey completes, use `EnterPlanMode` to present the revised approach for user approval:

- **Clarify ambiguities** first — ask via `AskUserQuestion` if anything is unclear. Don't guess.
- **High-level plan**: what to do and why, not implementation details. Include an **Architecture section** (affected modules, new abstractions, ripple effects).
- **Split non-trivial plans into phases** — MVP first, each phase functionally self-sufficient.
- Include a **Simplicity assessment** noting what hickey found and any trade-offs accepted.

Use `ExitPlanMode` to present the plan. Once approved, continue autonomously from **branch**.

**Verify**: Complecting concerns addressed or justified.

---

### branch

Detect the default branch: `git symbolic-ref refs/remotes/origin/HEAD`

1. Create a descriptive feature branch from `origin/<default>`
2. Create an empty commit: `git commit --allow-empty -m "chore: open PR"`
3. Push the branch
4. Open a draft PR: `gh pr create --draft`

**MANDATORY**: Load the `github-pr` skill (via Skill tool) BEFORE writing the PR title/body.

**Verify**: On a feature branch (not master/main), draft PR exists (`gh pr view` succeeds).

---

### implement

If the task is a bug fix: write a failing test first (e2e or unit, whichever is appropriate), then fix the bug.

Otherwise: implement the planned changes. Prefer simplicity. Do the boring obvious thing.

**Verify**: Code changes match the planned approach.

---

### docs

Check if README.md and CLAUDE.md are still accurate. Compare against files changed in this PR.

**Verify**: Docs match current code.
**If outdated** (max 3 attempts): Fix the outdated sections and re-verify.

---

### police

Invoke the `/code-police` skill via the Skill tool. It runs three passes: rule checklist, fact-check, and elegance.

When `/code-police` asks about scope: **changes in the current branch/PR only**.

**Verify**: All 3 passes clean ("All clear").
**If violations found** (max 3 attempts): Fix the violations and re-invoke `/code-police`.

---

### fmt

Run: `just fmt`

**Verify**: `just fmt` ran without error.

---

### commit

Create a NEW commit (never amend) with a conventional commit message. Push to the PR branch.

**Verify**: `git log -1` shows a new commit on the feature branch, and it's pushed to remote.

---

### test

Run only the e2e tests relevant to the code paths changed in this PR.

Use `git diff master...HEAD --name-only` to identify changed files, then run `just test-quick` with only the matching `.feature` files (e.g., `just test-quick features/worktree.feature`).

If changes are purely server-internal with no UI impact, unit tests may suffice — skip e2e if no relevant scenarios exist.

**Verify**: Tests pass (exit code 0), or no relevant tests to run.
**If failed** (max 4 attempts): Analyze the failure. If flaky, re-run. If real: fix → go to **fmt**, then retry.

---

### ci

Run: `just ci` (with `run_in_background: true` — CI takes several minutes).

**Never pipe CI to `tail`/`head`**, and **never append `2>&1`** — background mode captures both streams.

**Verify**: Check GitHub commit statuses for **every** context from `just ci::_contexts`. Each must have a `ci/<context>` status of `success`:

```
gh api "repos/<owner>/<repo>/statuses/<sha>" --jq '[.[] | select(.context | startswith("ci/"))] | group_by(.context) | map(max_by(.updated_at)) | .[] | "\(.context): \(.state)"'
```

**On failure** — read the log file (path is in the commit status description) to diagnose.

**Flaky vs real**: A test is flaky only if it **passes on a subsequent retry**. Consistent failure = real bug. Before retrying, read the failing test code to judge if the failure pattern is inherently flaky (race conditions, timing, async waits).

**If flaky** (max 3 retries): Retry just the failing step with `just ci::<step>`.
**If real bug** (max 5 fixes): Fix → **fmt** → **commit** → retry `just ci`.
**If retries exhausted**: Set workflow status to `"failed"`, skip to **done**.

---

### update-pr

Re-check the PR title/body against current scope. If scope changed, update via `gh pr edit` per the `github-pr` skill.

**Verify**: PR title/body matches the delivered scope.

---

### done

Present a summary of all steps with their verification status. If any step has a non-success status, retry it (max 3 attempts from done). If still failing after retries, set `status: "failed"`.

`"completed"` requires **all steps passed**. No redefining "passed," no footnote caveats. Update `.execute-results.json` accordingly.

Report the PR URL. Then post the final step status table as a **PR comment** using `gh pr comment` with a markdown table of all steps and their status/verification. Format:

```
gh pr comment --body "$(cat <<'COMMENT'
## Execute Results

| Step | Status | Verification |
|------|--------|-------------|
| sync | ✓ | ... |
| research | ✓ | ... |
...

Workflow completed at <timestamp>.
COMMENT
)"
```

---

## Entry Points

| ID               | Starts at     | Use case                                |
| ---------------- | ------------- | --------------------------------------- |
| `default`        | **sync**      | Full workflow from scratch              |
| `followup`       | **implement** | Additional changes on existing PR       |
| `post-implement` | **fmt**       | Skip research/impl, start at formatting |
| `polish`         | **police**    | Just the quality gate                   |
| `ci-only`        | **ci**        | Just run CI                             |

## Rules

- **Never skip steps.** Execute them in order from entry point to **done**.
- **Every commit is NEW.** Never amend, rebase, or force-push.
- **Feature branches only.** Never commit to master/main.
- **Background for CI.** Run CI with `run_in_background: true`.
- **No questions.** Don't use `AskUserQuestion` unless `--review` is active during the hickey pause.
- **Never stop between steps.** After completing a step, immediately proceed to the next one.
- **Complete the full workflow.** Implementing code is one step of many. The task is not done until a PR URL is reported.
- **Exhausted retries = halt.** If `ci` or `test` retries are exhausted, set status to `"failed"` and skip to **done**. Do not proceed to `update-pr` as if nothing happened.

ARGUMENTS: $ARGUMENTS