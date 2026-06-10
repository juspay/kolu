---
name: codex-debate
description: Run an automated codex⇄Claude debate to consensus — no round cap, no deadlock exit. Two modes. REVIEW mode (default, code-review): codex (reviewer) critiques the current diff and a Claude subagent (author) fixes/disputes, looping until they agree. ANSWER mode (a freeform prompt arg): Claude and codex each answer the prompt in parallel, then cross-check until they agree, and a unified answer is returned. Use when the user types `/codex-debate`, asks to "have codex review this", "run the codex debate", "review this PR with codex", "argue this with codex until you agree", or passes a question to "have Claude and codex debate/answer until they agree".
argument-hint: "[<pr-number>] [--base <branch>] [--no-commit] [--no-comment]  |  \"<prompt to answer>\""
---

# Codex ⇄ Claude debate

This skill runs an automated debate between **codex** and **Claude** that loops to
consensus with no round cap and no deadlock exit. It has **two modes**, chosen by
the argument:

- **Review mode** (default) — the original behavior. codex reviews the current
  diff, a Claude author fixes/disputes, round after round until they agree, and the
  trail is committed + posted to the PR. This is everything from
  [Review mode](#review-mode) down.
- **Answer mode** — triggered when you pass a **freeform prompt** instead of a PR
  number/flags. Claude and codex **each answer the prompt in parallel**, then
  **cross-check each other** until both agree, and a **unified answer** is returned
  to you (plus a saved transcript). See [Answer mode](#answer-mode).

## Mode detection (do this first)

Parse `$ARGUMENTS`:

- **No args, OR the first non-flag token is a number** (a PR number), OR the only
  args are the review flags (`--base`, `--no-commit`, `--no-comment`) → **review
  mode**. Continue with [Review mode](#review-mode) below.
- **The args are a freeform prompt** (any quoted string, a question, or prose that
  isn't a bare PR number) → **answer mode**. Jump to [Answer mode](#answer-mode);
  the review-mode steps do not apply.

Both modes require Claude Code's **`Workflow` tool** (the engine). Under
codex/opencode runtimes the skill is inert.

<a id="review-mode"></a>
# Review mode — Codex ⇄ Claude review debate

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
- **The reviewer's reasoning effort** — sourced from the workflow's single
  `REASONING_EFFORT` constant (`xhigh` today), which is passed down to
  `codex-review.sh`'s `-c model_reasoning_effort` and into the comment header, so
  the published value and the config codex actually ran at share one home. Read
  it off the header rather than asserting it independently. State it so the depth
  of the review is on the record.
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
  header (consensus badge, round count, the **reasoning-effort** note from the
  workflow's `REASONING_EFFORT` constant) followed by the per-round breakdown of
  codex's findings and Claude's dispositions
  that the author also read. So the comment is a **deterministic** render of the
  same record the commit messages and the author drew on — not an LLM-improvised
  table. Posting the returned string mirrors `/lens-debate`. This is an
  outward-facing write — on by default because the whole point is to leave the
  review trail on the PR; `--no-comment` suppresses it.

<a id="answer-mode"></a>
# Answer mode — Codex ⇄ Claude answer debate

When the argument is a **freeform prompt** (not a PR number/flags), the skill
generalizes the same debate machinery from *reviewing a diff* to *answering a
question*. The shape is **symmetric**, not author⇄reviewer: **Claude and codex are
two equal peers**. They each answer the prompt **independently and in parallel**,
then **cross-check each other's answer** round after round — conceding where the
other is right, holding firm (with evidence) where it isn't — **until both agree**.
A final pass **synthesizes their two converged answers into one unified reply**,
which you present to the user along with a saved transcript.

Both peers are **codebase-aware but read-only**: each may read this repo (`git
diff/log`, read files, grep) to ground its answer, but neither edits anything —
codex stays under `--sandbox read-only` (kernel-enforced), and the Claude peer is
instructed not to write. Consensus is **schema-detected in code**: each side emits
a structured answer with an `agreesWithOther` boolean and an `objections` list, and
the loop ends only when **both** sides report no remaining disagreement. There is
**no round cap and no deadlock exit** — same as review mode.

## Steps

### A1. Resolve context

- Determine `repoPath` (the worktree root, normally the cwd).
- Capture the **prompt**: everything in `$ARGUMENTS` (strip surrounding quotes). If
  it's empty, ask the user what they want answered and stop.
- **Preflight codex**: `codex login status`. If not logged in, stop and tell the
  user to run `codex login` (suggest the `!` prefix to do it in-session).
- No `git fetch` / base resolution / `gh pr checkout` here — answer mode doesn't
  diff a branch.

### A2. Run the answer Workflow

Invoke the **`Workflow` tool** pointing at this skill's committed answer script,
passing the prompt through `args`:

```
Workflow({
  scriptPath: ".claude/skills/codex-debate/answer.workflow.js",
  args: {
    repoPath: "<worktree root>",   // also the per-worktree scratch dir root
    prompt: "<the user's freeform prompt, verbatim>",
    skillDir: ".claude/skills/codex-debate"
  }
})
```

The workflow runs in the background and notifies you when it completes. It runs an
**Answer** phase (round 1: `claude:round1` and `codex:round1` in parallel), a
**Reconcile** phase (rounds 2+: each side cross-checks the other, in parallel,
round after round), and a **Synthesis** phase that merges the two agreed answers.
Watch live via `/workflows`. Ephemeral scratch (per-side answers, cross-check
files, per-round sections, the saved transcript) lives under the gitignored,
per-worktree `<repoPath>/.codex-debate/`, so parallel debates never collide. It
returns:

```
{ status: "consensus" | "reviewer-error" | "agent-error" | "no-prompt",
  rounds, prompt, finalAnswer, transcriptPath, reasoningEffort, codexError }
```

- **consensus** — the only normal terminus: both sides agreed, and `finalAnswer`
  is the synthesized unified answer. `transcriptPath` points at the saved
  Markdown transcript (`.codex-debate/answer-<slug>.md`).
- **reviewer-error** — codex itself failed to produce an answer (broken/unavailable
  CLI) after retries; `codexError` carries the failure detail. Infrastructure
  failure, not a debate outcome.
- **agent-error** — one side died on a terminal API error after retries.
- **no-prompt** — the prompt was empty (shouldn't happen if A1 guarded it).

### A3. Present the result

- If `status === "consensus"`: present **`finalAnswer`** to the user as the answer
  — this is the unified reply both Claude and codex agreed on. State **how many
  rounds** it took to converge and that **codex answered at `reasoningEffort`**
  (read it off the return value). Point the user at the saved transcript
  (`transcriptPath`) for the full convergence trail; optionally `cat` the
  `.codex-debate/answer-section-*.md` files to show a compact per-round summary
  (each side's answer, what changed, remaining objections). This mode makes **no
  outward-facing writes** — no PR comment, no commits — it just answers.
- If `status !== "consensus"`: report it as a **failure**, not an answer. Surface
  `codexError` (for `reviewer-error`) or the workflow log so the user sees what
  broke, and tell them how to fix it (e.g. `codex login`) and re-run. Do **not**
  present a half-debate as if it were an agreed answer.

## Answer-mode safety & notes

- **Both peers read-only.** codex runs under `--sandbox read-only` (kernel-
  enforced, belt-and-suspenders with the prompt text — it reads arbitrary repo
  files and could be prompt-injected); the Claude peer is instructed to read but
  never edit. No mode of this debate writes to the repo.
- **Warm codex session.** Round 1 cold-starts `codex exec`; every later round
  resumes the same session (`codex exec resume`) so codex cross-checks from its own
  prior answer rather than reconstructing it. The session id lives in the
  gitignored per-worktree `.codex-debate/` (a distinct `codex-answer-session.id`,
  so it never collides with review mode's session), degrading gracefully to a cold
  start if capture ever fails.
- **Symmetric convergence, schema-detected.** Each side emits `agreesWithOther` +
  `objections`; the loop ends only when both sides agree, with no round cap and no
  deadlock exit. Because the two run in parallel each round, agreement is on the
  prior round's answers — safe (it only ever ends on real agreement), at worst one
  round later than a serial handoff.
- **Chat + saved transcript, no outward writes.** The unified answer is presented
  in chat and the full transcript is saved to the gitignored
  `.codex-debate/answer-<slug>.md`. Unlike review mode, answer mode never commits
  or posts to a PR.

## Safety & notes (review mode)

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

Review mode:

- `debate.workflow.js` — the Workflow script (the loop + consensus logic).
- `scripts/codex-review.sh` — the canonical, deterministic `codex exec` invocation
  (cold-starts round 1, `codex exec resume`s the warm session thereafter).
- `scripts/codex-verdict.schema.json` — the JSON Schema codex's verdict is constrained to.

Answer mode:

- `answer.workflow.js` — the Workflow script for the symmetric answer-debate
  (parallel answers → cross-check loop to agreement → synthesis).
- `scripts/codex-answer.sh` — the canonical, deterministic `codex exec` invocation
  for answering a prompt as a read-only peer (warm session across cross-check rounds).
- `scripts/codex-answer.schema.json` — the JSON Schema codex's answer is constrained to.

These are generated from `.apm/skills/codex-debate/`; edit the source there and
run `just ai apm` to regenerate.

ARGUMENTS: $ARGUMENTS
