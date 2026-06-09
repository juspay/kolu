---
name: be-review
description: Run /be's review gauntlet in PARALLEL — /codex-debate edits the branch while /lens-debate and code-police review a pinned snapshot read-only; a final apply pass implements their change requests on the post-codex tree. Use from /be §4, or when the user asks to "run the review gauntlet". Requires Claude Code's Skill tool.
argument-hint: "[--base <branch>] [--rationale <note>] [--tracks codex,lens,police]"
---

# Review gauntlet (parallel)

Run the three reviewers **concurrently**, with exactly **one editor** on the
branch. The old serial gauntlet existed because collisions are an *edit* problem,
not a *review* problem — so the fix is not to serialize the reviews, it's to
leave one editor:

1. **`/codex-debate`** — codex (`xhigh`) ⇄ claude author, debating to consensus.
   It is the **sole branch writer**: its author rounds must edit (codex re-reviews
   the fixes — that *is* the debate), and each round auto-commits `fix(…)` on the
   branch as today.
2. **`/lens-debate --no-apply`** — lowy + hickey debate boundaries/simplicity to
   consensus against a **pinned snapshot** of the branch (see below), read-only.
   Instead of applying, it **returns the agreed fix plans** (`fixes`) as change
   requests. Pass the change **`rationale`** so the lenses don't flag deliberate
   decisions.
3. **code-police review** — a background agent runs the police passes (rule
   checklist, fact-check, plus a read-only elegance pass standing in for the
   self-applying Pass 3) against the same snapshot, and **returns findings** as
   change requests — never editing.

When all three finish, a final **apply pass** re-validates each change request
against the post-codex tree (codex may have already fixed, moved, or mooted it),
implements the survivors, and commits each individually. Wall-clock drops from
`codex + lens + police` to `max(codex, lens, police) + apply` — codex is almost
always the long pole, so lens and police come nearly free.

## Why the snapshot

The lens and police reviewers run `git diff` and Read files while codex's author
rounds are **editing and committing the same worktree** — they'd see torn,
half-edited state. So before launching, pin a read-only copy:

```bash
START=$(git rev-parse HEAD)
git worktree add --detach "$repoPath/.be-review/snapshot" "$START"
```

`.be-review/` is gitignored. Lens + police get the snapshot path as their
`repoPath`; codex gets the live worktree. The snapshot equals the committed
branch state at launch (preflight requires committed work), so nothing is lost —
only mid-flight churn is excluded. Remove it after the gauntlet
(`git worktree remove --force "$repoPath/.be-review/snapshot"`).

The price of parallelism is **staleness**: lens/police review the pre-codex
tree, so some of their findings will already be addressed by codex's debate
commits. The apply pass absorbs that by re-validating each request before
implementing it.

## Preflight

- **Non-empty diff.** `git diff --stat <base>` (default: the repo default via
  `git symbolic-ref --short refs/remotes/origin/HEAD`). If empty, stop.
- **Commit first.** Reviewers review *committed* code — commit/stash any
  outstanding work before starting (in `/be` this is automatic: §2/§3 commit and
  push before §4).
- **Resolve the scope once.** `git fetch origin`, then
  `MB=$(git merge-base <base> HEAD)` and `START=$(git rev-parse HEAD)`. Pass `MB`
  as the `base` to both workflows (their own merge-base resolution is idempotent
  on a SHA) so every track reviews the identical diff scope.
- **Snapshot worktree** (unless `--tracks` is codex-only): create
  `.be-review/snapshot` at `START` as above.
- **codex login** (unless `--tracks` excludes it): `codex login status`. If not
  logged in, tell the user to run `codex login` (suggest the `!` prefix) and
  continue with lens + police.

## Launch — all tracks in one breath

`--tracks codex,lens,police` selects which run (default all three). Launch every
selected track **before waiting on any of them**:

- **codex track**: follow `/codex-debate` (Skill tool) — its step-2 `Workflow`
  call runs in the background. `repoPath` = the **live** worktree, `base` = `MB`.
- **lens track**: follow `/lens-debate` (Skill tool) — its step-2 `Workflow` call
  also runs in the background. `repoPath` = the **snapshot**, `base` = `MB`,
  `apply: false`, and thread the `rationale` through.
