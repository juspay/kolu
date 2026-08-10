---
name: be-review
description: Run /be's review gauntlet SERIALLY — architecture-first-principles FIRST (framework/structure diffs), then /lens-debate (lowy ∥ hickey), then /agent-debate with an explicitly selected Claude/Codex/Grok peer, then /simplify, then code-police, each editing and committing on the live branch in turn. Use from /be §4, or when the user asks to "run the review gauntlet".
argument-hint: "[--agent <claude|codex|grok>] [--base <branch>] [--rationale <note>] [--context <note>] [--tracks checks,lens,debate,simplify,police]"
---

# Review gauntlet (serial)

Run the reviewers **one after another** on the live branch, each the **sole
editor while it runs** — every reviewer reads a settled tree and applies its own
fixes. Why serial, and the incidents behind these rules:
[`RATIONALE.md`](RATIONALE.md) — read when editing this skill, not running it.

1. **architecture-first-principles** — FIRST, for a diff touching framework
   packages (`@kolu/surface*`), adding/reshaping module structure, **or whose
   correctness rests on a concurrency/ordering claim** (a race declared closed,
   an asserted happens-before, a flag one callback sets and another path reads
   as truth). Skip ONLY for pure-docs or trivially-local diffs — a diff leaning
   on a happens-before is not trivially-local. Say so either way. Confirmed
   findings are dispositioned like any stage's: fix now or record where, never
   "acceptable for scope".
2. **`/lens-debate`** — lowy ∥ hickey as parallel subagents, one
   reconcile-and-apply pass commits the fixes. Pass the `rationale`.
3. **`/agent-debate`** — the selected peer debates to consensus; author rounds
   commit `fix(…)`.
4. **`/simplify`** — the self-applying reuse/simplification pass.
5. **code-police** — rules + fact-check passes, applying fixes.

**PR comments come after the push, never before.** Each step commits locally;
be-review pushes once after all steps, then posts. The debate skills run with
`--no-comment` and leave their bodies on disk. No PR comment may reference a
local-only commit.

## Preflight

- **Non-empty diff** vs `<base>` (default: the repo default branch). Empty →
  stop. Reviewers review *committed* code — commit/stash outstanding work.
- **Verify `<base>` is a remote-tracking ref, mechanically.** A caller's
  `--base master` names the *local* master — routinely tens of commits stale,
  swelling the diff with history nobody wrote. After `git fetch origin`:
  `git -C "$repoPath" rev-parse --verify --quiet "refs/remotes/$base"`; on
  failure retry as `origin/$base`; if that fails too, stop and say so.
- **Resolve the scope once:** `MB=$(git merge-base <base> HEAD)`,
  `START=$(git rev-parse HEAD)`. Pass `MB` to every step so each reviews
  against the identical fork point (later reviewers seeing earlier reviewers'
  fixes is intended).
- **Pin `repoPath`** — the repo under review may not be the cwd (a `/be` run
  can carry a companion repo). Thread it into every step and subagent prompt
  with absolute paths and `git -C "$repoPath"`. A cross-repo step returning
  `clean` against a non-empty target diff means `repoPath` didn't take effect.
- **Debate peer** (unless `--tracks` excludes `debate`): require
  `--agent <claude|codex|grok>` and run its auth preflight. On failure, name
  the login command or exact error and stop — never skip a mandatory track or
  substitute a fallback peer.

## Run the steps

`--tracks checks,lens,debate,simplify,police` selects steps (default all), in
order, each to completion. Preflight already fetched and resolved the base —
don't redo it per step. Both review steps run **inline in your own turn**; act
on real signals (a subagent returning, a peer ping), never timers — no
`ScheduleWakeup` polling.

1. **lens** — `/lens-debate` with `repoPath`, `base = MB`, `--no-comment`, and
   the `rationale`. It commits agreed fixes and leaves its comment at
   `$repoPath/.lens-debate/comment.md` — post that file after the push, don't
   improvise a summary. Statuses: `clean`/`applied` (settled);
   `needs-human` (adjudicate each finding yourself — decide drop or apply,
   apply survivors, fold the adjudication into the deferred comment; never
   report it as settled); `merge-base-error` (report and move on).
2. **debate** — capture `DEBATE_START=$(git -C "$repoPath" rev-parse HEAD)`,
   then invoke `/agent-debate`:
   `review --agent <selected> --repo "$repoPath" --base MB --no-comment
   --context <context> --rationale <rationale>` (no reasoning-effort flag —
   the peer runs at its CLI default). When an API-facing shared-surface change
   trips the drishti companion-repo gate, note in `--rationale` that the gate
   defers to §ship (it can only be checked against final post-gauntlet HEAD).
   On consensus, assemble the deferred comment at
   `$repoPath/.agent-debate/comment.md`: peer ⇄ author header, round count
   (from the `verdict-*.json` files), a commit table of
   `$DEBATE_START..HEAD` (or "peer approved after author disputes" when
   empty), and a legend of the findings raised (unique by id across the
   verdicts). Fill both agent names from the actual harness and peer — never
   hardcode. On `reviewer-error`/`merge-base-error`, post no false-consensus
   body; report the failure and move on.
3. **simplify** — `/simplify` scoped to `MB`; commit what it changed
   (`refactor: simplify <area>`, staging only its files).
4. **police** — `/code-police` with **`--no-elegance` whenever simplify ran**
   (its elegance pass would re-invoke `/simplify` over an already-simplified
   tree); omit the flag only when `--tracks` excluded simplify. Tell its passes
   to scope to `MB` — their default `origin/HEAD...HEAD` diff is wrong whenever
   `--base` isn't the repo default. Apply and commit each fix
   (`fix(police): <title>`).

## Push, then comment

Settle whether anything is new: `git log --oneline $START..HEAD`. Then:

- **`just fmt` before any push with new commits** — no reviewer guarantees
  formatting, `just check` never runs the formatter, and an unformatted tree
  reds `ci::fmt` later. Commit any reformat (`style: just fmt`).
- New commits + a PR exists → `git push`; **only after it succeeds**, post the
  deferred comments (their SHAs are now remote).
- No new commits but a PR exists → post the comments immediately.
- No PR → nothing to push or comment on; findings live in chat and the log.
- A required push fails → do **not** post; report the failure.

Post **one comment per track that produced a body**: the lens body, the
agent-debate body (`gh pr comment -F`), and the code-police summary
(`## [👮 Code-police](https://agency.srid.ca/)`). **Never merge.**

## Report

Summarize in chat, covering only the selected tracks and naming any skipped
track explicitly: lens status + adjudications; debate peer +
consensus/reviewer-error; what simplify changed; police findings and their
disposition; whether fixes were pushed; `git log --oneline <base>..HEAD` +
`git diff --stat <base>`.

ARGUMENTS:
