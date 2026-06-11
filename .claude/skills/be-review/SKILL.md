---
name: be-review
description: Run /be's review gauntlet SERIALLY — /lens-debate (lowy ⇄ hickey), then /codex-debate, then /simplify, then code-police, each editing and committing on the live branch in turn. Use from /be §4, or when the user asks to "run the review gauntlet". Requires Claude Code's Skill tool.
argument-hint: "[--base <branch>] [--rationale <note>] [--tracks lens,codex,simplify,police]"
---

# Review gauntlet (serial)

Run four reviewers **one after another** on the live branch, each the **sole
editor while it runs**. Collisions are an *edit* problem: two reviewers writing
the same worktree at once see torn, half-edited state. Running serially makes
that impossible without any snapshot machinery — when a step starts, the previous
step has already committed, so every reviewer reads a clean, settled tree and
applies its own fixes directly:

1. **`/lens-debate`** — lowy + hickey review independently, debate contested
   findings to consensus, then **apply** the agreed fixes (each its own commit).
   The change **`rationale`** is threaded into the lenses' *cross-examination*
   (adjudication), never their independent reviews — pre-loading reviewers with
   author intent measurably suppresses findings (the #1109 curation-bias lesson;
   see the `review-orchestration` Atlas note). A deliberate decision gets
   dispositioned on the record, not silently unflagged.
2. **`/codex-debate`** — codex (`xhigh` round 1, `high` after) ⇄ claude author,
   debating to consensus. Its author rounds edit and each round auto-commits
   `fix(…)` on the branch. Running codex **after** the lens step is deliberate:
   the lens step's structural rewrites are the largest commits any reviewer
   produces in this gauntlet, and codex's cross-family review is the only step
   that can check them — the "each step sees the commits the previous step
   added" property (Preflight) only covers those rewrites if the cross-model
   reviewer runs second.
3. **`/simplify`** — the self-applying reuse / simplification / efficiency pass
   over the changed code. Now that nothing runs concurrently, it runs as itself
   (it could not against the old read-only snapshot).
4. **code-police** — its rule-checklist, fact-check, and elegance passes, applying
   their fixes (the elegance pass re-runs `/simplify`, harmless after step 3).

Each step runs to completion before the next begins. Wall-clock is
`lens + codex + simplify + police` — slower than the old parallel form, but with
no snapshot, no change-request handoff, and no separate apply pass: every step is
its own editor and commits its own work.

**PR comments come after the push, never before.** Each step commits locally but
be-review pushes only once, after all selected steps finish. A comment that names
a commit SHA must never be posted while that SHA is local-only — if a later step
failed or the run were interrupted, the PR would advertise commits that were
never pushed. So the debate skills run with their self-commenting **suppressed**
(`--no-comment`); be-review **writes each returned comment body to the ledger
dir the moment the track completes** (`.be-review/comment-<track>.md` — never
held only in conversation memory), pushes once at the end, and only then posts
the lens comment, the codex comment, and its own police summary **from those
files**. No PR comment can reference a local-only commit, and an interrupted
run never loses an already-earned comment body.

## The findings ledger

The gauntlet's write-ahead record: `.be-review/ledger.json` (gitignored,
per-worktree — sibling of the debate skills' scratch dirs). It exists so that a
crash, interrupt, or context loss anywhere in a multi-track, possibly hour-long
run resumes by *content* instead of re-running reviewers against a tree that
already contains their fixes — and so the final comments and report are rendered
from recorded data, not from conversation memory.

Shape:

```jsonc
{
  "base": "<MB sha>", "start": "<START sha>", "pr": <number|null>,
  "tracks": {
    "lens":     { "state": "complete", "status": "consensus", "rounds": 2,
                  "head": "<HEAD sha after the track>", "commentFile": "comment-lens.md",
                  "findings": [ { "id": "lens:lowy-1", "title": "…", "location": "file:line",
                                  "disposition": "fix|drop|unresolved-adjudicated:fix|…",
                                  "commit": "<sha|null>", "duplicateOf": null } ] },
    "codex":    { "state": "complete", "status": "consensus|unresolved|degraded-substituted", … },
    "simplify": { "state": "complete", "changed": true,  "head": "…" },
    "police":   { "state": "complete", "findings": […], "head": "…" }
  }
}
```