- **police track**: spawn one **background agent** (general-purpose,
  `run_in_background: true`) with this brief: read
  `.apm/skills/code-police/SKILL.md` and `.agency/code-police.md` (if present);
  run Pass 1 (rule checklist) and Pass 2 (fact-check) as parallel read-only
  sub-agents, plus a third read-only **elegance** sub-agent (reuse /
  simplification / efficiency suggestions on the changed code — suggestions
  only, since the self-applying `/simplify` can't run against a snapshot);
  scope every pass to `git -C <snapshot> diff <MB>...HEAD`; apply the skill's
  "Reviewing principles" verbatim; **never edit any file**; return the combined
  findings (file, line, issue, concrete fix) plus the Pass 1 rule table.

The two debate skills' step-1 context resolution (fetch, base, non-empty diff)
is already done by Preflight — don't redo it per skill; go straight to their
Workflow invocations.

**Retry codex on `reviewer-error` (up to 3 attempts).** `/codex-debate` ends
either in `consensus` or in `reviewer-error` — the latter meaning codex itself
never produced a structured verdict even after `codex-review.sh`'s built-in
per-`codex exec` retries. That is an *infrastructure hiccup, not a debate
outcome*. When the codex workflow returns `reviewer-error`, **re-launch it
immediately** — same args — while the lens/police tracks keep running; don't
wait for them. Stop early the moment an attempt reaches `consensus`. Only if
**all 3** attempts come back `reviewer-error` do you give up on codex: report
the persistent reviewer-error honestly (no false `## Codex ⇄ Claude debate`
consensus comment) — the other tracks don't depend on it.

## Apply pass — after all tracks complete

First remove the snapshot worktree. Then collect the change requests:

- the lens result's `fixes` (agreed `fix` findings, each with a converged plan);
- the police agent's findings.

If there are none, skip ahead. Otherwise spawn **one implementer agent** (the
requests may interact, so a single serial implementer — not a fan-out) with all
change requests and this contract, then relay its table:

> For EACH change request, first **re-validate against current HEAD**: the codex
> debate has been committing fixes since these reviews ran, so the cited code may
> be fixed, moved, or gone. Skip (with the reason) any request that's already
> addressed or no longer applies; re-locate ones whose code moved. For each
> survivor, implement it **tightly scoped** following its plan, then commit it
> **individually** — `fix(lens): <title>` or `fix(police): <title>`, message
> carrying the finding, plan, and provenance. Stage only the files you changed.
> Never push. Return a per-request disposition table: applied (+ SHA) /
> already-fixed-by-codex / no-longer-applies.

## Push the fixes

After the apply pass, **if anything was committed** (`git log --oneline
<base>..HEAD` is non-empty vs. the start) **and a PR exists for this branch**
(`gh pr view --json number -q .number`), **push**: `git push`. No PR → nothing to
push to, so skip (the local commits are still there for the human). **Never
merge** — pushing updates the open PR; the human reviews the commits and merges
when satisfied.

## PR comments

- **codex**: post the codex workflow's returned `comment` verbatim per
  `/codex-debate` step 3 (consensus only; on persistent reviewer-error there is
  no agreement to report).
- **lens**: post the lens workflow's returned `comment` (it records the agreed
  fixes as "handed off"), **appending** an `### Applied by /be-review` section —
  the apply pass's per-request outcome for the lens-originated requests
  (applied + commit SHA / already fixed by codex / no longer applies).
- **police**: post a `## [👮 Code-police](https://agency.srid.ca/)` comment
  summarizing what the passes found and how each finding was dispositioned by
  the apply pass (code-police doesn't self-comment).

## Report

Confirm the three PR comments landed, then summarize in chat: each track's
outcome (codex consensus / reviewer-error — note how many attempts codex took if
it was retried; lens consensus + how many fixes were handed off; police findings),
the apply pass's disposition table (applied / already-fixed / dropped), whether
the fixes were pushed, and `git log --oneline <base>..HEAD` + `git diff --stat
<base>` so the combined result is visible.

ARGUMENTS:
