---
name: be-review
description: Run /be's review gauntlet SERIALLY — architecture-first-principles FIRST (framework/structure diffs), then /lens-debate (lowy ⇄ hickey), then /agent-debate with an explicitly selected Claude/Codex/Grok peer, then /simplify, then code-police, each editing and committing on the live branch in turn. Use from /be §4, or when the user asks to "run the review gauntlet".
argument-hint: "[--agent <claude|codex|grok>] [--base <branch>] [--rationale <note>] [--context <note>] [--tracks checks,lens,debate,simplify,police]"
---

# Review gauntlet (serial)

Run four reviewers **one after another** on the live branch, each the **sole
editor while it runs**. Collisions are an *edit* problem: two reviewers writing
the same worktree at once see torn, half-edited state. Running serially makes
that impossible without any snapshot machinery — when a step starts, the previous
step has already committed, so every reviewer reads a clean, settled tree and
applies its own fixes directly:

1. **architecture-first-principles** — FIRST, for a diff touching framework packages
   (`@kolu/surface*`), adding/reshaping module structure, **or whose correctness
   rests on a concurrency / ordering claim** (a race declared closed, one event
   asserted to land "before" another, timing across independent async cascades, a
   flag flipped by one callback that another path reads back as truth): run the
   named checks per their SKILL (Workflow fan-out, adversarial verify, scope = diff +
   one hop down its imports). It runs before the lenses so architecture-level
   findings (wrong library, wrong layer, dead API surface) are fixed BEFORE the
   structural/code debates polish details that were about to change shape. Skip
   ONLY for pure-docs or trivially-local diffs — and a diff is **not**
   trivially-local when its correctness leans on a happens-before: P3
   (state-and-time) is the only lens that interrogates an ordering claim, so a
   leaf-module race-fix that skips it is exactly how an untrue "race-safe /
   structural" comment ships past a green gauntlet. Say so either way. Its confirmed
   findings are dispositioned like any stage's — fix now or record where, never
   "acceptable for scope".
2. **`/lens-debate`** — lowy + hickey debate boundaries/simplicity to consensus,
   then **apply** the agreed fixes (each its own commit). Pass the change
   **`rationale`** so the lenses don't flag deliberate decisions.
3. **`/agent-debate`** — the explicitly selected Claude, Codex, or Grok peer
   (`xhigh`) debates the current author agent to consensus. Its author rounds
   edit and auto-commit `fix(…)` on the branch.
4. **`/simplify`** — the self-applying reuse / simplification / efficiency pass
   over the changed code. Now that nothing runs concurrently, it runs as itself
   (it could not against the old read-only snapshot).
5. **code-police** — its rule-checklist and fact-check passes, applying their
   fixes. Run with `--no-elegance` so its elegance pass is skipped: that pass
   re-invokes `/simplify`, which step 4 already ran over this same tree.

Each step runs to completion before the next begins. Wall-clock is
`checks + lens + debate + simplify + police` — slower than the old parallel form, but with
no snapshot, no change-request handoff, and no separate apply pass: every step is
its own editor and commits its own work.

**PR comments come after the push, never before.** Each step commits locally but
be-review pushes only once, after all selected steps finish. A comment that names
a commit SHA must never be posted while that SHA is local-only — if a later step
failed or the run were interrupted, the PR would advertise commits that were
never pushed. So the debate skills run with their self-commenting **suppressed**
(`--no-comment`); be-review captures each comment body (the lens skill returns one
ready; the agent-debate body is a compact commit table from the debate's own
commits — step 2), pushes once at the end, and only then posts the lens comment,
the agent-debate comment, and its own police summary. No PR comment can reference a local-only
commit.

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
  intended: a later reviewer reviews the earlier reviewer's fixes too. Run every
  `git` here with `git -C "$repoPath"` (below) so a cross-repo run resolves the
  *target* repo's base, not the cwd's.
- **Pin `repoPath` — the repo under review may NOT be the cwd.** A `/be` run can
  carry the work in a *companion repo* (e.g. the drishti PR a `@kolu/surface`
  change requires per `/be` §5) while the session is rooted in a kolu worktree.
  Set `repoPath` to that target repo's absolute path (default: the cwd worktree
  root) and thread it into **every** step. Pass `args` as a real object —
  `Workflow({ scriptPath, args: { repoPath, base: MB, … } })`. **Note the harness
  JSON-ENCODES `args` before the workflow script sees it, so `args` arrives as a
  *string* regardless of what you pass.** The debate scripts now parse a stringified
  `args` defensively (`const a = typeof args === 'string' ? JSON.parse(args) : args`),
  so `repoPath`/`base`/`rationale`/`context` thread through correctly and malformed
  `args` throws *loudly* instead of degrading. This fixed a real cross-repo failure: an
  earlier run's scripts did the bare `const a = args || {}`, so the stringified `args`
  had no `.repoPath`, `repoPath` silently degraded to `.`, and a cross-repo lens-debate
  re-reviewed the **cwd** repo and committed five fixes onto the wrong repo (same-repo
  runs only "worked" by cwd coincidence). If a cross-repo step still returns `clean`
  with `rounds: 0` against a non-empty *target* diff, suspect the `repoPath` didn't
  take effect before trusting it.
- **Debate peer** (unless `--tracks` excludes `debate`): require
  `--agent <claude|codex|grok>` and run `/agent-debate`'s matching auth
  preflight. If it fails, name the matching login command or exact non-auth
  error and stop the gauntlet; never skip a mandatory track or select a fallback
  peer.

## Run the steps in order

`--tracks checks,lens,debate,simplify,police` selects which steps run (default all),
in the listed order. Run each to completion, then move to the next. Preflight
already ran `git fetch origin` and resolved the base, so pass `MB` straight into
each step and **skip the per-skill step-1 fetch / base resolution** — don't redo
it once per step.

**How the debate steps run — two different shapes.** `/lens-debate` runs as a
backgrounded `Workflow` ("launched in background; Task ID: …") that can take
20–30 min; when it settles it fires a task-notification that resumes this run —
that *is* the wait, so after dispatching it go to rest, **don't schedule redundant
`ScheduleWakeup` polls**, and don't babysit (a prior run wired 4-min wakeups *and*
a 5-min `/loop` to nudge a gauntlet that was simply mid-debate — pure churn).
`/agent-debate` is **different now**: it runs **inline in your own turn**, driving
a live selected-peer split terminal that pings you each round — follow its event-driven
loop to consensus directly, with no background `Workflow` to await. Either way, act
only on the real signal (the lens notification, or peer ping), never a timer.

1. **lens** — follow `/lens-debate` (Skill tool). `repoPath` = the live worktree,
   `base` = `MB`, **apply mode** (the default — do *not* pass `--no-apply`),
   **`--no-comment`** (so it doesn't advertise its local-only commits before
   be-review pushes — defer the comment until after the push), and thread the
   `rationale` through. It applies the agreed fixes as commits and **returns** its
   rendered comment body for be-review to post after the push. Wait for its
   `Workflow` to finish before starting the debate step.

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

   Whatever the status, if the result carries a non-empty `escalations` (debate
   threads that ran past 3 rounds — the engine kept debating; this is a valve,
   not an exit), surface them in the report and the deferred lens comment
   already lists them: an escalated-and-unresolved thread is a candidate to hand
   to warm debate terminals rather than re-running the engine (see the lens
   SKILL's "escalation valve").

2. **debate** — require the caller's explicit
   `--agent <claude|codex|grok>`. Capture
   `DEBATE_START=$(git -C "$repoPath" rev-parse HEAD)` first so the later
   comment includes only this debate's commits. Invoke `/agent-debate` as:

   ```text
   review --agent <selected> --repo "$repoPath" --base MB
   --no-comment --effort xhigh --context <context> --rationale <rationale>
   ```

   `--no-comment` defers the comment until after the final push. `--repo` keeps
   every git/scratch/gh/spawn operation rooted in a cross-repo target.
   `--context` carries the task intent to the author; `--rationale` tells the
   independent peer which decisions are deliberate.

   When an API-facing shared-surface change trips the drishti companion-repo
   gate, add this to `--rationale`: the gate is deferred to §ship because it can
   be checked only against final post-gauntlet Kolu HEAD, so it is not a
   blocking code finding. The up-front rationale prevents any selected peer from
   debating an impossible mid-review gate.

   `/agent-debate` runs inline, driving the selected peer's live split and
   committing each author round locally. On consensus, assemble the compact
   deferred comment from the debate's commit range:

   ```bash
   workDir="$repoPath/.agent-debate"
   rounds=$(find "$workDir" -maxdepth 1 -type f -name 'verdict-[0-9][0-9][0-9].json' | wc -l)
   commits=$(git -C "$repoPath" rev-list --count "$DEBATE_START"..HEAD)
   [ "$rounds" -ge 1 ] || { echo "agent debate: no verdicts — no completed debate" >&2; }
   authorName="<actual invoking harness name>"
   peerName="<selected peer display name>"
   {
     printf '## %s ⇄ %s debate\n\n' "$peerName" "$authorName"
     printf '✅ Consensus in %s round(s) · peer effort: xhigh\n\n' "$rounds"
     if [ "$commits" -gt 0 ]; then
       printf '| Fix commit | SHA | Description |\n|---|---|---|\n'
       git -C "$repoPath" log --reverse --format='%h	%s' "$DEBATE_START"..HEAD \
         | nl -w1 -s'	' | while IFS=$'\t' read -r n sha subj; do
             printf '| %s | %s | %s |\n' "$n" "$sha" "$subj"
           done
     else
       printf '_No fix commits: the peer approved after author disputes._\n'
     fi
     printf '\n**Legend** — findings %s raised:\n\n' "$peerName"
     jq -rs '[.[].findings[]] | unique_by(.id) | sort_by(.id|ltrimstr("F")|tonumber)[]
             | "- **\(.id)** — \(.issue|split(". ")[0])"' "$workDir"/verdict-*.json
   } > "$workDir/comment.md"
   ```

   Fill `authorName` from the actual running harness and normalize the selected
   peer to `Claude`, `Codex`, or `Grok`; never hardcode either side. If the
   debate ends in `reviewer-error` or `merge-base-error`, do not create or post a
   false-consensus body. Report the selected peer with the failure, then move on
   (after fixing and rerunning a bad base).

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

- **Run `just fmt` before any push, whenever new commits exist.** The four
  reviewers edit and commit code but **none guarantees formatting**, and `just
  check` is tsc + biome *lint* — it never runs the formatter. So a hand-edit by
  lens/debate/police (a reflowed `.ts` closure, a `default.nix` fileset tweak that
  wants `nixpkgs-fmt`) sails through green `check` yet leaves the tree unformatted,
  and `ci::fmt` then reds in §5 and burns a whole CI cycle on a re-run (it has,
  more than once). `just fmt` runs **both** biome-format and nixpkgs-fmt, so it is
  the only gate that matches `ci::fmt`. Once the steps finish and new commits
  exist, run `just fmt` and, if it changed anything, commit the reformat (`style:
  just fmt`, staging only what it touched) so the formatted tree rides this push —
  don't leave formatting for the §5 CI loop to surface.
- **New commits exist** and **a PR exists for this branch**
  (`gh pr view --json number -q .number`) → **`git push`**. **Only after the push
  succeeds** do you post the deferred comments — the lens and agent-debate bodies from
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
comment (lens on `merge-base-error`, debate on persistent `reviewer-error`): the
lens body and the agent-debate body verbatim (`gh pr comment -F` — the debate body is the
`$workDir/comment.md` you assembled in step 2 as a compact commit table), and the police summary (the
`## [👮 Code-police](https://agency.srid.ca/)` comment described in Report).

## Report

Summarize in chat — reporting **only the selected tracks**, and naming any track
`--tracks` **skipped** so the absence is explicit, not silent:

- **lens** — status (**consensus** + fixes applied, or **unresolved** + how many
  findings still need human adjudication and how you adjudicated each, or
  `merge-base-error`); its PR comment landed (posted after the push) — except on
  `merge-base-error`, which has no comment body to post.
- **debate** — selected peer + consensus / reviewer-error; on consensus its PR comment landed (posted
  after the push, per "Push, then comment") — on reviewer-error there is no comment to post.
- **simplify** — whether it changed anything and what it committed.
- **police** — findings and how each was actioned; the
  `## [👮 Code-police](https://agency.srid.ca/)` summary comment landed (posted
  after the push, alongside the lens and agent-debate comments).
- whether the fixes were pushed;
- `git log --oneline <base>..HEAD` + `git diff --stat <base>` so the combined
  result is visible.

ARGUMENTS:
