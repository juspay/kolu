---
name: be-review
description: Run /be's review gauntlet SERIALLY — /codex-debate, then /lens-debate (lowy ⇄ hickey), then /simplify, then code-police, each editing and committing on the live branch in turn. Use from /be §4, or when the user asks to "run the review gauntlet". Requires Claude Code's Skill tool.
argument-hint: "[--base <branch>] [--rationale <note>] [--tracks codex,lens,simplify,police]"
---

# Review gauntlet (serial)

Run four reviewers **one after another** on the live branch, each the **sole
editor while it runs**. Collisions are an *edit* problem: two reviewers writing
the same worktree at once see torn, half-edited state. Running serially makes
that impossible without any snapshot machinery — when a step starts, the previous
step has already committed, so every reviewer reads a clean, settled tree and
applies its own fixes directly:

1. **`/codex-debate`** — codex (`xhigh`) ⇄ claude author, debating to consensus.
   Its author rounds edit and each round auto-commits `fix(…)` on the branch.
2. **`/lens-debate`** — lowy + hickey debate boundaries/simplicity to consensus,
   then **apply** the agreed fixes (each its own commit). Pass the change
   **`rationale`** so the lenses don't flag deliberate decisions.
3. **`/simplify`** — the self-applying reuse / simplification / efficiency pass
   over the changed code. Now that nothing runs concurrently, it runs as itself
   (it could not against the old read-only snapshot).
4. **code-police** — the rule-checklist and fact-check passes, applying their
   fixes.

Each step runs to completion before the next begins. Wall-clock is
`codex + lens + simplify + police` — slower than the old parallel form, but with
no snapshot, no change-request handoff, and no separate apply pass: every step is
its own editor and commits its own work. The debate skills post their own PR
comments as they finish; be-review adds a police summary and a final report.

## Preflight

- **Non-empty diff.** `git diff --stat <base>` (default: the repo default via
  `git symbolic-ref --short refs/remotes/origin/HEAD`). If empty, stop.
- **Commit first.** Reviewers review *committed* code — commit/stash any
  outstanding work before starting (in `/be` this is automatic: §2/§3 commit and
  push before §4).
- **Resolve the scope once.** `git fetch origin`, then
  `MB=$(git merge-base <base> HEAD)` and `START=$(git rev-parse HEAD)`. Pass `MB`
  as the `base` to every step (their own merge-base resolution is idempotent on a
  SHA) so each reviews the change against the identical fork point. Note that each
  step sees the *commits the previous step added* as part of the diff — that is
  intended: a later reviewer reviews the earlier reviewer's fixes too.
- **codex login** (unless `--tracks` excludes it): `codex login status`. If not
  logged in, tell the user to run `codex login` (suggest the `!` prefix) and
  continue with the remaining steps.

## Run the steps in order

`--tracks codex,lens,simplify,police` selects which steps run (default all four),
in the listed order. Run each to completion, then move to the next.

1. **codex** — follow `/codex-debate` (Skill tool). `repoPath` = the live
   worktree, `base` = `MB`. Its step-2 `Workflow` runs in the background; **wait
   for it to finish** before starting the lens step. It commits its rounds and
   posts its own PR comment.

   **Retry codex on `reviewer-error` (up to 3 attempts).** `/codex-debate` ends
   either in `consensus` or in `reviewer-error` — the latter meaning codex never
   produced a structured verdict even after `codex-review.sh`'s built-in
   per-`codex exec` retries. That is an *infrastructure hiccup, not a debate
   outcome*: re-launch it immediately with the same args. Stop the moment an
   attempt reaches `consensus`. Only if **all 3** come back `reviewer-error` do
   you give up on codex — report the persistent reviewer-error honestly (no false
   consensus comment) and move on to the lens step.

2. **lens** — follow `/lens-debate` (Skill tool). `repoPath` = the live worktree,
   `base` = `MB`, **apply mode** (the default — do *not* pass `--no-apply`), and
   thread the `rationale` through. It applies the agreed fixes as commits and
   posts its own PR comment. Wait for its `Workflow` to finish.

   `/lens-debate` returns a `status` of `clean`, `consensus`, `unresolved`, or
   `merge-base-error`:
   - `clean` / `consensus` — the lenses agreed per-finding and applied the fixes.
   - `unresolved` — the debate hit its round backstop with findings still
     contested. `/be` §4 requires you to **adjudicate every unresolved lens
     finding yourself before moving on**: surface them (in the report and, since
     the lens skill self-comments, as a follow-up note on the PR), decide drop or
     apply for each, and apply the survivors before continuing. Never report
     "lens consensus" for an `unresolved` run.
   - `merge-base-error` — the scope couldn't be trusted; report it and move on.

3. **simplify** — invoke `/simplify` (Skill tool), scoped to the change vs `MB`.
   It applies its fixes to the working tree. When it finishes, **commit** what it
   changed (`refactor: simplify <area>`, staging only the files it touched). If it
   changed nothing, note that and move on.

4. **police** — invoke `/code-police` (Skill tool), scoped to the change vs `MB`.
   Run its rule-checklist and fact-check passes and **apply** the fixes it
   surfaces, committing each `fix(police): <title>` with the finding in the
   message (stage only the files changed). Skip its self-applying simplify pass —
   step 3 already covered that ground.

## Push the fixes

After all selected steps run, **if anything was committed** (`git log --oneline
$START..HEAD` is non-empty — `$START` was captured in Preflight) **and a PR
exists for this branch** (`gh pr view --json number -q .number`), **push**:
`git push`. No PR → nothing to push to, so skip (the local commits are still there
for the human). **Never merge** — pushing updates the open PR; the human reviews
the commits and merges when satisfied.

## Report

Summarize in chat — reporting **only the selected tracks**, and naming any track
`--tracks` **skipped** so the absence is explicit, not silent:

- **codex** — consensus / reviewer-error (note how many attempts if retried); its
  PR comment landed.
- **lens** — status (**consensus** + fixes applied, or **unresolved** + how many
  findings still need human adjudication and how you adjudicated each, or
  `merge-base-error`); its PR comment landed.
- **simplify** — whether it changed anything and what it committed.
- **police** — findings and how each was actioned (post a
  `## [👮 Code-police](https://agency.srid.ca/)` comment summarizing them, since
  code-police doesn't self-comment).
- whether the fixes were pushed;
- `git log --oneline <base>..HEAD` + `git diff --stat <base>` so the combined
  result is visible.

ARGUMENTS:
