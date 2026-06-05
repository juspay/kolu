---
name: codex-debate
description: Run an automated code-review debate between the codex CLI (reviewer) and a Claude subagent (author) on the current diff, looping until they reach consensus — no round cap, no deadlock exit. Use when the user types `/codex-debate`, or asks to "have codex review this", "run the codex debate", "review this PR with codex", or "argue this with codex until you agree".
argument-hint: "[<pr-number>] [--base <branch>] [--no-commit] [--no-comment]"
---

# Codex ⇄ Claude review debate

Automate the back-and-forth you'd otherwise courier by hand: **codex** (the
reviewer) critiques the current change, a **Claude subagent** (the author)
fixes what it agrees with and disputes what it doesn't, codex re-reviews, and so
on — round after round, **until they reach consensus**. codex reviews from a
**warm session**: round 1 cold-starts the reviewer, and every later round
*resumes that same codex session* (`codex exec resume`), so codex carries its own
prior review and reasoning forward instead of reconstructing it from the diff +
rebuttal each round — when Claude disputes a finding, codex argues from its
original rationale. There is no round cap and
no "deadlock" surrender: a debate that quits without agreement defeats the
purpose, so the two sides keep arguing until one concedes. You stay out of the
middle: each round lands as its own commit whose
message carries the debate context (codex's findings + Claude's dispositions) so
the PR history reads as the debate, and the summary is **posted to the PR** as a
comment at the end.

## Why this shape

The two sides are asymmetric, and that asymmetry is the whole design:

- **codex** is CLI-invokable headlessly (`codex exec`, authed via ChatGPT), so it
  runs from a shell command.
- **Claude on a Max plan is *not* headless** — `claude -p` doesn't work with Max
  auth. But the **Workflow tool's `agent()` spawns Claude subagents through the
  harness**, not `claude -p`, so it works. That subagent is the author side.

So the debate runs as a Workflow: `agent()` is Claude, a Bash-invoked
`codex exec` is the reviewer, and the script couriers structured verdicts
between them and decides when they agree. Both sides are forced to emit
schema-constrained JSON, so consensus is detected in code, not by vibes.

**This skill requires Claude Code's `Workflow` tool** (it is the engine). Under
codex/opencode runtimes the skill is inert.

## Arguments

Parse `[<pr-number>] [--base <branch>] [--no-commit] [--no-comment]`:

- **`<pr-number>`** (optional): a PR to debate. If given, `gh pr checkout <n>`
  first and default the base to that PR's base branch. If omitted, debate the
  **current branch's** working-tree diff.
- **`--base <branch>`**: ref to diff against. Always a **remote-tracking ref**, never
  a stale local branch. Default: `origin/<PR base>` when a PR number is given, else
  the repo default branch as `git symbolic-ref --short refs/remotes/origin/HEAD`
  (e.g. `origin/master`) — used **as-is**, NOT stripped to local `master` (which
  can lag the remote). Fallback `origin/master`. Step 1 runs `git fetch origin`
  first so the ref is current. The workflow then resolves this to the **merge-base**
  of `base` and HEAD and diffs against that, so commits `base` gained since the
  branch forked aren't reviewed as part of this change.
- **`--no-commit`**: don't commit per round — leave all agreed changes
  uncommitted in the working tree for you to commit yourself. Default is to
  **commit each round** (see below).
- **`--no-comment`**: don't post the debate summary to the PR. By **default**, when
  a PR exists, the debate summary IS posted as a PR comment (see step 3). Pass
  this to suppress the outward-facing write and report in chat only.

## Steps

### 1. Resolve context

- Determine `repoPath` (the worktree root, normally the cwd).
- **`git fetch origin`** so remote-tracking refs are current — the base is an
  `origin/...` ref, and a stale one would diff against the wrong tree.
- Resolve `base` per the rules above (a remote-tracking ref like `origin/master`).
- If a PR number was given, `gh pr checkout <n>` and confirm the branch.
- Confirm there is a non-empty diff: `git diff --stat <base>`. If empty, tell the
  user there's nothing to review and stop.
- **Preflight codex**: `codex login status`. If not logged in, stop and tell the
  user to run `codex login` (suggest the `!` prefix to do it in-session).

### 2. Run the debate Workflow

Invoke the **`Workflow` tool** pointing at this skill's committed script, passing
context through `args`:

```
Workflow({
  scriptPath: ".claude/skills/codex-debate/debate.workflow.js",
  args: {
    repoPath: "<worktree root>",        // also the per-worktree scratch dir root
    base: "<base branch>",
    commit: <false only if --no-commit>,
    skillDir: ".claude/skills/codex-debate"
  }
})
```

