---
name: be-review
description: Run /be's review gauntlet SERIALLY — /lens-debate (lowy ⇄ hickey), then /codex-debate, then /simplify, then code-police, each editing and committing on the live branch in turn. Use from /be §4, or when the user asks to "run the review gauntlet". Requires Claude Code's Skill tool.
argument-hint: "[--base <branch>] [--rationale <note>] [--context <note>] [--tracks lens,codex,simplify,police]"
---

# Review gauntlet (serial)

Run four reviewers **one after another** on the live branch, each the **sole
editor while it runs**. Collisions are an *edit* problem: two reviewers writing
the same worktree at once see torn, half-edited state. Running serially makes
that impossible without any snapshot machinery — when a step starts, the previous
step has already committed, so every reviewer reads a clean, settled tree and
applies its own fixes directly:

1. **`/lens-debate`** — lowy + hickey debate boundaries/simplicity to consensus,
   then **apply** the agreed fixes (each its own commit). Pass the change
   **`rationale`** so the lenses don't flag deliberate decisions.
2. **`/codex-debate`** — codex (`xhigh`) ⇄ claude author, debating to consensus.
   Its author rounds edit and each round auto-commits `fix(…)` on the branch.
3. **`/simplify`** — the self-applying reuse / simplification / efficiency pass
   over the changed code. Now that nothing runs concurrently, it runs as itself
   (it could not against the old read-only snapshot).
4. **code-police** — its rule-checklist and fact-check passes, applying their
   fixes. Run with `--no-elegance` so its elegance pass is skipped: that pass
   re-invokes `/simplify`, which step 3 already ran over this same tree.

Each step runs to completion before the next begins. Wall-clock is
`lens + codex + simplify + police` — slower than the old parallel form, but with
no snapshot, no change-request handoff, and no separate apply pass: every step is
its own editor and commits its own work.

**PR comments come after the push, never before.** Each step commits locally but
be-review pushes only once, after all selected steps finish. A comment that names
a commit SHA must never be posted while that SHA is local-only — if a later step
failed or the run were interrupted, the PR would advertise commits that were
never pushed. So the debate skills run with their self-commenting **suppressed**
(`--no-comment`); be-review captures the comment body each returns, pushes once at
the end, and only then posts the lens comment, the codex comment, and its own
police summary. No PR comment can reference a local-only commit.

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

`--tracks lens,codex,simplify,police` selects which steps run (default all four),
in the listed order. Run each to completion, then move to the next. Preflight
already ran `git fetch origin` and resolved the base, so pass `MB` straight into
each step and **skip the per-skill step-1 fetch / base resolution** — don't redo
it once per step.

