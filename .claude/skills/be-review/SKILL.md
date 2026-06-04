---
name: be-review
description: Run /be's review gauntlet SERIALLY — /codex-debate → /lens-debate → /code-police, one after another on the current branch, each seeing the prior's committed fixes. Use from /be §4, or when the user asks to "run the review gauntlet". Requires Claude Code's Skill tool.
argument-hint: "[--base <branch>] [--rationale <note>] [--tracks codex,lens,police]"
---

# Review gauntlet (serial)

Run the three reviewers **one after another** on the current branch, each seeing
the previous reviewer's **committed fixes**. Order is **heaviest-change-first →
polish-last** (correctness → structure → style), so each later reviewer works on a
more-settled tree and its work isn't invalidated by a later rewrite:

1. **`/codex-debate`** — codex (`xhigh`) ⇄ claude author, debating to consensus. It
   catches correctness bugs and makes the biggest edits, so it goes **first** —
   everything downstream reviews the *corrected* code, not the version about to
   change. Self-posts a `## Codex ⇄ Claude debate` PR comment.
2. **`/lens-debate`** — lowy + hickey debate boundaries/simplicity to consensus.
   Pass the change **`rationale`** so the lenses don't flag deliberate decisions.
   Structure is argued on code that's now correct. Self-posts a
   `## Lowy ⇄ Hickey lens debate` PR comment.
3. **`/code-police`** — rules → fact-check → elegance. The lightest touch, so it
   runs **last**, polishing the most-settled tree. Apply its findings, then post a
   `## [👮 Code-police](https://agency.srid.ca/)` PR comment summarizing what it
   found and fixed (code-police doesn't self-comment).

Each step commits its own fixes (`fix(…)` / `fix(police):`) directly on the
branch, so the next reviewer sees them fresh — **no detached worktrees, no
cherry-pick consolidation, no reconcile**. This is deliberately a thin sequencer,
not a workflow engine: serial editing means the reviewers never collide, which is
the entire problem the old parallel fan-out created (rival rewrites of the same
code → a cherry-pick reconcile marathon → discarded commits). Collisions are an
*edit* problem, not a *review* problem; running the editors one at a time
dissolves them.

## Why serial (not parallel)

The reviews themselves are independent and read-only — they *could* run at once.
But each reviewer **edits**, and on a small / single-file change all three edit the
same code. Run in parallel, they produce rival rewrites that git then has to
reconcile commit-by-commit, often discarding half the work as obsolete. Run
serially, `/lens-debate` simply *sees* `/codex-debate`'s fix and has nothing to
re-derive. The only thing serial costs is wall-clock; it buys correctness and a
fraction of the tokens.

## Preflight

- **Non-empty diff.** `git diff --stat <base>` (default: the repo default via
  `git symbolic-ref --short refs/remotes/origin/HEAD`). If empty, stop.
- **Commit first.** Reviewers review *committed* code — commit/stash any
  outstanding work before starting (in `/be` this is automatic: §2/§3 commit and
  push before §4).
- **codex login** (unless `--tracks` excludes it): `codex login status`. If not
  logged in, tell the user to run `codex login` (suggest the `!` prefix) and
  continue with lens + police.

## Run

Invoke the three skills **in order** via the Skill tool, **waiting for each to
finish before starting the next** — never in parallel. Thread `--base` and the
`rationale` through. `--tracks codex,lens,police` selects/reorders which run
(default all three, in the order above).

**Retry codex on `reviewer-error` (up to 3 attempts).** `/codex-debate` ends
either in `consensus` or in `reviewer-error` — the latter meaning codex itself
never produced a structured verdict (it emitted reasoning prose, or the CLI was
broken/unavailable) even after `codex-review.sh`'s built-in per-`codex exec`
retries. That is an *infrastructure hiccup, not a debate outcome*, and in
practice the next whole-debate attempt usually produces a real verdict. So when
`/codex-debate` returns `reviewer-error`, **re-invoke it** — same `--base` /
`rationale` — and keep retrying **up to 3 total attempts**. Stop early the moment
an attempt reaches `consensus` (that result wins, proceed to lens-debate). Only
if **all 3** attempts come back `reviewer-error` do you give up on codex: report
the persistent reviewer-error honestly (no false `## Codex ⇄ Claude debate`
consensus comment), then continue with lens-debate and code-police, which don't
depend on codex. The built-in `codex exec` retries inside `codex-review.sh` are a
*lower* layer (one flaky invocation); this is the *outer* layer (the whole debate
came back without a verdict) — both apply.

## Report

Confirm the three PR comments landed, then summarize in chat: each reviewer's
outcome (codex consensus / reviewer-error — note how many attempts codex took if
it was retried, lens consensus, police findings actioned) and
`git log --oneline <base>..HEAD` + `git diff --stat <base>` so the combined
result is visible. **Never push or merge** — the human reviews the commits and
merges when satisfied.

ARGUMENTS:
