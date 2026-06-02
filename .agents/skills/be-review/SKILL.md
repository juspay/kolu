---
name: be-review
description: Run /be's review gauntlet in PARALLEL — codex⇄claude, lowy⇄hickey, and code-police each debate to consensus in their own git worktree at the same time, then consolidate the per-track commits onto the branch (the rare overlap is reconciled) and post a detailed PR comment per track. Use from /be §4, or when the user asks to "run the review gauntlet in parallel". Requires Claude Code's Workflow tool.
argument-hint: "[--base <branch>] [--tracks codex,lens,police] [--no-commit] [--no-comment]"
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
(gitignored) — `.worktrees/be-review-<track>`. **Isolation is structural, not
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
  (`fix(police):`). Per-finding `just check` is **deferred** to the
  post-consolidation check + `/be` §5 CI rather than run 3× concurrently across
  the parallel worktrees; `fmt`-on-touched-files still runs in each apply.

## Arguments

- **`--base <branch>`**: remote-tracking ref to diff against (e.g. `origin/master`).
  Default the repo default via `git symbolic-ref --short refs/remotes/origin/HEAD`.
- **`--tracks codex,lens,police`**: which tracks to run *and the order they
  consolidate in*. Default all three; codex first (it changes the most), police
  last (lightest touch), so an overlap surfaces picking the later track.
- **`--no-commit`**: leave each track's fixes uncommitted for inspection
  (debugging a single track). Consolidation cherry-picks per-track *commits*, so
  with this flag the orchestrator **skips Consolidate + Report + Cleanup and
  preserves the worktrees** (status `no-commit`) — leaving every track's worktree
  in place under `.worktrees/be-review-<track>/` (the branch is untouched) rather
  than silently discarding the uncommitted edits; inspect and tear them down
  yourself. Default is to commit, which is what actually ships fixes.
- **`--no-comment`**: suppress the PR comments. By default the **Report** phase
  posts a detailed PR comment per track (codex debate table, lens per-finding
  ledger, police findings) plus the consolidation ledger — the review trail the
  gauntlet exists to leave. This flag reports in chat only.

## Steps

### 1. Resolve context

- Determine `repoPath` (the worktree root, normally the cwd).
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
    rationale: "<optional author note on deliberate decisions>",
    tracks: ["codex", "lens", "police"],   // also the consolidation order
    commit: <false only if --no-commit>,
    comment: <false only if --no-comment>
  }
})
```

It runs five phases the user can watch via `/workflows`: **Setup** (fan out one
detached worktree per track under `.worktrees/`), **Tracks** (the three gauntlets
run concurrently to consensus), **Consolidate** (cherry-pick each track's commits
onto the branch, reconciling overlap), **Report** (post a detailed PR comment per
track + the consolidation ledger), **Cleanup** (tear down the worktrees). It
returns:

```
{ status,                  // 'done' | 'no-commit' | 'setup-failed'
  branchHead, finalHead, base, order,
  tracks,                  // per-track result; ALWAYS one entry per requested track —
                           //   a track whose worktree setup failed is status:'track-error'
  consolidation,           // { finalHead, picks[] }  (null when not consolidated)
  conflicts,               // the reconciled overlaps (picks whose outcome ≠ clean; empty common case)
  comments }               // { codex, lens, police } → posted comment URLs ({} under --no-comment)
```

- `setup-failed` — no work was consolidated: a dirty main worktree (commit/stash
  and re-run) or no worktree could be created. `tracks` carries the per-track
  `track-error` detail.
- `no-commit` — `--no-commit` was set, so each track's fixes are left
  **uncommitted in its preserved `.worktrees/be-review-<track>` worktree** and
  nothing is consolidated, reported, or cleaned up. The result lists those
  `worktrees` to inspect; re-run with commit enabled to actually consolidate.
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
  fixes land in `.worktrees/be-review-<track>/`; the branch is touched only by the
  consolidation cherry-picks, which never push or merge.
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
- **Parallel-safe.** Worktrees live under the gitignored `<repoPath>/.worktrees/`
  and commit-message + PR-comment scratch under the gitignored
  `<repoPath>/.be-review/`; each track's own `.codex-debate/`/`.lens-debate/`
  scratch nests inside its worktree. All paths are absolute and
  per-main-worktree, so parallel `/be-review` runs never collide.

## Files

- `be-review.workflow.js` — the orchestrator (worktree fan-out → parallel tracks
  → cherry-pick consolidation → per-track PR comments → cleanup). It invokes
  `.claude/skills/{codex-debate,lens-debate}/debate.workflow.js` as child
  workflows and reads `.claude/skills/code-police/SKILL.md` at runtime.

This is generated from `.apm/skills/be-review/`; edit the source there and run
`just ai::apm` to regenerate.

ARGUMENTS: $ARGUMENTS
