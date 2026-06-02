---
name: be-review
description: Run /be's review gauntlet in PARALLEL — codex⇄claude, lowy⇄hickey, and code-police each debate to consensus in their own git worktree at the same time, then consolidate the per-track commits onto the branch (the rare overlap is reconciled). Use from /be §4, or when the user asks to "run the review gauntlet in parallel". Requires Claude Code's Workflow tool.
argument-hint: "[--base <branch>] [--tracks codex,lens,police] [--no-commit]"
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
            ┌─ wt-codex   ─ codex⇄claude debate ─→ commits ─┐
branch HEAD ┼─ wt-lens    ─ lowy⇄hickey debate  ─→ commits ─┼─→ cherry-pick onto branch
            └─ wt-police  ─ rules/fact/elegance ─→ commits ─┘   (overlap → reconcile)
```

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
  (`fix(police):`). Per-finding `just check` is **deferred** to the
  post-consolidation check + `/be` §5 CI rather than run 3× concurrently across
  the parallel worktrees; `fmt`-on-touched-files still runs in each apply.

## Arguments

- **`--base <branch>`**: remote-tracking ref to diff against (e.g. `origin/master`).
  Default the repo default via `git symbolic-ref --short refs/remotes/origin/HEAD`.
- **`--tracks codex,lens,police`**: which tracks to run *and the order they
  consolidate in*. Default all three; codex first (it changes the most), police
  last (lightest touch), so an overlap surfaces picking the later track.
- **`--no-commit`**: leave each track's fixes uncommitted (debugging a single
  track); default is to commit, since consolidation cherry-picks those commits.

## Steps

### 1. Resolve context

- Determine `repoPath` (the worktree root, normally the cwd).
- `git fetch origin` so the base remote-tracking ref is current.
- Resolve `base` (a remote-tracking ref like `origin/master`).
- Confirm a non-empty diff: `git diff --stat <base>`. If empty, stop.
- **Preflight codex** (unless `--tracks` excludes it): `codex login status`. If
  not logged in, tell the user to run `codex login` (suggest the `!` prefix).

### 2. Run the orchestrator Workflow

```
Workflow({
  scriptPath: ".claude/skills/be-review/be-review.workflow.js",
  args: {
    repoPath: "<worktree root>",
    base: "<base branch>",                 // remote-tracking ref, e.g. origin/master
    rationale: "<optional author note on deliberate decisions>",
    tracks: ["codex", "lens", "police"],   // also the consolidation order
    commit: <false only if --no-commit>
  }
})
```

It runs four phases the user can watch via `/workflows`: **Setup** (fan out one
detached worktree per track), **Tracks** (the three gauntlets run concurrently to
consensus), **Consolidate** (cherry-pick each track's commits onto the branch,
reconciling overlap), **Cleanup** (tear down the worktrees). It returns:

```
{ status,                  // 'done' | 'setup-failed'
  branchHead, finalHead, base, order,
  tracks,                  // per-track result (codex/lens consensus, police findings/applied)
  consolidation,           // { finalHead, picks[], conflicts[] }
  conflicts }              // the overlaps reconciled (empty in the common case)
```

### 3. Present the result

Report in chat and post **one** consolidated PR comment (this replaces the three
separate per-reviewer comments): a `## Review gauntlet (parallel)` section with,
per track, its outcome (codex consensus + rounds, lens consensus + per-finding
table, police findings actioned); then the **consolidation ledger** — each
cherry-picked commit and its outcome (`clean`/`reconciled`/`dropped`), with any
overlap reconciliation explained. Then `git log --oneline <base>..HEAD` and
`git diff --stat <base>` so the user sees the combined result. Never push or
merge — the human reviews the per-track commits and merges.

## Safety & notes

- **Reviewers are read-only; only their own worktree is written.** Each track's
  fixes land in `.be-review/wt-<track>/`; the branch is touched only by the
  consolidation cherry-picks, which never push or merge.
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
- **Parallel-safe.** Worktrees + scratch live under the gitignored, per-worktree
  `<repoPath>/.be-review/`; each track's own `.codex-debate/`/`.lens-debate/`
  scratch nests inside its worktree.

## Files

- `be-review.workflow.js` — the orchestrator (worktree fan-out → parallel tracks
  → cherry-pick consolidation → cleanup). It invokes
  `.claude/skills/{codex-debate,lens-debate}/debate.workflow.js` as child
  workflows and reads `.claude/skills/code-police/SKILL.md` at runtime.

This is generated from `.apm/skills/be-review/`; edit the source there and run
`just ai::apm` to regenerate.

ARGUMENTS: $ARGUMENTS