**Write-ahead discipline.** Initialize it in Preflight (base, start, pr, empty
tracks). Update it (Write tool, full rewrite is fine — it's small) at every
boundary: when a track completes (its `state`, `status`, post-track `head`,
findings, comment file), and after every adjudication action you take on
unresolved findings. The findings come straight from each track's structured
return (`settled`/`unresolved` from lens, `finalVerdict.findings`/`unresolved`
from codex, your own list for police); prefix ids with the track
(`lens:lowy-1`, `codex:F2`, `police:P1`) so they stay unique across tracks.

**Cross-track dedup.** When recording a later track's finding that targets the
same location and substance as an earlier ledger entry, set `duplicateOf` to
the earlier id instead of treating it as new — and if it's already fixed
(`commit` set), say so in your adjudication rather than re-fixing.

**Resume.** If Preflight finds an existing `.be-review/ledger.json` whose
`base` equals this run's `MB` **and** whose `start` is an ancestor of HEAD,
this is an interrupted run: keep the ledger, skip every track with
`state: "complete"` (their commits are already on the branch), and continue
from the first incomplete track. A ledger with a different `base` is stale —
overwrite it and start fresh.

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
- **Ledger init/resume.** `mkdir -p .be-review`, then check for an existing
  `.be-review/ledger.json` per the resume rule (The findings ledger): same
  `base` + `start` an ancestor of HEAD → resume, skipping completed tracks;
  otherwise write a fresh ledger (`base: MB`, `start: START`, `pr`, empty
  `tracks`).

## Run the steps in order

`--tracks lens,codex,simplify,police` selects which steps run (default all four),
in the listed order. Run each to completion, then move to the next. Preflight
already ran `git fetch origin` and resolved the base, so pass `MB` straight into
each step and **skip the per-skill step-1 fetch / base resolution** — don't redo
it once per step.

**After each track**: write its returned comment body (if any) to
`.be-review/comment-<track>.md`, then update the ledger (state, status,
post-track `head` via `git rev-parse HEAD`, findings with track-prefixed ids,
cross-track `duplicateOf` marks) before starting the next track. The ledger is
the record the final comments and report render from.

1. **lens** — follow `/lens-debate` (Skill tool). `repoPath` = the live worktree,
   `base` = `MB`, **apply mode** (the default — do *not* pass `--no-apply`),
   **`--no-comment`** (so it doesn't advertise its local-only fix commits before
   be-review pushes), and thread the `rationale` through — the lens workflow
   feeds it to the *debate* (adjudication) rounds only, never the independent
   reviews. It applies the agreed fixes as commits and **returns** its rendered
   comment body for be-review to post after the push. Wait for its `Workflow` to
   finish before starting the codex step.

   `/lens-debate` returns a `status` of `clean`, `consensus`, `unresolved`, or
   `merge-base-error`:
   - `clean` / `consensus` — the lenses agreed per-finding and applied the fixes.
   - `unresolved` — the debate hit its round backstop with findings still
     contested. `/be` §4 requires you to **adjudicate every unresolved lens
     finding yourself before moving on**: surface them in the report, decide drop
     or apply for each, and apply the survivors before continuing. Fold your
     adjudication into the deferred lens comment you post after the push (the lens
     skill ran `--no-comment`, so there is no self-posted comment to follow up
     on). Never report "lens consensus" for an `unresolved` run.
   - `merge-base-error` — the scope couldn't be trusted; report it and move on.

2. **codex** — follow `/codex-debate` (Skill tool). `repoPath` = the live
   worktree, `base` = `MB`, **`--no-comment`** (same reason as lens — defer the
   comment until after the push). Its step-2 `Workflow` runs in the background;
   **wait for it to finish** before starting the simplify step. It commits its
   rounds and **returns** its rendered comment body — hold onto it to post after
   the final push. Do **not** tell codex which of the commits in its diff came
   from the lens step — it reviews the whole change cold, lens rewrites
   included; that cold cross-family pass over the structural rewrites is the
   point of this ordering. (On persistent `reviewer-error` there is **no body to
   post** — per `/codex-debate`, an unresolved reviewer error is not a consensus
   to report; skip the codex comment in that case.)

   `/codex-debate` ends in `consensus`, `unresolved`, or `reviewer-error`:
   - `consensus` — every finding resolved; the round commits are on the branch.
   - `unresolved` — the debate hit its round backstop with findings still open.
     Adjudicate every still-open finding yourself before moving on — same duty
     as an unresolved lens finding: decide fix or drop for each, apply the
     survivors (commit each fix), and fold your adjudication into the deferred
     codex comment. Never report "codex consensus" for an `unresolved` run.
   - `reviewer-error` — see the retry rule below.

   **Retry codex on `reviewer-error` (up to 3 attempts).** `reviewer-error`
   means codex never produced a structured verdict even after
   `codex-review.sh`'s built-in per-`codex exec` retries. That is an
   *infrastructure hiccup, not a debate outcome*: re-launch it immediately with
   the same args. Stop the moment an attempt reaches `consensus` (or
   `unresolved` — that is a real debate outcome, not an infra failure). Only if
   **all 3** come back `reviewer-error` do you give up on codex. Then
   **substitute, don't just skip**: run one fresh-context same-family
   correctness review of the diff vs `MB` (an `Agent` sub-agent with a
   cold prompt — the diff scope and "review for correctness; cite file:line",
   nothing about who wrote what), apply/commit what it finds that you accept,
   and record the codex track as **degraded — substituted** so the report and
   badge say so honestly. A fresh-context same-family pass is strictly weaker
   than cross-family review but strictly better than nothing; a flaky codex
   must never silently mean *less* review.

3. **simplify** — invoke `/simplify` (Skill tool), scoped to the change vs `MB`.
   It applies its fixes to the working tree. When it finishes, **commit** what it
   changed (`refactor: simplify <area>`, staging only the files it touched). If it
   changed nothing, note that and move on.

4. **police** — invoke `/code-police` (Skill tool). It runs all three of its
   passes — rule checklist, fact-check, and the elegance pass (which itself
   re-invokes `/simplify`). Its embedded pass prompts diff against
   `origin/HEAD...HEAD` by default, which is *wrong* whenever `--base` isn't the
   repo default: before invoking, **tell the police passes to scope to `MB`** —
   pass the merge-base explicitly so every pass runs `git diff <MB>...HEAD`, not
   the default ref. **Apply** the fixes it surfaces, committing each
   `fix(police): <title>` with the finding in the message (stage only the files
   changed). Its elegance pass re-running `/simplify` over an already-simplified
   tree (step 3) is harmless — on a settled tree `/simplify` typically reports no
   changes — so let it run rather than ask code-police to skip a
   pass its contract has no flag for.

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
comment (codex on persistent `reviewer-error`, lens on `merge-base-error`): the
lens body and the codex body verbatim from their saved files
(`gh pr comment -F .be-review/comment-<track>.md`), and the police
summary (the `## [👮 Code-police](https://agency.srid.ca/)` comment described in
Report).

**Then post the gauntlet badge** — one final single-paragraph comment rendered
from the ledger, so the review depth this PR actually received is on the record
(three regimes must never ship under indistinguishable comment sets):

```
**⛩️ Review gauntlet** (lens → codex → simplify → police · base `<MB sha12>`):
lens <status>(<rounds>r, N fixed) · codex <status|degraded — substituted>(<rounds>r)
· simplify <changed|clean> · police <N fixed|clean>[ · skipped: <excluded tracks>]
```

Use the ledger's per-track `status` verbatim — `unresolved` tracks read
`unresolved → adjudicated`, a substituted codex reads `degraded — substituted`.
Skip this comment only when no PR exists.

## Report

Summarize in chat — rendering from the ledger, reporting **only the selected
tracks**, and naming any track `--tracks` **skipped** so the absence is
explicit, not silent. Lead with the same gauntlet-badge line the PR comment
carries:

- **lens** — status (**consensus** + fixes applied, or **unresolved** + how many
  findings still need human adjudication and how you adjudicated each, or
  `merge-base-error`); its PR comment landed (posted after the push) — except on
  `merge-base-error`, which has no comment body to post.
- **codex** — consensus / unresolved (+ how you adjudicated each still-open
  finding) / reviewer-error (note how many attempts if retried, and whether the
  fresh-context substitute review ran — report that as **degraded —
  substituted**, never as a codex consensus); on consensus or unresolved its PR
  comment landed (posted after the push, per "Push, then comment") — on
  persistent reviewer-error there is no codex comment to post.
- **simplify** — whether it changed anything and what it committed.
- **police** — findings and how each was actioned; the
  `## [👮 Code-police](https://agency.srid.ca/)` summary comment landed (posted
  after the push, alongside the codex and lens comments).
- whether the fixes were pushed;
- `git log --oneline <base>..HEAD` + `git diff --stat <base>` so the combined
  result is visible.

ARGUMENTS:
