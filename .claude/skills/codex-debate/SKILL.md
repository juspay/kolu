---
name: codex-debate
description: 'Run an automated codex⇄Claude debate to consensus within a tight round backstop — disagreement that survives the backstop is surfaced honestly as `unresolved`, never papered over. Two explicit subcommands. `review` (also the bare/back-compat default) — codex (reviewer) critiques the current diff and a Claude subagent (author) fixes/disputes, looping until they agree or the backstop hits. `answer` — Claude and codex each answer a freeform prompt in parallel, then cross-check until they agree, and a unified answer is returned. Use when the user types `/codex-debate`, asks to "have codex review this", "run the codex debate", "review this PR with codex", "argue this with codex", or passes a question to "have Claude and codex debate/answer it".'
argument-hint: "review [<pr-number>] [--base <branch>] [--max-rounds <n>] [--no-commit] [--no-comment]  |  answer \"<prompt>\""
---

# Codex ⇄ Claude debate

This skill runs an automated debate between **codex** and **Claude** that loops to
consensus within a **tight round backstop** — disagreement that survives the
backstop ends as `unresolved`, surfaced honestly for a human, never papered over
as agreement. It has **two modes**, selected by an **explicit leading
subcommand** — never by guessing from the argument's shape:

- **`review`** — codex reviews the current diff, a Claude author fixes/disputes,
  round after round until they agree, and the trail is **committed + posted to the
  PR** (a mutating, outward-facing mode). This is everything from
  [Review mode](#review-mode) down.
- **`answer`** — Claude and codex **each answer a freeform prompt in parallel**,
  then **cross-check each other** until both agree, and a **unified answer** is
  returned to you (read-only; plus a saved transcript). See
  [Answer mode](#answer-mode).

The two modes have **different side-effect contracts** (review mutates + writes to
the PR; answer is read-only), so the mode is chosen **explicitly**, not inferred
from whether the argument looks like a PR number or like prose. Inferring a
mutating action from prose shape is exactly the coupling this design avoids.

## Mode detection (do this first)

Look at the **first whitespace-delimited token** of `$ARGUMENTS`:

- **`answer`** → **answer mode**. The prompt is everything after the `answer`
  token. Jump to [Answer mode](#answer-mode); the review-mode steps do not apply.
- **`review`** → **review mode**. The remaining args are the review grammar
  (`[<pr-number>] [--base …] [--max-rounds <n>] [--no-commit] [--no-comment]`).
  Continue with [Review mode](#review-mode).
- **No args, OR the first token is a number (a PR number) or a `--flag`** →
  **review mode** (the backward-compatible bare alias for the original
  `/codex-debate [<pr>] [flags]`, so existing callers like `/be-review` keep
  working). Continue with [Review mode](#review-mode).
- **Anything else** (freeform prose with no recognized subcommand) → **ambiguous**.
  Do **not** guess — ask the user to pick an explicit mode and stop, e.g.: "Did you
  mean `/codex-debate answer \"<your prompt>\"` (read-only) or `/codex-debate review
  [<pr>] [flags]` (mutating)?" Only the safe, backward-compatible review grammar
  auto-routes; prose never silently triggers a mode.

Both modes require Claude Code's **`Workflow` tool** (the engine). Under
codex/opencode runtimes the skill is inert.

<a id="review-mode"></a>
# Review mode — Codex ⇄ Claude review debate

Automate the back-and-forth you'd otherwise courier by hand: **codex** (the
reviewer) critiques the current change, a **Claude subagent** (the author)
fixes what it agrees with and disputes what it doesn't, codex re-reviews, and so
on — round after round, **until they reach consensus or the round backstop
(default 3) hits**. codex reviews from a
**warm session**: round 1 cold-starts the reviewer (at `xhigh` reasoning effort;
follow-up rounds drop to `high` — they only close out findings already on the
table), and every later round
*resumes that same codex session* (`codex exec resume`), so codex carries its own
prior review and reasoning forward instead of reconstructing it from the diff +
rebuttal each round — when Claude disputes a finding, codex argues from its
original rationale. The backstop is **not** a "deadlock surrender": quitting
without agreement *and pretending otherwise* is what defeats a debate. A run
that hits the backstop ends as **`unresolved`** with the still-open findings
attached — genuine disagreement surfaced to a human is the correct output of a
debate that didn't converge, and strictly better than more rounds of two models
wearing each other down (debate gains saturate by round 2 and extra rounds
amplify wrong consensus; see the `review-orchestration` Atlas note — kolu#1222
is the in-house runaway the backstop prevents). Concessions are **cited** on
both sides, and the citation is **mechanically enforced by the workflow**, not
merely asked for. A single persistent per-finding gate holds a finding OPEN
whenever a citation is outstanding from EITHER side — regardless of codex's
reported `status`, so it can't count toward consensus and ends `unresolved` if
the citation never arrives:

- **Author side:** an **uncited** Claude flip (`disputed` → `fixed`/`partial`
  with no `concessionReason`) sets a durable debt on that finding id. The debt
  persists across rounds until Claude cites what convinced it or reverts to
  `disputed` — dropping the action or holding the flipped position does **not**
  launder it.
- **Reviewer side:** codex's `concession` is `required` in its `--output-schema`,
  but `required` only enforces a string's *presence*, not that it's *non-empty
  when codex resolves by accepting a dispute* (a cross-field condition no JSON
  Schema can state). So the workflow gates this semantically too: a finding codex
  marks `resolved` whose accepted author disposition is `disputed` and whose
  `concession` is empty is an uncited reviewer concession, held open the same way.

Consensus therefore can't be manufactured by capitulation. You stay out of the
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

A leading `review` subcommand token, if present, is consumed by mode detection;
what remains is `[<pr-number>] [--base <branch>] [--max-rounds <n>] [--no-commit]
[--no-comment]` (the bare alias passes the whole argument string through
unchanged). Parse:

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
- **`--max-rounds <n>`**: the round backstop. Default **3** — deliberately tight
  (gains saturate by round 2; what's still open at the backstop is a real
  judgment call that goes to a human as `unresolved`, not to more rounds).
  Raise it only with a specific reason to expect late convergence.
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
    maxRounds: <n, default 3>,
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
{ status: "consensus" | "unresolved" | "reviewer-error",
  rounds, base, finalVerdict,
  unresolved,  // still-open findings on an `unresolved` exit (empty otherwise) — the adjudication worklist
  filesChanged, transcript,
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
  fixed it or codex conceded the dispute, citing why). The normal terminus.
- **unresolved** — the round backstop (default 3) was hit with findings still
  open. A *real debate outcome*, surfaced honestly: the still-open findings ride
  the `unresolved` field for a human (or the calling `/be-review`) to
  adjudicate. Never report it as consensus — and never treat it as a failure to
  hide: the per-round commits and the comment record exactly where the two
  sides genuinely disagree.
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

If `status === "unresolved"`, the backstop was hit with findings still open —
a real outcome, not an error. Surface the `unresolved` findings plainly so the
human (or the calling `/be-review`) can adjudicate each one: decide fix or drop,
apply the survivors. Then continue with the reporting below — the comment's
`⚠️ unresolved` badge and per-round sections are exactly the trail the
adjudicator needs, so it **is** posted (unlike reviewer-error, there is a
genuine debate to report).

Otherwise (`status === "consensus"`) report in chat (do **not** push or merge —
the per-round commits sit on the local branch for the human to review):

- The outcome — **consensus** — and how many rounds it took to get there.
- **The reviewer's reasoning effort** — sourced from the workflow's effort
  constants (tiered: `xhigh` round 1, `high` thereafter), which are passed down
  per round to `codex-review.sh`'s `-c model_reasoning_effort` and rendered into
  the comment header, so the published value and the config codex actually ran
  at share one home. Read it off the header rather than asserting it
  independently. State it so the depth of the review is on the record.
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
  header (outcome badge, round count, the **reasoning-effort** note from the
  workflow's tiered effort constants, rendered via `REASONING_EFFORT_LABEL`:
  `xhigh` round 1, `high` thereafter) followed by the per-round breakdown of
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
the loop ends only when **both** sides report no remaining disagreement — within a
round backstop (default 6, counting the confirmation turns; a candidate
synthesized on the final in-budget round still gets its one confirmation turn),
past which the run ends `unresolved` and is reported as such, never as an agreed
answer. The debaters are additionally *instructed* (prompt-enforced — the loop
does not check it, since a side can legitimately reach agreement because the
*other* side moved) that moving to agreement after disagreeing requires a
non-empty `changedMind` citing what convinced them — the same cited-concession
discipline as review mode.

## Steps

### A1. Resolve context

- Determine `repoPath` (the worktree root, normally the cwd).
- Capture the **prompt**: everything **after the `answer` subcommand token** (strip
  surrounding quotes). If it's empty, ask the user what they want answered and stop.
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
    maxRounds: 6,                  // the answer-mode backstop — no CLI flag; override here only with reason
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
{ status: "consensus" | "unresolved" | "reviewer-error" | "agent-error" | "synthesis-error" | "no-prompt",
  rounds, prompt, finalAnswer, transcriptPath, reasoningEffort, codexError }
```

- **consensus** — the normal terminus: both sides agreed and then both
  **approved the synthesized candidate** (see the convergence note), and
  `finalAnswer` is that approved unified answer. `transcriptPath` points at the saved
  Markdown transcript (`.codex-debate/answer-<slug>.md`).
- **unresolved** — the round backstop was hit without a both-sides-approved
  candidate. Not an agreed answer: present both sides' final positions (from the
  transcript) and where they still differ, so the user adjudicates.
- **reviewer-error** — codex itself failed to produce an answer (broken/unavailable
  CLI) after retries; `codexError` carries the failure detail. Infrastructure
  failure, not a debate outcome.
- **agent-error** — one side died on a terminal API error after retries.
- **synthesis-error** — both sides DID agree, but the final synthesis pass produced
  no answer (the synthesis agent died or returned empty). Not a successful answer —
  report it as a failure (there is agreement on record, only the merge failed).
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
- If `status === "unresolved"`: present it as a **genuine disagreement**, not an
  answer and not an infrastructure failure — show each side's final answer and
  the remaining objections (read the saved transcript) so the user can judge
  for themselves. Do **not** synthesize your own merge of the two; the debate
  already proved they don't agree.
- Any other non-consensus `status`: report it as a **failure**, not an answer.
  Surface `codexError` (for `reviewer-error`) or the workflow log so the user
  sees what broke, and tell them how to fix it (e.g. `codex login`) and re-run.
  Do **not** present a half-debate as if it were an agreed answer.

## Answer-mode safety & notes

- **Both peers read-only — but enforced ASYMMETRICALLY.** codex runs under
  `--sandbox read-only` (kernel-enforced, belt-and-suspenders with the prompt text —
  it reads arbitrary repo files and could be prompt-injected). The **Claude peer is
  only prompt-enforced**: the harness's `agent()` exposes no sandbox/tool restriction
  (the same is true of every Claude reviewer in `/lens-debate` and review mode), so
  Claude's read-only behaviour rests on instruction, not a kernel guard. A
  prompt-injected or mistaken Claude agent *could* in principle edit files or run a
  git write — answer mode does not, and cannot here, harden against that the way it
  does for codex. If that risk matters for a given prompt, run the debate in a
  disposable/read-only worktree. Treat the read-only guarantee as **hard for codex,
  best-effort for Claude.**
- **Warm codex session.** Round 1 cold-starts `codex exec`; every later round
  resumes the same session (`codex exec resume`) so codex cross-checks from its own
  prior answer rather than reconstructing it. The session id lives in the
  gitignored per-worktree `.codex-debate/` (a distinct `codex-answer-session.id`,
  so it never collides with review mode's session), degrading gracefully to a cold
  start if capture ever fails.
- **Symmetric convergence, schema-detected, candidate-confirmed.** Each side emits
  `agreesWithOther` + `objections`; a side counts as agreeing only when it sets
  `agreesWithOther:true` AND leaves no objection, so a stray objection can't be
  papered over by an over-eager boolean. Because the two run in parallel each round,
  a single mutually-agreeing round can be a **swap false positive** (Claude adopts
  codex's prior answer while codex adopts Claude's — both report agreement, but their
  current outputs are swapped and still differ), and they can keep swapping back and
  forth, so counting consecutive parallel agreements does **not** prove the current
  outputs match. The only sound test is to make both sides judge **one shared piece
  of text**. So when a round shows mutual agreement, the workflow synthesizes a single
  **candidate** from the two agreed answers and runs a **confirmation phase**: both
  sides review that *identical* candidate (without rewriting their own answer) and
  either approve it or object. Approval is on one fixed text both actually saw, so no
  swap is possible; if both approve, that candidate is the converged answer — already
  signed off by both debaters (which is also why `finalAnswer` is never unapproved
  synthesized text). If either objects, the candidate is dropped and the cross-check
  loop resumes with the objections folded in — all within the round backstop
  (default 6); exhausting it ends `unresolved`, reported as disagreement, never
  as an answer.
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
- **Runs to consensus within a tight backstop; concessions must be cited.** The
  loop ends when codex and Claude agree — or at `--max-rounds` (default 3),
  which ends the debate as `unresolved` with the still-open findings surfaced
  for a human. That is not a "deadlock surrender": pretending to agree is what
  defeats a debate, and the literature (and kolu#1222) shows extra rounds buy
  bias amplification, not truth. A side that flips a prior-round position must
  cite what convinced it (`concession` / `concessionReason`) — enforced
  mechanically by the workflow's persistent per-finding gate, not just requested.
  An uncited author flip (`disputed` → `fixed`/`partial` with no
  `concessionReason`) owes a citation that persists across rounds; codex
  resolving an author-disputed finding with an empty `concession` is the
  reviewer-side equivalent (the schema's `required` enforces only that the string
  is present, not that it's non-empty when accepting a dispute, so the workflow
  checks that condition). Any finding with an outstanding debt is held OPEN (so it
  ends `unresolved`, never silent consensus). Consensus can't be manufactured by
  capitulation.

## Files

Shared:

- `scripts/codex-exec-lib.sh` — the sourced core both modes share: the read-only
  `codex exec`/`resume` invocation, warm-session resolve/persist, retry/backoff,
  thread-id capture, and the synthesized error-verdict fallback (via a caller hook).
  The two mode scripts source this and add only their own prompts + verdict shape.

Review mode:

- `debate.workflow.js` — the Workflow script (the loop + consensus logic).
- `scripts/codex-review.sh` — the review-specific invocation (arg parsing, the
  review prompts, the verdict schema/session file, the verdict-shaped error).
- `scripts/codex-verdict.schema.json` — the JSON Schema codex's verdict is constrained to.

Answer mode:

- `answer.workflow.js` — the Workflow script for the symmetric answer-debate
  (parallel answers → cross-check loop to agreement → synthesis).
- `scripts/codex-answer.sh` — the answer-specific invocation (arg parsing, the
  answer prompts, the answer schema/session file, the answer-shaped error).
- `scripts/codex-answer.schema.json` — the JSON Schema codex's answer is constrained to.

These are generated from `.apm/skills/codex-debate/`; edit the source there and
run `just ai apm` to regenerate.

ARGUMENTS: $ARGUMENTS
