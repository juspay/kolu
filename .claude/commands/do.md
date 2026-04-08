---
argument-hint: <issue-url | prompt> [--review] [--no-git] [--from <step>]
description: Do a task end-to-end — implement, PR, CI loop, ship
---

# Do Workflow

Take a task and do it top-to-bottom: research, implement, open a draft PR, pass CI, refine, and ship. (Under `--no-git`, extend the working tree in place — no branch, commit, or PR.)

**Fully autonomous.** Do NOT use `AskUserQuestion` at any point (unless `--review` is active during the planning pause). Make sensible default choices and keep moving.

## Arguments

Parse the arguments string: `[--review] [--no-git] [--from <step-id>] <task description or issue-url>`

The workflow is **forge-aware**: it auto-detects whether the repo lives on GitHub or elsewhere during the **sync** step (see Forge Detection). Only GitHub has an active code path today — Bitbucket/other forges gracefully skip PR-related steps. Tracking: [srid/agency#10](https://github.com/srid/agency/issues/10).

- `--review`: Pause after **hickey** for user plan approval via `EnterPlanMode`/`ExitPlanMode`, then continue autonomously
- `--no-git`: Extend the working tree **in place** — do not create a branch, commit, push, or touch any PR. Research, implement, check, docs, police, fmt, and test all run; git-mutating steps (**branch**, **commit**, **update-pr**) are skipped. Use this when you have uncommitted local work and want the agent to build on it without taking over git state. Feedback from a Bitbucket user in [#26](https://github.com/srid/agency/issues/26).
- `--from <step-id>`: Start from a specific step (see entry points below)

## Results Tracking

After each step's verification, write/update `.do-results.json`:

```json
{
  "workflow": "do",
  "startedAt": "<ISO timestamp>",
  "active": true,
  "status": "running",
  "forge": "github",
  "noGit": false,
  "steps": [
    {
      "name": "sync",
      "status": "passed",
      "verification": "...",
      "startedAt": "...",
      "completedAt": "..."
    }
  ]
}
```

- `forge` is set during **sync** (see Forge Detection below). One of `github`, `bitbucket`, `unknown`.
- `noGit` is `true` if the user passed `--no-git`. When set, git-mutating steps (**branch**, **commit**, **update-pr**) record status `skipped` with reason `"--no-git"`.
- Step `status` is one of `passed`, `failed`, or `skipped`. A `skipped` step must include a `reason` field explaining why (e.g., `"non-github forge: bitbucket"`, `"--no-git"`, `"no check command configured"`).

- Set `active` to `true` when the workflow starts (**sync**), and `false` when it ends (**done**). The stop hook uses this field to block premature exits.
- Set `status` to `"completed"` when **done** is reached, or `"failed"` if halted. This field is informational only.
- Use the Write tool to update the file after each step.
- Capture timestamps via Bash: `date -u +%Y-%m-%dT%H:%M:%SZ`. Do not guess or hallucinate timestamps.

## Steps

Print a progress line before each step:

```
[do] ✓sync ✓research ▸hickey · branch · implement · check · docs · police · fmt · commit · test · ci · update-pr · done
```

### sync

Run: `git fetch origin && git remote set-head origin --auto`

**If `--no-git` is NOT set**: if current branch is behind origin, fast-forward with `git pull --ff-only`.

**If `--no-git` is set**: do **not** pull. Fetching the remote is harmless and useful context, but modifying the working tree could conflict with the user's uncommitted work. Leave the branch where it is.

**Dirty-tree hint**: run `git status --porcelain`. If it is non-empty and `--no-git` was NOT passed, print a one-line hint to the terminal:

> _Dirty tree detected. Continuing will create a fresh branch on top of these changes. If you wanted the agent to extend your WIP in place without touching git, re-run with `--no-git`._

Do **not** pause or ask — just print and continue. The user's default-mode invocation is respected.

**Forge detection**: Inspect `git remote get-url origin` and classify:

- URL contains `github.com` → `github`
- URL contains `bitbucket.` (covers `bitbucket.org` and self-hosted Bitbucket Server, e.g. `bitbucket.juspay.net`) → `bitbucket`
- Otherwise → `unknown`

Record the result in `.do-results.json` as the top-level `forge` field. Subsequent steps branch on this value. **Only `github` has an active code path today.** Both `bitbucket` and `unknown` cause forge-dependent steps (PR creation, PR comments, PR edits, CI status) to skip gracefully. Bitbucket support is planned — see [srid/agency#10](https://github.com/srid/agency/issues/10).

**Verify**: git fetch ran without error, `forge` is recorded, and `noGit` is recorded.

---

### research

Research the task thoroughly before writing code.

- If given a GitHub issue URL **and** `forge == github`, fetch with `gh issue view`. On non-GitHub forges, treat any issue-like URL as opaque context — use the prompt text as-is and do not attempt to fetch. (Bitbucket issue/Jira fetching is tracked in #10.)
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

**If `--no-git`**: Skip this step entirely with status `skipped` and reason `"--no-git"`. Stay on the current branch — do not create, commit, or push anything. Move to **implement**.

Detect the default branch: `git symbolic-ref refs/remotes/origin/HEAD`

1. Create a descriptive feature branch from `origin/<default>`
2. Create an empty commit: `git commit --allow-empty -m "chore: open PR"`
3. Push the branch with `git push -u origin <branch>`

**If `forge != github`**: Stop here. Record this step as `passed` with verification noting that the branch was created and pushed but PR creation was skipped due to the non-GitHub forge. Do **not** attempt PR creation or hickey PR comments. Move to **implement**. (Bitbucket PR creation via `bkt pr create` is tracked in #10.)

**If `forge == github`**:

4. Open a draft PR: `gh pr create --draft`

**MANDATORY**: Load the `forge-pr` skill (via Skill tool) BEFORE writing the PR title/body.

5. **Post hickey results**: If the hickey step produced findings with suggestions, post the full hickey analysis as a PR comment using `gh pr comment`. Use a `## Hickey Analysis` header. Skip this if hickey found no issues.

**Verify**: On a feature branch (not master/main). If `forge == github`: draft PR exists (`gh pr view` succeeds), and if hickey had findings, a PR comment exists. If `forge != github`: branch was pushed to origin.

---

### implement

If the task is a bug fix: write a failing test first (e2e or unit, whichever is appropriate), then fix the bug.

Otherwise: implement the planned changes. Prefer simplicity. Do the boring obvious thing.

**E2E coverage**: When the change introduces multiple user-facing paths (e.g., a dialog that appears under different conditions), write e2e scenarios for **each distinct path**. Enumerate the user-visible paths, then check that every one has a corresponding test.

**Verify**: Code changes match the planned approach. All distinct user-facing paths have test coverage.

---

### check

Read the project's instructions to find the check command — a fast static-correctness gate (e.g. `tsc --noEmit`, `cargo check`, `cabal build`, `mypy`, `dune build @check`). Run it.

This is the cheapest gate in the pipeline, so it runs first — fail fast on broken code before any downstream step does work over it. If no check command is documented, skip this step with a note.

**Verify**: Check ran without errors, or no command configured.
**If failed** (max 3 attempts): Fix the errors and re-run check. Do not fall back to **implement** — the agent is already in fix mode and the failure is local to just-written code.

---

### docs

Read the project's instructions to find which documentation files to keep in sync (e.g., README.md). Compare those files against changes in this PR.

If no documentation files are documented, skip this step with a note.

**Verify**: Docs match current code.
**If outdated** (max 3 attempts): Fix the outdated sections and re-verify.

---

### police

Use `git diff <default-branch>...HEAD --name-only` to check if the PR contains code changes. If all changed files are documentation-only (e.g., `.md`, `.txt`, `README`, docs/) — skip this step with a note.

Otherwise, invoke the `/code-police` skill via the Skill tool. It runs three passes: rule checklist, fact-check, and elegance.

When `/code-police` asks about scope: **changes in the current branch/PR only**.

**Verify**: All 3 passes clean ("All clear").
**If violations found** (max 3 attempts): Fix the violations and re-invoke `/code-police`.

---

### fmt

Read the project's instructions to find the format command (typically documented in a workflow instruction). Run it.

If no format command is documented, skip this step with a note.

**Verify**: Format command ran without error, or no command configured.

---

### commit

**If `--no-git`**: Skip with status `skipped` and reason `"--no-git"`. Move to **test**. The working-tree changes stay uncommitted — that is the point.

Create a NEW commit (never amend) with a conventional commit message. Push to the PR branch.

**Verify**: `git log -1` shows a new commit on the feature branch, and it's pushed to remote.

---

### test

Read the project's instructions to find the test command and strategy. Run only the tests relevant to the code paths changed in this PR.

Use `git diff <default-branch>...HEAD --name-only` to identify changed files and determine which tests are relevant.

If changes are purely internal with no user-facing impact, unit tests may suffice — skip e2e if no relevant scenarios exist. If no test command is documented, skip with a note.

**Verify**: Tests pass (exit code 0), or no relevant tests to run.
**If failed** (max 4 attempts): Analyze the failure. If flaky, re-run. If real: fix → go to **fmt**, then retry.

---

### ci

Read the project's instructions to find the CI command and verification method. Run CI with `run_in_background: true` if the command takes more than a few seconds.

**Never pipe CI to `tail`/`head`**, and **never append `2>&1`** — background mode captures both streams.

CI commands are typically local (e.g. `nix flake check`, `just ci`, `make ci`) and are forge-independent — **run them regardless of forge**. Only the *verification method* may be forge-specific: if the project's instructions describe verification via `gh` commit-status checks and `forge != github`, fall back to exit code + command output for verification on non-GitHub forges, and note this in the step record. (Bitbucket `bkt pr checks` wiring is tracked in #10.)

**Verify**: Use the verification method described in the project's instructions (e.g., checking commit statuses on GitHub, reading CI output elsewhere). If no CI command is documented, skip with a note.

**On failure** — read logs or output to diagnose.

**Flaky vs real**: A test is flaky only if it **passes on a subsequent retry**. Consistent failure = real bug. Before retrying, read the failing test code to judge if the failure pattern is inherently flaky (race conditions, timing, async waits).

**If flaky** (max 3 retries): Retry just the failing step.
**If real bug** (max 5 fixes): Fix → **fmt** → **commit** → retry CI. Under `--no-git`, drop **commit** from the loop (Fix → **fmt** → retry CI).
**If retries exhausted**: Set workflow status to `"failed"`, skip to **done**.

---

### update-pr

**If `--no-git`**: Skip with status `skipped` and reason `"--no-git"`. There is no PR to update. Proceed to **done**.

**If `forge != github`**: Skip with status `skipped` and reason `"non-<forge> forge: <forge>"`. (Bitbucket `bkt pr edit` wiring is tracked in #10.) Proceed to **done**.

**If `forge == github`**: Re-check the PR title/body against current scope. If scope changed, update via `gh pr edit` per the `forge-pr` skill.

**Verify**: PR title/body matches the delivered scope.

---

### done

Present a summary of all steps with their verification status. If any step has a non-success status, retry it (max 3 attempts from done). If still failing after retries, set `status: "failed"`.

`"completed"` requires **all steps `passed`**, with two exceptions that count toward completion:

1. A step `skipped` with `reason` beginning `"non-<forge> forge:"` (detected forge isn't GitHub).
2. A step `skipped` with `reason` `"--no-git"` (user opted out of git operations).

A `failed` step always blocks `"completed"`. No redefining "passed," no footnote caveats. Update `.do-results.json` accordingly.

#### Timing summary

Compute duration for each step from its `startedAt`/`completedAt` timestamps. Print a table to the user showing each step's duration and the total wall-clock time (`startedAt` of first step → `completedAt` of last step). Highlight the **slowest step** and any step that took >30% of total time.

#### Optimization suggestions

After the timing table, print 2–4 concrete suggestions for reducing time-to-completion in future runs. Base these on the actual timing data — for example:

- If **ci** dominates: suggest `--from ci-only` for re-runs, or note which CI sub-step was slowest
- If **research** was slow: suggest pre-reading relevant code before invoking `/do`
- If **test** had retries: note the flaky test and suggest hardening it
- If **police** required fix iterations: note which pass caught issues (rules/fact-check/elegance)
- If **implement** was the bottleneck: suggest breaking the task into smaller PRs

Be specific to this run's data, not generic advice.

#### PR comment & wrap-up

**If `--no-git`**: There is no branch or PR to report against. Print the timing table and optimization suggestions to the terminal only. List the files modified in the working tree (`git status --porcelain`) so the user can see what the agent touched. Remind the user that changes are uncommitted — the commit/push/PR steps are theirs to run.

**If `forge != github`**: Report the branch name (and remote URL, if available via `git remote get-url origin`) instead of a PR URL. Print the timing table and optimization suggestions to the terminal only — do **not** attempt to post a PR comment. (Bitbucket `bkt pr comment` wiring is tracked in #10.)

**If `forge == github`**: Report the PR URL. Then post the final step status table as a **PR comment** using `gh pr comment` with a markdown table including durations. Format:

```
gh pr comment --body "$(cat <<'COMMENT'
## [`/do`](https://github.com/srid/agency) results

| Step | Status | Duration | Verification |
|------|--------|----------|-------------|
| sync | ✓ | 3s | ... |
| research | ✓ | 45s | ... |
...
| **Total** | | **4m 32s** | |

### Optimization suggestions

- <2–4 concrete suggestions based on timing data>

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

- **Never skip steps.** Run them in order from entry point to **done**.
- **Every commit is NEW.** Never amend, rebase, or force-push.
- **Feature branches only.** Never commit to master/main. (Under `--no-git`, no commits happen at all, so this rule is moot — the agent leaves the user on whatever branch they started on.)
- **Background for CI.** Run CI with `run_in_background: true`.
- **No questions.** Don't use `AskUserQuestion` unless `--review` is active during the hickey pause.
- **Never stop between steps.** After completing a step, immediately proceed to the next one.
- **Complete the full workflow.** Implementing code is one step of many. The task is not done until a PR URL (GitHub), a pushed branch name (non-GitHub forges), or a working-tree summary (`--no-git`) is reported.
- **Exhausted retries = halt.** If `ci` or `test` retries are exhausted, set status to `"failed"` and skip to **done**. Do not proceed to `update-pr` as if nothing happened.

ARGUMENTS: $ARGUMENTS