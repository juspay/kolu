---
name: be-review
description: Run /be's review gauntlet in PARALLEL — codex⇄claude, lowy⇄hickey, and code-police each debate to consensus in their own git worktree at the same time, then consolidate the per-track commits onto the branch (the rare overlap is reconciled) and post a detailed PR comment per track. Use from /be §4, or when the user asks to "run the review gauntlet in parallel". Requires Claude Code's Workflow tool.
argument-hint: "[--base <branch>] [--tracks codex,lens,police] [--no-commit] [--no-comment] [--no-rich-comment]"
---

# Parallel review gauntlet

`/be`'s §4 gauntlet runs three reviewers **serially** today (`/codex-debate` →
`/lens-debate` → `/code-police`) for one structural reason: each step **commits
fixes**, so the next reviewer sees the mutated tree. That chaining is the *only*
thing forcing order — the reviews themselves are independent and read-only.

This skill removes the chaining by giving each reviewer its **own detached git
worktree** forked from the branch HEAD. All three multi-round debates run **at
once**, each mutating only its own worktree, each running to full consensus (no
depth is lost — every reviewer keeps its complete loop). When they finish, the
orchestrator **consolidates** by cherry-picking each track's commits onto the
branch in order. The common case is no overlap (clean picks); the rare overlap —
two tracks editing the same lines — surfaces as a cherry-pick conflict that is
**reconciled to honor both fixes**.

```
            ┌─ be-review-codex   ─ codex⇄claude debate ─→ commits ─┐
branch HEAD ┼─ be-review-lens    ─ lowy⇄hickey debate  ─→ commits ─┼─→ cherry-pick → PR comments
            └─ be-review-police  ─ rules/fact/elegance ─→ commits ─┘   (overlap → reconcile)
```

The per-track worktrees live under the repo's conventional `.worktrees/`
(gitignored) — `.worktrees/be-review-<runId>-<track>`, where `<runId>` is unique
per invocation (the returned `worktrees` field carries each track's exact path).
**Isolation is structural, not
behavioral:** every workflow agent inherits the *session* cwd (the harness has no
per-agent cwd, and `isolation:'worktree'` can't host a multi-round debate that
accumulates commits in one tree), so every git command is `git -C <worktree>` and
every file path is absolute — no agent can leak into the wrong tree by forgetting
to `cd`.

## Why this shape

- **The debates were built for it.** `/codex-debate` and `/lens-debate` are
  already `repoPath`-parameterized workflows whose docs promise "parallel debates
  in different worktrees never collide." This skill is the orchestrator that
  finally drives them that way — invoking each as a **child workflow** (one level
  of nesting, which the runtime allows) pointed at a different worktree.
- **No depth is traded for the parallelism.** Each track runs its *full*
  multi-round loop to consensus — codex re-reviews its own fixes round after
  round, the lenses debate every finding, police runs all three cold passes. The
  only thing that changed is that the three loops run concurrently instead of
  end-to-end.
- **Consolidation is git, not vibes.** Each track's conclusions are real commits;
  replaying them with `git cherry-pick` preserves each debate's per-commit ledger
  in history and makes overlap a *detectable* conflict (`--diff-filter=U`) rather
  than a silent clobber.

## What runs in each track

- **codex** — the `/codex-debate` workflow: codex (read-only, `xhigh`) ⇄ claude
  author, to consensus, committing per round.
- **lens** — the `/lens-debate` workflow: lowy + hickey review independently in
  parallel (on Opus), debate every finding to consensus, apply each agreed fix as
  its own commit. Pass the change rationale so deliberate decisions aren't flagged.
- **police** — `/code-police`'s three cold passes (rule checklist, fact-check,
  elegance) reproduced as parallel agents, each finding applied as its own commit
  (`fix(police):`). **Sweep 1** reviews the full diff and applies every finding;
  **later sweeps re-review ONLY the files the previous sweep's fixes touched**, for
  regressions or partial fixes those edits introduced — *not* fresh pre-existing
  nits in untouched code (issue #1163). This keeps the load-bearing "a fix can
  introduce/partially-resolve an issue" guarantee while letting police **converge
  (~2 sweeps)** instead of grinding the cap re-scanning the whole diff for more
  nits. Capped at a few sweeps; hitting the cap with regressions still open reports
  `incomplete` rather than a false consensus.
  `fmt`-on-touched-files runs in every apply. Per-finding `just check` is
  **deferred** to the post-consolidation check + `/be` §5 CI rather than run 3×
  concurrently across the parallel worktrees.

## Arguments

- **`--base <branch>`**: remote-tracking ref to diff against (e.g. `origin/master`).
  Default the repo default via `git symbolic-ref --short refs/remotes/origin/HEAD`.
  Setup resolves this to the **merge-base** of the branch and `base`, and *that* is
  what every reviewer diffs against — so commits `base` gained since the branch
  forked are NOT reviewed as if this PR made them (no master-drift noise). If the
  merge-base can't be resolved (missing/typoed/stale base ref), Setup aborts with
  `status: 'setup-failed'` rather than falling back to the raw `base` tip and
  reviewing an untrustworthy scope — fix the ref (`git fetch`) and re-run.
- **`--tracks codex,lens,police`**: which tracks to run *and the order they
  consolidate in*. Default all three; codex first (it changes the most), police
  last (lightest touch), so an overlap surfaces picking the later track.
- **`--no-commit`**: leave each track's fixes uncommitted for inspection
  (debugging a single track). Consolidation cherry-picks per-track *commits*, so
  with this flag the orchestrator **skips Consolidate + Report + Cleanup and
  preserves the worktrees** (status `no-commit`) — leaving every track's worktree
  in place under `.worktrees/be-review-<runId>-<track>/` (the branch is untouched;
  the returned `worktrees` field carries each exact path) rather than silently
  discarding the uncommitted edits; inspect and tear them down yourself. Default is
  to commit, which is what actually ships fixes.
- **`--no-comment`**: suppress the PR comments. By default the **Report** phase
  posts a detailed PR comment per track plus the consolidation ledger — the review
  trail the gauntlet exists to leave. This flag reports in chat only.
- **`--no-rich-comment`** (maps to `richComment: false`): force the cheap
  deterministic string-builder comments. By **default** (`richComment: true`) each
  comment is authored by a per-track **reporter agent** (narrative + tables +
  reasoning, synthesized from the track's full structured result) rather than the
  terse builders. That agent **writes its own body and posts it** in one shot, so
  the large body never crosses a second agent as a base64 blob. The builders remain
  the **baseline** the agent improves and the **fallback** if the agent throws; a
  trivial track (track-error / clean / no findings) skips the agent and posts the
  baseline directly. Use this flag when you want the fast, no-agent comments.
- **Cost / model tiers** (`model` / `synthModel` / `mechModel`): the orchestrator
  and child workflows run each agent on the cheapest model that does its job, so a
  run doesn't pay Opus rates for `git`/`gh` shuffling. Defaults: **`model: opus`**
  for deep reasoning (the lens lenses — load-bearing — + claude-author + lens
  apply), **`synthModel: sonnet`** for synthesis (the reporter agents — which now
  author AND post their own comment — the cherry-pick/reconcile, the police
  review/apply passes — code-police is natively Sonnet anyway), **`mechModel:
  haiku`** for mechanical agents (setup, every commit, cleanup, the baseline-
  fallback comment poster, status/HEAD checks, merge-base + codex runner).
  Override any tier via args. The run reports a **`tokensByPhase`** breakdown
  (output tokens, from `budget.spent()` on the shared turn counter) bucketed by
  each phase's wall-clock window — NOT isolated to that phase's agents: concurrent
  track and child-workflow output lands in whichever window is open, so read it as
  per-mark-interval spend for tuning the tiers, not as an isolated per-phase cost.

## Steps

### 1. Resolve context

- Determine `repoPath` — the **absolute** worktree root (normally the cwd; resolve
  it with `git -C . rev-parse --show-toplevel`). The orchestrator rejects a
  relative `repoPath` with `status: 'setup-failed'`, since every git command and
  scratch/worktree path it builds is absolute and cwd-independent.
- `git fetch origin` so the base remote-tracking ref is current.
- Resolve `base` (a remote-tracking ref like `origin/master`).
- Confirm a non-empty diff: `git diff --stat <base>`. If empty, stop.
- **Commit the change first.** Every track forks a detached worktree from the
  branch HEAD, so only *committed* work is reviewed. If the main worktree has
  staged/unstaged/untracked changes (outside the gitignored `.worktrees/` and
  `.be-review/` scratch), commit (or stash) them before invoking — the
  orchestrator's Setup preflight aborts with `status: 'setup-failed'` on a dirty
  tree rather than reviewing an incomplete set. (In `/be` this is automatic: §2/§3
  commit and push before §4.)
- **Preflight codex** (unless `--tracks` excludes it): `codex login status`. If
  not logged in, tell the user to run `codex login` (suggest the `!` prefix).

### 2. Run the orchestrator Workflow

```
Workflow({
  scriptPath: ".claude/skills/be-review/be-review.workflow.js",
  args: {
    repoPath: "<worktree root>",
    base: "<base branch>",                 // remote-tracking ref, e.g. origin/master
    runId: "<unique id, e.g. current epoch ms>", // isolates this run's worktrees/scratch
    rationale: "<optional author note on deliberate decisions>",
    tracks: ["codex", "lens", "police"],   // also the consolidation order
    commit: <false only if --no-commit>,
    comment: <false only if --no-comment>,
    richComment: <false only if --no-rich-comment; default true (reporter agents)>
  }
})
```

**Pass a unique `runId`** (the workflow can't call `Date.now()` itself — the runtime
forbids it to keep resume deterministic). Stamp the current epoch ms (or any unique
token) so two `/be-review` runs in the same main worktree don't clobber each other's
worktrees/scratch. Omitting it defaults to `'run'` — safe for a single run, unsafe
for concurrent ones.

It runs five phases the user can watch via `/workflows`: **Setup** (fan out one
detached worktree per track under `.worktrees/`), **Tracks** (the three gauntlets
run concurrently to consensus), **Consolidate** (cherry-pick each track's commits
onto the branch, reconciling overlap), **Report** (a per-track **reporter agent**
authors a detailed PR comment from each track's structured result — narrative +
tables + reasoning — plus the consolidation ledger; `richComment: false` falls back
to the terse deterministic builders), **Cleanup** (tear down the worktrees). It
returns:

```
{ status,                  // 'done' | 'consolidation-incomplete' | 'consolidation-aborted' | 'no-commit' | 'setup-failed'
  branchHead, finalHead, base, order,
  tracks,                  // per-track result; ALWAYS one entry per requested track —
                           //   a track whose worktree setup failed is status:'track-error'
  consolidation,           // { finalHead, picks[] }  (null when not consolidated)
  preservedTracks,         // tracks NOT consolidated (worktrees kept); non-empty ⇒ status incomplete/aborted
  conflicts,               // the reconciled overlaps (picks whose outcome ≠ clean; empty common case)
  comments }               // { consolidation, codex, lens, police } → posted comment URLs ({} under --no-comment)
```

- `setup-failed` — no work was consolidated: a dirty main worktree (commit/stash
  and re-run), an unresolvable merge-base, a malformed `runId`/`tracks` argument,
  or no worktree could be created. `tracks` carries the per-track `track-error`
  detail.
- `consolidation-incomplete` — the picks ran, but at least one requested track was
  **preserved** (left uncommitted edits, couldn't be confirmed clean, or crashed
  with committed-but-unreplayed work), so its fixes live only in its worktree.
  `preservedTracks` names them and each `tracks[t].note` has the recovery
  cherry-pick. `/be` should adjudicate these before continuing rather than treat
  the gauntlet as fully landed.
- `consolidation-aborted` — the branch HEAD moved or the main worktree went dirty
  **during** the (long) parallel tracks phase, so the cherry-pick base is no longer
  the reviewed `branchHead`. Nothing was consolidated and **all** track worktrees
  are preserved (`preservedTracks` + per-track recovery cherry-picks). Resolve the
  drift, then consolidate by hand or re-run.
- `no-commit` — `--no-commit` was set, so each track's fixes are left
  **uncommitted in its preserved `.worktrees/be-review-<runId>-<track>` worktree**
  and nothing is consolidated, reported, or cleaned up. The result lists those
  `worktrees` (with exact paths) to inspect; re-run with commit enabled to
  actually consolidate.
  (`--no-commit` is a single-track-debugging mode, not a way to ship fixes.)
- For any per-track `track-error` (setup failure or a crashed gauntlet), fall back
  to the serial path for that track.

### 3. Present the result

**The workflow already posted the PR comments** — one detailed comment per track
(codex debate table, lens per-finding ledger, police findings) plus the
consolidation ledger — in its **Report** phase, so the trail is on the PR no
matter who invoked it (the `comments` field carries the URLs). Confirm they landed
(re-post any that returned "no PR" once the PR exists). Then summarize in chat:
the per-track outcomes, the consolidation ledger (`clean`/`reconciled`/`dropped`),
and `git log --oneline <base>..HEAD` + `git diff --stat <base>` so the user sees
the combined result. Never push or merge — the human reviews the per-track commits
and merges.

## Safety & notes

- **Reviewers are read-only; only their own worktree is written.** Each track's
  fixes land in `.worktrees/be-review-<runId>-<track>/`; the branch is touched only
  by the consolidation cherry-picks, which never push or merge.
- **Isolation is structural (cwd-independent).** Workflow agents share the session
  cwd; the orchestrator and both child workflows (`/codex-debate`, `/lens-debate`)
  therefore use `git -C <worktree>` and absolute paths throughout, so a forgotten
  `cd` can't make an agent edit or commit into the wrong tree.
- **Overlap is reconciled, never silently dropped.** A cherry-pick conflict means
  two debates changed the same lines; the orchestrator merges both intents (it
  has both commit messages) and only drops a commit if an earlier track fully
  subsumes it, saying so in the ledger.
- **Cross-track staleness is the known limitation.** Because all three review the
  *same* pre-fix branch HEAD, a track can't see another track's fixes mid-run
  (the price of parallelism). Textual collisions are caught by consolidation;
  residual semantic staleness is backstopped by `/be` §5 CI and human review. If a
  change is small and correctness-critical, the serial `/codex-debate` →
  `/lens-debate` → `/code-police` path is still available and sees each fix fresh.
- **Uncommitted track edits are never silently dropped.** Consolidation replays
  only *committed* commits and Cleanup force-removes the worktrees, so before
  consolidating the orchestrator mechanically checks **every live worktree** with
  `git status --short` — including a track whose gauntlet *crashed*
  (`track-error`), since a crash after edits-applied-but-before-commit is exactly
  when uncommitted work is most likely. Cleanup **fails closed**: only a worktree
  the checker reports *explicitly clean* is torn down; one that left
  uncommitted/untracked edits (a failed commit helper, a formatter touching an
  unlisted file, a mid-run crash) — or that the checker never reported on — is
  **excluded from consolidation and its worktree is preserved**, and surfaced in
  the result so the human can recover it, rather than cherry-picked-around and
  deleted.
- **Parallel-safe — even in the same worktree.** Worktrees live under the
  gitignored `<repoPath>/.worktrees/` as `be-review-<runId>-<track>` and the
  commit-message + PR-comment scratch under the gitignored
  `<repoPath>/.be-review/<runId>/`, where `<runId>` is unique per invocation; each
  track's own `.codex-debate/`/`.lens-debate/` scratch nests inside its worktree.
  All paths are absolute and per-run, so two `/be-review` runs — in different
  worktrees *or the same one* — never clobber each other's live worktrees or
  scratch. Setup never `rm -rf`s a path that could belong to a concurrent run.

## Files

- `be-review.workflow.js` — the orchestrator (worktree fan-out → parallel tracks
  → cherry-pick consolidation → per-track PR comments → cleanup). It invokes
  `.claude/skills/{codex-debate,lens-debate}/debate.workflow.js` as child
  workflows and reads `.claude/skills/code-police/SKILL.md` at runtime.

This is generated from `.apm/skills/be-review/`; edit the source there and run
`just ai::apm` to regenerate.

ARGUMENTS: $ARGUMENTS