The workflow runs in the background and notifies you when it completes. It
alternates `codex:roundN` and `claude:roundN` agents under a **Debate** phase —
the user can watch live via `/workflows`. Each Claude round edits the working
tree, then (unless `--no-commit`) a `commit:roundN` agent **commits exactly that
round's changed files** with a message embedding the round's codex findings and
Claude's dispositions — never pushing or merging.

Ephemeral scratch (verdicts, rebuttals, the debate ledger) lives under the
gitignored, per-worktree `<repoPath>/.codex-debate/`, so **parallel debates in
different worktrees never collide** and the scratch never shows up in the diff
codex reviews. It returns:

```
{ status: "consensus" | "reviewer-error",
  rounds, base, finalVerdict, filesChanged, transcript,
  comment }    // the deterministically rendered PR comment body — post it VERBATIM (step 3)
```

(each `transcript[]` round also carries a `commit` SHA when that round committed.)
The debate is recorded as **one small Markdown file per round** —
`<workDir>/section-NNN.md` (zero-padded). Those section files are the **Claude
author's cross-round memory** (so each round builds on the last instead of
re-deriving the diff). The workflow renders the **same** record into `comment` —
the outcome header followed by every round's section — so **step 3 just posts that
string** (`gh pr comment -F`), exactly the way `/lens-debate` does. The comment is
therefore a **deterministic** render, never re-improvised through an agent —
nothing weak ever retypes a large blob. codex is *not* a reader — it keeps its own
warm session, so re-feeding it the sections would just duplicate its context.

- **consensus** — every finding codex raised is resolved (any severity — Claude
  fixed it or codex conceded the dispute). This is the *only* way the debate ends
  *normally*: it keeps running rounds until codex and Claude agree on every point,
  with no round cap and no deadlock exit. (The harness's own
  per-workflow agent backstop is the sole hard ceiling; if you ever need to stop
  a debate by hand, interrupt it via `/workflows` or `TaskStop`.)
- **reviewer-error** — the one *abnormal* terminus: codex itself failed to
  produce a verdict (broken/unavailable CLI), so the workflow synthesized an
  error verdict and aborted rather than spin forever on a dead reviewer. This is
  **infrastructure failure, not a debate outcome** — `finalVerdict.summary`
  carries the failure detail (including how many attempts were made). Do **not**
  treat it as consensus (see step 3). **Transient failures are retried first:**
  `codex-review.sh` retries the `codex exec` invocation with linear backoff
  (default 3 attempts; tune via `CODEX_REVIEW_RETRIES` / `CODEX_REVIEW_BACKOFF`)
  and only synthesizes the reviewer-error verdict once every attempt comes back
  empty — so a single codex hiccup no longer sinks the round.

### 3. Present the result

**First branch on `status`.** If `status === "reviewer-error"`, the debate did
**not** reach consensus — codex never produced a real verdict. Report it as a
**failure**, not a success: surface `finalVerdict.summary` (and the workflow log)
so the user sees codex was broken/unavailable, and tell them to fix codex (e.g.
`codex login`, check the CLI) and re-run. Do **not** post a consensus badge or a
`## Codex ⇄ Claude debate` PR comment for this path — there is no agreement to
report. Skip the rest of this section.

Otherwise (`status === "consensus"`) report in chat (do **not** push or merge —
the per-round commits sit on the local branch for the human to review):

- The outcome — **consensus** — and how many rounds it took to get there.
- **The reviewer's reasoning effort: codex runs at `xhigh`** (scoped to the
  debate via `-c model_reasoning_effort=xhigh` in `codex-review.sh`, regardless
  of the user's global codex default). State this so the depth of the review is
  on the record.
- `git log --oneline <base>..HEAD` (the per-round debate commits) and
  `git diff --stat <base>` so the user sees what the debate changed.
- A compact per-round summary — read it straight from the section files
  (`cat <workDir>/section-*.md`: each round's codex verdict, Claude's
  dispositions, and the commit SHA) so the convergence reads round by round. No
  need to re-derive it from `transcript`; the sections already render it.
- The agreed changes are committed per round on the local branch (or, under
  `--no-commit`, uncommitted in the working tree). The user reviews, then pushes
  / merges (or runs `/do --from post-implement`) when satisfied.
- **Post the debate summary to the PR (default).** When a PR exists and
  `--no-comment` was NOT passed, post the workflow's **deterministically rendered
  `comment`** verbatim — write it to a file and `gh pr comment <pr> -F <file>`:

  ```bash
  mkdir -p "$repoPath/.codex-debate"   # reviewer-error/--no-commit runs may not have created it
  printf '%s' "$comment" > "$repoPath/.codex-debate/comment.md"
  gh pr comment <pr> -F "$repoPath/.codex-debate/comment.md"
  ```

  The workflow returns `comment` already rendered — the `## Codex ⇄ Claude debate`
  header (consensus badge, round count, the **`xhigh` reasoning-effort** note)
  followed by the per-round breakdown of codex's findings and Claude's dispositions
  that the author also read. So the comment is a **deterministic** render of the
  same record the commit messages and the author drew on — not an LLM-improvised
  table. Posting the returned string mirrors `/lens-debate`. This is an
  outward-facing write — on by default because the whole point is to leave the
  review trail on the PR; `--no-comment` suppresses it.

## Safety & notes

- **codex runs read-only — enforced, not just asked.** codex is invoked with
  `--sandbox read-only`, so the kernel sandbox blocks file writes and other
  state-mutating syscalls; the prompt's "don't write" instruction is belt-and-
  suspenders, not the only guard. This matters because codex reviews arbitrary
  diffs and could be prompt-injected by file contents. The only writes to the
  tree come from the Claude author rounds. (codex auto-falls-back to its bundled
  bubblewrap when the system one is absent, so read-only works in containers.)
  Resume rounds enforce the same read-only policy via `-c sandbox_mode=read-only`
  (the `resume` subcommand has no `--sandbox` flag) — same kernel guard, set
  through config instead of the flag.
- **Warm reviewer session.** Round 1 cold-starts `codex exec`; the runner records
  codex's session id (its `thread_id`, captured from the `--json` event stream)
  under the scratch dir and every later round `codex exec resume`s it, so codex
  retains its own prior review across rounds. The session id lives in the
  gitignored per-worktree `.codex-debate/`, so parallel debates never resume each
  other's sessions. If the id is ever missing (round-1 capture failed), a later
  round transparently cold-starts with the full prompt + rebuttal — graceful
  degradation, never a wedge.
- **Warm author (context, not session).** The Claude author can't be resumed the
  way codex is — `agent()` is one-shot and Claude isn't headless under Max auth,
  so there's no session id to carry forward. The equivalent is context, not state:
  each follow-up round the author **reads the per-round section files**
  (`cat .codex-debate/section-*.md`) — every prior round's findings and its own
  dispositions — so it builds on its last round rather than re-deriving the whole
  diff, and won't re-fix or re-litigate findings already settled. A small section
  is written after each round, so round N>1 always sees rounds 1..N-1; round 1 has
  none yet, so it's byte-identical to a cold start (and if no sections exist, the
  author falls back to the diff + verdict). The *same* sections compose the PR
  comment step 3 posts, so the author's memory and the published summary are one
  record. The writes stay small (one round each), so the Haiku writer never
  retypes a large blob. codex stays on its own warm session and never reads them.
- **Commits, but never pushes or merges.** Each round is committed locally (unless
  `--no-commit`) so the PR history reads as the debate, but the skill never
  pushes or merges. Consensus means "both AIs agree on the committed code," not
  "ship it" — the human reviews the commits and pushes/merges.
- **Parallel-safe.** Ephemeral scratch (verdicts, rebuttals, the per-round
  sections) lives under the gitignored, per-worktree `<repoPath>/.codex-debate/`,
  so debates on many worktrees run at once without clobbering each other — no
  shared `/tmp` paths, and each worktree's section files are its own.
- **Posts to the PR by default.** When a PR exists, the debate summary — the
  workflow's deterministically rendered `comment` (header + per-round sections) —
  is posted as a PR comment (outward-facing write) unless `--no-comment` is passed
  — the point is to leave the review trail on the PR.
- **Runs to consensus — no cap, no deadlock exit.** The loop ends only when codex
  and Claude agree; it does not bail out at a round cap or declare a "deadlock," because
  a debate that quits without agreement is pointless. The two sides keep arguing
  until one concedes. The harness's own per-workflow agent backstop is the sole
  hard ceiling; interrupt via `/workflows` or `TaskStop` if you ever need to stop
  one by hand.

## Files

- `debate.workflow.js` — the Workflow script (the loop + consensus logic).
- `scripts/codex-review.sh` — the canonical, deterministic `codex exec` invocation
  (cold-starts round 1, `codex exec resume`s the warm session thereafter).
- `scripts/codex-verdict.schema.json` — the JSON Schema codex's verdict is constrained to.

These are generated from `.apm/skills/codex-debate/`; edit the source there and
run `just ai apm` to regenerate.

ARGUMENTS: $ARGUMENTS