**How to "wait for the Workflow" — let its own settle notification resume you.**
The debate skills run as a backgrounded `Workflow` ("launched in background; Task
ID: …"); a debate can legitimately take 20–30 min. When it settles it fires its
own task-notification that resumes this run automatically — that is the wait. So
after dispatching a step, go to rest and let that notification wake you; **do not
schedule redundant `ScheduleWakeup` polls** and there is nothing to babysit. (A
prior run scheduled 4-min wakeups *and* the user wired a 5-min `/loop` to nudge a
gauntlet that was simply mid-debate — both were unnecessary churn.) Only act when
the workflow's notification arrives or it has provably errored.

1. **lens** — follow `/lens-debate` (Skill tool). `repoPath` = the live worktree,
   `base` = `MB`, **apply mode** (the default — do *not* pass `--no-apply`),
   **`--no-comment`** (so it doesn't advertise its local-only commits before
   be-review pushes — defer the comment until after the push), and thread the
   `rationale` through. It applies the agreed fixes as commits and **returns** its
   rendered comment body for be-review to post after the push. Wait for its
   `Workflow` to finish before starting the codex step.

   `/lens-debate` returns a `status` of `clean`, `consensus`,
   `apply-incomplete`, `unresolved`, or `merge-base-error`:
   - `clean` / `consensus` — the lenses agreed per-finding and applied the fixes.
   - `apply-incomplete` — the lenses agreed, but the Apply phase didn't land every
     fix cleanly (see `applyGaps`: a fix was missing from the apply output or
     changed-but-uncommitted). **Reconcile before moving on:** for each gap, apply
     or commit the outstanding fix yourself (staging only its files), then fold the
     reconciliation into the deferred lens comment. Never report "lens consensus"
     for an `apply-incomplete` run.
   - `unresolved` — the debate hit its round backstop with findings still
     contested. `/be` §4 requires you to **adjudicate every unresolved lens
     finding yourself before moving on**: surface them in the report, decide drop
     or apply for each, and apply the survivors before continuing. Fold your
     adjudication into the deferred lens comment you post after the push (the lens
     skill ran `--no-comment`, so there is no self-posted comment to follow up
     on). Never report "lens consensus" for an `unresolved` run.
   - `merge-base-error` — the scope couldn't be trusted; report it and move on.

2. **codex** — follow `/codex-debate` (Skill tool). `repoPath` = the live
   worktree, `base` = `MB`, **`--no-comment`** (so it doesn't advertise its
   local-only round commits before be-review pushes), and thread both `context`
   (the task / main-agent context, so the codex **author inherits what you know —
   not just the diff** — every round) and `rationale` (so codex doesn't flag
   deliberate decisions at the source) straight through. Its step-2 `Workflow` runs
   in the background; **wait for it to finish** before starting the simplify step.
   It commits its rounds and **returns** its rendered comment body — hold onto it
   to post after the final push. (On persistent `reviewer-error` there is **no
   body to post** — per `/codex-debate`, an unresolved reviewer error is not a
   consensus to report; skip the codex comment in that case.)

   **Retry codex on `reviewer-error` (up to 3 attempts).** `/codex-debate` ends
   in `consensus`, `commit-incomplete` (see below), or `reviewer-error` — the
   last meaning codex never
   produced a structured verdict even after `codex-review.sh`'s built-in
   per-`codex exec` retries. That is an *infrastructure hiccup, not a debate
   outcome*: re-launch it immediately with the same args. Stop the moment an
   attempt reaches `consensus`. Only if **all 3** come back `reviewer-error` do
   you give up on codex — report the persistent reviewer-error honestly (no false
   consensus comment) and move on to the simplify step.

   **On `commit-incomplete`,** the debate converged but a round's author left its
   edits uncommitted (round numbers in `commitGaps`). The edits are still in the
   tree, but the per-round commit didn't land — **commit the outstanding tree
   yourself** (staging only the files that round changed, message
   `fix: codex review — debate round N`) before the simplify step, and note the
   reconciliation in the deferred codex comment. Don't report it as a clean
   consensus.

3. **simplify** — invoke `/simplify` (Skill tool), scoped to the change vs `MB`.
   It applies its fixes to the working tree. When it finishes, **commit** what it
   changed (`refactor: simplify <area>`, staging only the files it touched). If it
   changed nothing, note that and move on.

4. **police** — invoke `/code-police` (Skill tool), passing **`--no-elegance`
   whenever the simplify track (step 3) ran this gauntlet**. That flag skips
   Pass 3 (elegance), which would otherwise re-invoke `/simplify` over the tree
   step 3 already simplified — a full skill invocation to re-derive a
   near-guaranteed no-op. Pass 1 (rules) and Pass 2 (fact-check) still run.
   _Only omit the flag when `--tracks` excluded `simplify`_ — then no standalone
   simplify ran, and the elegance pass is the run's one simplify, not redundant.
   Its embedded pass prompts diff against
   `origin/HEAD...HEAD` by default, which is *wrong* whenever `--base` isn't the
   repo default: before invoking, **tell the police passes to scope to `MB`** —
   pass the merge-base explicitly so every pass runs `git diff <MB>...HEAD`, not
   the default ref. **Apply** the fixes it surfaces, committing each
   `fix(police): <title>` with the finding in the message (stage only the files
   changed).

## Push, then comment

First settle whether there is anything to push: `git log --oneline $START..HEAD`
(`$START` was captured in Preflight). Then:

- **New commits exist** and **a PR exists for this branch**
  (`gh pr view --json number -q .number`) → **`git push`**. **Only after the push
  succeeds** do you post the deferred comments — the lens and codex bodies from
  steps 1–2 are now safe to publish because the SHAs they name are on the remote.
- **No new commits** (every step was clean or applied nothing) but **a PR
  exists** → there is nothing to push, and HEAD is already remote-visible, so
  post the deferred comments **immediately**. The local-only-SHA invariant is
  about never advertising an *unpushed* commit; with no new commit there is no
  such risk.
- **No PR** → there is nothing to push to and nothing to comment on. Skip both;
  the local commits (if any) and their findings live in chat and the local log
  for the human.
- **A required push fails** → do **not** post the comments (the SHAs are still
  local-only); report the push failure instead.

**Never merge** — pushing updates the open PR; the human reviews the commits and
merges when satisfied.

When you do post, post **one comment per track that produced a body** — skip any
track `--tracks` excluded, and skip a track that ran but yielded no postable
comment (lens on `merge-base-error`, codex on persistent `reviewer-error`): the
lens body and the codex body verbatim (`gh pr comment -F`), and the police
summary (the `## [👮 Code-police](https://agency.srid.ca/)` comment described in
Report).

## Report

Summarize in chat — reporting **only the selected tracks**, and naming any track
`--tracks` **skipped** so the absence is explicit, not silent:

- **lens** — status (**consensus** + fixes applied, or **unresolved** + how many
  findings still need human adjudication and how you adjudicated each, or
  `merge-base-error`); its PR comment landed (posted after the push) — except on
  `merge-base-error`, which has no comment body to post.
- **codex** — consensus / reviewer-error (note how many attempts if retried); on
  consensus its PR comment landed (posted after the push, per "Push, then
  comment") — on persistent reviewer-error there is no comment to post.
- **simplify** — whether it changed anything and what it committed.
- **police** — findings and how each was actioned; the
  `## [👮 Code-police](https://agency.srid.ca/)` summary comment landed (posted
  after the push, alongside the lens and codex comments).
- whether the fixes were pushed;
- `git log --oneline <base>..HEAD` + `git diff --stat <base>` so the combined
  result is visible.

ARGUMENTS:
