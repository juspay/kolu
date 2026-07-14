---
name: codex-debate
description: 'Run an automated codex⇄Claude debate to consensus — no round cap, no deadlock exit. Two explicit subcommands. `review` (also the bare/back-compat default) — codex critiques the current diff and Claude (author) fixes/disputes, looping until they agree, and the trail is committed + posted to the PR. `answer` — Claude and codex each answer a freeform prompt, then cross-check until they agree, and a unified answer is returned. The debate runs over a LIVE codex session in a split terminal beside you (driven per the /kolu skill), not a headless workflow. Use when the user types `/codex-debate`, asks to "have codex review this", "run the codex debate", "review this PR with codex", "argue this with codex until you agree", or passes a question to "have Claude and codex debate/answer until they agree".'
argument-hint: "review [<pr-number>] [--base <branch>] [--effort <level>] [--no-commit] [--no-comment] [--rationale <note>] [--context <note>]  |  answer \"<prompt>\" [--effort <level>]"
---

# Codex ⇄ Claude debate

An automated debate between **codex** and **Claude** that loops to consensus with
**no round cap and no deadlock exit**. It has **two modes**, chosen by an **explicit
leading subcommand** — never inferred from the argument's shape (the two modes have
different side-effect contracts, so a mutating action must never be triggered by
prose):

- **`review`** — codex reviews the current diff, **you** (the author) fix what you
  agree with and dispute what you don't, round after round until you agree; the trail
  is **committed per round and posted to the PR**.
- **`answer`** — you and codex each answer a freeform prompt, cross-check until you
  agree, and a **unified answer** is returned (read-only + saved transcript).

## The engine — a live codex in a split terminal beside you

You drive the debate from your own turn: spawn a **live `codex` session as a split
terminal next to you** and take turns with it until you agree. There is no `Workflow`
tool and no subagent — you *are* one debater, the split codex *is* the other. **All
the terminal mechanics belong to the [/kolu skill](../kolu/SKILL.md)** — spawning a
split, the send→settle→submit sequence, the done-signal, the large-paste file rule,
and teardown. Read it; this skill only adds the debate protocol on top.

Requires running **inside a kolu terminal** (you need to spawn a sibling split). If
you can't, the skill is inert — say so and stop.

**Spawn** codex as a split beside you, in this worktree, under `--yolo` (it must run
unattended and needs a shell to write files and ping you), at the chosen reasoning
effort: `codex --yolo -c model_reasoning_effort=<effort>`. **Record its terminal id**
for the whole debate. Before dispatching anything, confirm it has come up as a *ready
codex prompt* (its footer reads `YOLO mode`) — one launch may auto-update and drop to
a shell, so don't dispatch until you see the codex TUI.

**Warm session is native.** The split is one persistent codex session that keeps its
own prior review in context across rounds — so round 1 gets the full review prompt
and every later round gets a lean follow-up. No session-resume machinery.

**Talk to codex through files, not the screen.** Give codex each round's instructions
as a **file** plus a short "read this path and carry it out" pointer (the /kolu
paste rule — a multi-line paste won't submit). Never paste the diff or your rebuttal;
codex reads the tree and your files itself.

**The verdict comes back as a file, announced — never scraped off the screen.** A TUI
can't be forced to emit valid JSON, and its rendered output is lossy (it swallows code
fences and long output scrolls off). So instruct codex to, each round, **write** its
verdict to `.codex-debate/verdict-NNN.json`, **print** a one-line marker, and **ping
your terminal** (the /kolu send, in reverse — you give codex your own terminal id).
You then **read the file** — byte-exact, complete. If the file is missing or doesn't
match the schema, **re-ask codex to rewrite it; never guess a verdict.**

**Teardown** kills **only the split's terminal id you recorded at spawn** — never a
pattern kill (`pkill -f`, `pgrep`, `ps | grep | kill`, or any marker/substring match
are one banned class). A stray codex you didn't spawn is **reported** (pid + args),
never hunted.

## The core loop — a symmetric ping, to consensus

The two sides drive each other by **pinging, not polling**. Every turn on either side
ends by pinging the other terminal (the /kolu three-step send), then ending its own
turn — the incoming ping is what wakes you for your next turn:

```
you  → give codex the round's ask (file + pointer)        → END YOUR TURN
codex→ review, write verdict + section files, ping you    → end its turn
you  → read verdict, fix/dispute, write section, commit   → ping codex → END YOUR TURN
 …   until consensus: codex's verdict is `approved: true`
```

Your **primary done-signal is the incoming ping**; because codex writes the file and
prints the marker *before* pinging, a flubbed ping can neither corrupt nor hang the
debate — the file is the source of truth, and a bounded `wait`+snapshot on codex's
terminal (per /kolu) is the fallback. **The loop ends only on consensus** — no round
cap, no deadlock exit (below).

## Mode detection (do this first)

On the **first whitespace-delimited token** of `$ARGUMENTS`:

- **`answer`** → [answer mode](#answer-mode); the prompt is everything after the token.
- **`review`** → [review mode](#review-mode); the rest is the review grammar.
- **No args, OR the first token is a number (PR) or a `--flag`** → **review mode** (the
  backward-compatible bare alias, so existing callers like `/be-review` keep working).
- **Anything else** (freeform prose, no recognized subcommand) → **ambiguous**: don't
  guess — ask the user to pick `answer "<prompt>"` (read-only) or `review [<pr>]
  [flags]` (mutating), and stop.

<a id="review-mode"></a>
# Review mode

codex is the reviewer; **you are the author** — you already have edit/commit tools in
your own turn, so you fix and dispute directly.

**Two honest limits of this engine, stated plainly (and in the skill's output where
relevant):** codex runs `--yolo`, so it is **instructed** read-only, **not**
kernel-sandboxed as the old engine was — if hard read-only matters, run in a
disposable worktree. And consensus is detected on the **verdict file codex writes,
re-asked on if malformed**, not on schema-forced JSON (a live TUI can't be forced).

## Arguments

A leading `review` token is consumed by mode detection; the rest is `[<pr-number>]
[--base <branch>] [--effort <level>] [--no-commit] [--no-comment] [--rationale <note>]
[--context <note>]`:

- **`<pr-number>`** — a PR to debate: `gh pr checkout <n>` and default the base to its
  base branch. Omitted → debate the current branch's working-tree diff.
- **`--base <branch>`** — ref to diff against, always a **remote-tracking ref** (e.g.
  `origin/master`, used as-is, never the stale local `master`). Default:
  `origin/<PR base>` for a PR, else the repo default (`git symbolic-ref --short
  refs/remotes/origin/HEAD`), fallback `origin/master`. Resolve to the **merge-base**
  with HEAD and diff against that, so commits the base gained since the fork aren't
  reviewed as this change's.
- **`--effort <level>`** — codex's `model_reasoning_effort` for the review (`low` /
  `medium` / `high` / `xhigh`). **Default `high`.** Surface the chosen level in the
  comment header and your report.
- **`--no-commit`** — leave agreed changes uncommitted for the user. Default: commit
  each round.
- **`--no-comment`** — don't post the summary to the PR. Default: post it when a PR
  exists.
- **`--rationale <note>`** — the author's note on **deliberate** decisions. Thread it
  into codex's round-1 review prompt (so it doesn't flag intentional choices) and into
  your own reasoning every round (so you *dispute* a finding that contradicts a
  deliberate choice rather than "fixing" it).
- **`--context <note>`** — the main-agent context (what the change is FOR). Yours only,
  not codex's — codex stays an independent reviewer of the code, not the narrative.

## Steps

1. **Resolve context.** Confirm you're in a kolu terminal. `git fetch origin`; resolve
   `base`; `gh pr checkout` if a PR number was given. **Merge-base guard:** if `git
   merge-base <base> HEAD` fails, the diff scope is untrustworthy — abort up front, say
   which base failed and how to fix it, stop. Confirm a non-empty diff (else stop).
   Preflight `codex login status` (else tell the user to `codex login`). Ensure the
   gitignored per-worktree scratch dir `.codex-debate/` exists.
2. **Spawn the split codex** (per [the engine](#the-engine--a-live-codex-in-a-split-terminal-beside-you)); record its id.
3. **Run the debate loop** ([core loop](#the-core-loop--a-symmetric-ping-to-consensus)), each round:
   - **Your ask to codex** (a file it reads): inspect the change **read-only** (`git
     diff <merge-base>`, `git status --short` for untracked files; ignore
     `.codex-debate/`). **Round 1:** give ALL feedback at EVERY severity (blocking →
     nit) — correctness, swallowed errors, unjustified fallbacks, security,
     simplicity/efficiency — citing `file:line`; include `--rationale` if given.
     **Round N>1:** you still have your prior review in context — read the author's
     dispositions at `section-(N-1)-2-claude.md`, **close out the findings on the
     table** (verify a fix → `resolved`, or answer a dispute → concede or hold firm),
     and raise a new finding only for a regression this round introduced. Then **write**
     `verdict-NNN.json` + `section-NNN-1-codex.md`, print the marker, and **ping you**.
   - **Your turn** (woken by the ping): read `verdict-NNN.json` (re-ask on
     missing/malformed). For each **open** finding, **fix** it or **dispute** it —
     weighing `--context`/`--rationale`. Write your dispositions to
     `section-NNN-2-claude.md` (one entry per finding, a clear **fixed / disputed /
     partial** marker + reasoning — this file is your memory, codex's next-round
     rebuttal, and part of the PR comment). **Commit the round** (unless `--no-commit`)
     with the findings + dispositions in the message; never push or merge. If codex's
     verdict is `approved: true` → consensus, go to step 4; else ping codex for round
     N+1 and end your turn.
   - **Resolved-and-deferred (NOT a deadlock exit).** A finding that is a downstream /
     ship-phase / process gate (a companion repo pinning this repo's final HEAD, a
     CI/release step, a cross-repo PR) can't be satisfied mid-review — show codex it's
     such a gate and have it mark the finding `resolved` (deferred to ship), instead of
     holding it open forever. Narrow: a real code defect you dislike is still argued to
     consensus.
   - **Reviewer-error terminus:** if codex can't produce a readable, schema-valid
     verdict even after you re-ask (broken/wedged session), tear down, report it as an
     **infrastructure failure** (not consensus), tell the user to fix codex, and stop.
4. **Present & post.** Tear down the split. On **consensus**, report the round count,
   the reviewer **effort**, `git log --oneline <merge-base>..HEAD` + `git diff --stat`,
   and a per-round summary (`cat .codex-debate/section-*.md`). Then, unless
   `--no-comment` and when a PR exists, **post the PR comment**: a small header
   (consensus badge · round count · effort · base) followed by the per-round section
   files `cat`-ed in glob order (they zero-pad `NNN` so the glob sorts chronologically)
   — a **deterministic concat** of the same files you and codex used, `gh pr comment
   <pr> -F <file>`. The per-round commits sit on the local branch for the human to
   review and push/merge; the skill never pushes or merges.

### codex's verdict schema (`verdict-NNN.json`)

```json
{
  "approved": false,
  "summary": "one-paragraph assessment this round",
  "findings": [
    { "id": "F1", "severity": "blocking|major|minor|nit", "location": "file:line",
      "issue": "what's wrong and why", "suggestion": "concrete fix", "status": "open|resolved" }
  ],
  "responseToRebuttal": "address each of the author's disputes; empty on round 1"
}
```

`approved` is `true` **only** when every finding is `resolved`, at every severity —
that is the consensus test. `id`s are stable across rounds.

## Runs to consensus — no cap, no deadlock exit

The loop ends only when the verdict is `approved: true`; it never bails at a round cap
or declares a deadlock, because a debate that quits without agreement is pointless.
The sole carve-out is the [resolved-and-deferred](#steps) gate above — a genuine code
defect is always argued to consensus. To stop one by hand, interrupt and tear down.

<a id="answer-mode"></a>
# Answer mode

Symmetric, not author⇄reviewer: **you and codex are equal peers.** Capture the prompt
(everything after the `answer` token; if empty, ask what to answer and stop). Preflight
`codex login`. Spawn the split ([engine](#the-engine--a-live-codex-in-a-split-terminal-beside-you); `--effort` applies, default `high`), and run the same
symmetric [ping loop](#the-core-loop--a-symmetric-ping-to-consensus) — answers and
verdicts move as files, same as review mode. Both peers may read the repo to ground
their answers but neither edits (read-only is **instructed**, not enforced, under
`--yolo` — same honest limit as review mode). This mode makes **no** commits and **no**
PR writes.

- **Round 1** — each peer answers **independently** (neither has seen the other's):
  you write yours to a file; codex writes its answer + `answer-verdict-1.json` and pings.
- **Rounds 2+** — each reads the other's latest answer and either concedes (revises,
  recording what changed) or objects (holds firm, citing `file:line` for repo prompts).
- **Convergence is candidate-confirmed.** Because the two answers evolve independently,
  a round where both say "I agree" can be a **swap false positive** (each adopted the
  other's prior answer; both agree but their current texts differ). So when a round
  shows mutual agreement, **synthesize one candidate** from the two, and run a
  **confirmation round**: both peers judge that *identical* candidate and approve or
  object. Both approve → that's the converged answer. Either objects → drop it and
  resume, objection folded in. No round cap, no deadlock exit.

Answer-verdict schema (`answer-verdict-N.json`):

```json
{
  "answer": "codex's complete answer this round (revised on cross-check rounds)",
  "keyPoints": ["core claims the answer rests on"],
  "agreesWithOther": false,
  "objections": [ { "point": "the claim/gap you disagree with", "reason": "why — cite file:line for repo prompts" } ],
  "changedMind": "what you revised because the other convinced you; empty on round 1 / no change"
}
```

`agreesWithOther` counts as agreement **only** when `true` AND `objections` is empty.

**Present:** tear down the split. On consensus, present the confirmed **candidate** as
the unified answer (state the round count and codex's effort), and save the full
transcript to `.codex-debate/answer-<slug>.md`. On failure (codex couldn't produce a
valid verdict, or synthesis/confirmation never converged), report the failure — never
present a half-debate as an agreed answer.

## Files

All debate state is ephemeral, under the gitignored per-worktree `.codex-debate/`:
`ask-*.md` (round instructions you write for codex), `verdict-NNN.json` /
`answer-verdict-N.json` (codex's structured verdict you parse), `section-NNN-1-codex.md`
(codex's readable review) and `section-NNN-2-claude.md` (your dispositions) — the two
that compose the PR comment — and `answer-*.md` / `candidate.md` / `answer-<slug>.md`
for answer mode. There are **no** workflow or `codex exec` scripts; the engine is this
protocol plus the [/kolu skill](../kolu/SKILL.md).

This skill is generated from `agents/.apm/skills/codex-debate/`; edit the source there
and keep the generated `.claude/` and `.agents/` copies identical in the same commit
(see `.claude/rules/apm-workflow.md`).

ARGUMENTS: $ARGUMENTS
