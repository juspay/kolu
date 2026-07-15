---
name: codex-debate
description: 'Run an automated codex⇄Claude debate to consensus — no round cap, no deadlock exit. Two explicit subcommands. `review` (also the bare/back-compat default) — codex critiques the current diff and Claude (author) fixes/disputes, looping until they agree, and the trail is committed + posted to the PR. `answer` — Claude and codex each answer a freeform prompt, then cross-check until they agree, and a unified answer is returned. The debate runs over a LIVE codex session in a split terminal beside you (driven per the /kolu skill), not a headless workflow. Use when the user types `/codex-debate`, asks to "have codex review this", "run the codex debate", "review this PR with codex", "argue this with codex until you agree", or passes a question to "have Claude and codex debate/answer until they agree".'
argument-hint: "review [<pr-number>] [--repo <path>] [--base <branch>] [--effort <level>] [--no-commit] [--no-comment] [--rationale <note>] [--context <note>]  |  answer [--effort <level>] -- <prompt>"
---

# Codex ⇄ Claude debate

An automated debate between **codex** and **Claude** that loops to consensus with
**no round cap and no deadlock exit**. It has **two modes**, chosen by an **explicit
leading subcommand** (with one narrow, deliberately-retained exception — the
backward-compatible bare `review` alias below): a **mutating** action is never
triggered by freeform prose, because the two modes have different side-effect
contracts.

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

**Spawn** codex as a **split tile beside you** — a sibling on your canvas, NOT a
detached terminal — in this worktree, under `--yolo`, at the chosen reasoning effort.
The split is what `--parent` buys: `padi-tui create --parent "$KAVAL_TERMINAL_ID" --
codex --yolo -c model_reasoning_effort=<effort>` (per [/kolu](../kolu/SKILL.md#provisioning-a-worktreed-agent--padi-tui-create)
— `$KAVAL_TERMINAL_ID` names your own terminal). **Do NOT reach for raw `kaval-tui
create`**: it spawns a detached, standalone terminal that isn't a split beside you and
isn't on the canvas — the exact wrong shape for a debate you drive turn-by-turn. `--yolo` is
**required, not a convenience**: the two moves that make this engine work — codex
*writing* its verdict file and *pinging* your terminal (a unix-socket write) — are both
**denied by every codex sandbox** (`read-only` and `workspace-write` both block the
socket write; `read-only` also blocks the file write — verified). So the reviewer runs
unsandboxed; see [the read-only note](#the-reviewer-runs---yolo--a-trusted-diff-precondition).

**Both terminal references must survive a kaval re-key — record titles for BOTH sides.**
Per /kolu, kaval **re-keys** terminal ids on a restart, and a long, no-cap debate can
outlive one. So keep the **split's** id *and* stable title, and also your **own**
(author) id and title. If a `send`/`snapshot` fails with "no terminal matching",
**re-resolve by title** (list the daemon, match the title, use the new id) for teardown
and every later ask. And put **both your id and your title** in each ask you give codex,
instructing it to re-resolve your title the same way before the reverse ping — otherwise
a re-key mid-review leaves codex pinging a stale id with no way to recover, and only the
reviewer side would be restart-safe.

**Boot check.** `create` returning ≠ codex is ready: confirm the footer reads `YOLO
mode` before dispatching (one launch may auto-update and drop to a shell — don't
dispatch until you see the codex TUI).

**Warm session is native.** The split is one persistent codex session that keeps its
own prior review in context across rounds — round 1 gets the full review prompt, every
later round a lean follow-up. No session-resume machinery.

**Talk to codex through files, not the screen.** Give codex each round's instructions
as a **file** plus a short "read this path and carry it out" pointer (the /kolu paste
rule — a multi-line paste won't submit). Never paste the diff or your rebuttal; codex
reads the tree and your files itself.

**The verdict comes back as a file, announced.** A TUI can't be forced to emit valid
JSON, and its rendered output is lossy (it swallows code fences; long output scrolls
off). So instruct codex to, each round, **write** its verdict to
`$REPO/.codex-debate/verdict-NNN.json`, **print** a one-line marker, and **ping your
terminal** (the /kolu send, in reverse — you give codex your own terminal id *and title*
so it can re-resolve you across a kaval re-key). You then **read the file** — byte-exact,
complete. If the file is missing or doesn't match the schema, **re-ask codex to rewrite
it; never guess a verdict.**

**Teardown** kills **only the split's terminal id you recorded at spawn** (re-resolved
by title if kaval re-keyed it) — never a pattern kill (`pkill -f`, `pgrep`, `ps | grep
| kill`, or any marker/substring match are one banned class). A stray codex you didn't
spawn is **reported** (pid + args), never hunted.

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

Your **primary done-signal is the incoming ping**. Because codex writes the file and
prints the marker *before* pinging, **a flubbed ping loses no data** — the verdict
persists on disk. But it is **not** hang-proof on its own: once you have ended your
turn, nothing wakes you until a prompt arrives, so a dropped ping **stalls** the loop
until you are next invoked (a human nudge, or your next scheduled wake). The recovery
is a **bounded** `wait --until match:'VERDICT-WRITTEN'`/snapshot on codex's terminal
(per /kolu) plus reading the file directly — run it whenever you wake without a fresh
ping. If your environment can't guarantee re-invocation and you need strict
hang-freedom, keep that bounded `wait` alive **instead of** fully ending your turn (you
trade the event-driven idle for a held turn). **The loop ends only on consensus** — no
round cap, no deadlock exit (below).

## Autonomous to consensus — no human mid-debate (unless orchestrated)

This skill runs **autonomously**, like `/be-review`: as the author you make your own
fix/dispute calls and **never pause to ask a human** mid-debate — it is designed to
complete unattended. The **one exception:** if you are an implementing agent **driven by
`/orchestrator`**, a decision that genuinely needs a human is taken to the
**orchestrator** through your reporting channel (per `/orchestrator`), never to a direct
human dialog. Absent an orchestrator, you decide and drive on.

## Mode detection (do this first)

On the **first whitespace-delimited token** of `$ARGUMENTS`:

- **`answer`** → [answer mode](#answer-mode). The rest is `[--effort <level>] --
  <prompt>`: strip a leading `--effort <level>` if present, then take the prompt as
  everything after the `--` separator (or, if no `--`, the remaining text).
- **`review`** → [review mode](#review-mode); the rest is the review grammar.
- **No args, OR the first token is a number (PR) or a `--flag`** → **review mode** (the
  backward-compatible bare alias, so existing callers keep working).
- **Anything else** (freeform prose, no recognized subcommand) → **ambiguous**: don't
  guess — ask the user to pick `answer -- "<prompt>"` (read-only) or `review [<pr>]
  [flags]` (mutating), and stop.

<a id="review-mode"></a>
# Review mode

codex is the reviewer; **you are the author** — you already have edit/commit tools in
your own turn, so you fix and dispute directly.

**Two honest limits of this engine, stated plainly (and surfaced in the skill's output
where relevant):**

- <a id="the-reviewer-runs---yolo--a-trusted-diff-precondition"></a>**The reviewer runs
  `--yolo` — so review assumes a TRUSTED local diff.** codex is **not** sandboxed (the
  engine requires it — see spawn), so its read-only behavior rests on the prompt, not
  the kernel. **Precondition:** review is designed for a change **you trust** (your own
  branch/worktree). Reviewing an **untrusted third-party PR** this way runs an
  unsandboxed agent on untrusted content — repository files are input to the agent, so a
  malicious or mistaken PR could direct command execution, credential reads, or network
  access under your account. **A disposable worktree is not a security sandbox** — it
  limits *where files land*, not what the agent can execute or read. If you must review
  untrusted content, do it in a real OS/container sandbox with the tree mounted
  read-only, not with this skill.
- **Consensus is parsed-with-re-ask, not schema-forced.** A live TUI can't be forced to
  emit valid JSON, so consensus is detected on the **verdict file codex writes**,
  re-asked on if malformed — never guessed.

## Arguments

A leading `review` token is consumed by mode detection; the rest is `[<pr-number>]
[--repo <path>] [--base <branch>] [--effort <level>] [--no-commit] [--no-comment]
[--rationale <note>] [--context <note>]`:

- **`--repo <path>`** — the **absolute path of the repo under review**, which **may not
  be the cwd** (a cross-repo run — e.g. `/be-review` reviewing a companion drishti PR
  while the session is rooted in a kolu worktree). Default: the cwd worktree root. This
  is `$REPO` below, and **every** operation is rooted in it — `git -C "$REPO"`, the
  `$REPO/.codex-debate/` scratch, all `gh` (from a subshell `cd "$REPO"` — `gh` has **no**
  `-C` flag; run it as `(cd "$REPO" && gh …)`), and the split's `codex --cd "$REPO"`. Get
  it right before dispatch: a wrong `$REPO` reviews and commits the wrong tree (the exact
  cross-repo failure `/be-review` guards against).
- **`<pr-number>`** — a PR to debate: `(cd "$REPO" && gh pr checkout <n>)` and default the
  base to its base branch. Omitted → debate `$REPO`'s current branch change.
- **`--base <branch>`** — ref to diff against, always a **remote-tracking ref** (e.g.
  `origin/master`, used as-is, never the stale local `master`). Default:
  `origin/<PR base>` for a PR, else the repo default (`git symbolic-ref --short
  refs/remotes/origin/HEAD`), fallback `origin/master`. Resolve to the **merge-base**
  with HEAD and diff against that, so commits the base gained since the fork aren't
  reviewed as this change's.
- **`--effort <level>`** — codex's `model_reasoning_effort` (`low`/`medium`/`high`/
  `xhigh`). **Default `high`.** Surface the chosen level in the comment header and report.
- **`--no-commit`** — leave agreed changes uncommitted for the user. Default: commit each round.
- **`--no-comment`** — don't post the summary to the PR. Default: post it when a PR exists.
- **`--rationale <note>`** — the author's note on **deliberate** decisions. Thread it
  into codex's round-1 review prompt (so it doesn't flag intentional choices) and into
  your own reasoning every round (so you *dispute* a finding that contradicts a
  deliberate choice rather than "fixing" it).
- **`--context <note>`** — the main-agent context (what the change is FOR). Yours only,
  not codex's — codex stays an independent reviewer of the code, not the narrative.

## Steps

1. **Resolve context.** Confirm you're in a kolu terminal. Resolve **`$REPO`** (from
   `--repo`, else the cwd worktree root) and **root every command in it** — `git -C
   "$REPO"`, all `gh` from a subshell `(cd "$REPO" && gh …)` (**`gh` has no `-C` flag**),
   the `$REPO/.codex-debate/` scratch, and the split's `--cd "$REPO"`. `git -C "$REPO"
   fetch origin`; resolve `base`; `(cd "$REPO" && gh pr checkout <n>)` if a PR number was
   given. **Discover the PR** even when no number was passed: `(cd "$REPO" && gh pr view
   --json number,baseRefName)` on the current branch — distinguish "no PR"
   (skip posting) from a command error (report it), and carry the resolved number into
   step 4. **Merge-base guard:** if `git -C "$REPO" merge-base <base> HEAD` fails, abort
   up front — say which base failed and how to fix it, stop. **Reviewable check:** proceed
   if the merge-base diff is non-empty **or** `git -C "$REPO" status --porcelain` shows
   untracked paths in scope (a new-file-only change is real); else stop. **Clean-tree
   precondition for commit mode:** if committing (the default — not `--no-commit`) and
   `git -C "$REPO" status --porcelain` shows **any** pre-existing uncommitted or staged
   change, **fail fast** — tell the user to commit (or stash) that work first, or re-run
   with `--no-commit`. This is what makes each round's path-only staging exact: with a
   clean start, the only uncommitted changes are the round's own edits, so nothing
   pre-existing (a staged entry, or another edit to a file you touch) can be swept into a
   round commit. Preflight `codex login status` (else tell the user to `codex login`).
   **Prepare a clean scratch:** ensure the gitignored `$REPO/.codex-debate/` exists and
   **remove any prior run's artifacts** (`verdict-*`, `section-*`, `ask-*`, `answer-*`,
   `candidate.md`) so a shorter run can't inherit a stale file into this run's report.
2. **Spawn the split codex** (per [the engine](#the-engine--a-live-codex-in-a-split-terminal-beside-you)); record its id **and title**.
3. **Run the debate loop** ([core loop](#the-core-loop--a-symmetric-ping-to-consensus)), each round:
   - **Your ask to codex** (a file it reads): inspect the change **read-only** (`git
     diff <merge-base>`; `git status --short` and open every untracked file in scope;
     ignore `.codex-debate/`). **Round 1:** give ALL feedback at EVERY severity
     (blocking → nit) — correctness, swallowed errors, unjustified fallbacks, security,
     simplicity/efficiency — citing `file:line`; include `--rationale` if given. **Round
     N>1:** you still have your prior review in context — read the author's dispositions
     at `section-(N-1)-2-claude.md`, **close out the findings on the table** (verify a
     fix → `resolved`, or answer a dispute → concede or hold firm), and raise a new
     finding only for a regression this round introduced. Then **write** `verdict-NNN.json`,
     print the marker, and **ping you**.
   - **Your turn** (woken by the ping): read `verdict-NNN.json` (re-ask on
     missing/malformed). For each **open** finding, **fix** it or **dispute** it —
     weighing `--context`/`--rationale`. Write your dispositions to
     `section-NNN-2-claude.md` (one entry per finding, a clear **fixed / disputed /
     partial** marker + reasoning — your memory and **codex's next-round rebuttal**; codex
     reads it at the top of round N+1).
   - **Commit the round safely** (unless `--no-commit`): the clean-tree precondition
     (step 1) guarantees the round's edits are the only uncommitted changes, so
     `git -C "$REPO" add -- <the exact paths you edited>` (never `git add -A`/`.`) stages
     *only* this round's fixes. Commit with the round's findings + dispositions in the
     message; **verify and record the SHA**. A **dispute-only / no-change** round has
     nothing to commit — note it and skip (don't force an empty commit). If a commit you
     expected fails, treat the round as **incomplete**, not consensus. Never push or merge.
   - **Consensus test:** if codex's verdict is `approved: true` → go to step 4. Else (you
     wrote your dispositions above) ping codex for round N+1 and end your turn.
   - **Resolved-and-deferred (NOT a deadlock exit).** A finding that is a downstream /
     ship-phase / process gate (a companion repo pinning this repo's final HEAD, a
     CI/release step, a cross-repo PR) can't be satisfied mid-review — show codex it's
     such a gate and have it mark the finding `resolved` (deferred to ship), instead of
     holding it open forever. Narrow: a real code defect you dislike is still argued to
     consensus.
   - **Reviewer-error terminus:** if codex can't produce a readable, schema-valid verdict
     even after you re-ask (broken/wedged session), tear down, report it as an
     **infrastructure failure** (not consensus), tell the user to fix codex, and stop.
4. **Present & post.** Tear down the split. On **consensus**, report the round count, the
   reviewer **effort**, and `git -C "$REPO" log --oneline <merge-base>..HEAD` in chat.
   Then, unless `--no-comment` and when a PR exists (the number resolved in step 1),
   **post a COMPACT PR comment** — the per-round detail lives in the commit messages, so
   the comment is just a pointer:
   - a one-line header — `## Codex ⇄ Claude debate` then `✅ Consensus in N rounds ·
     reviewer effort: <effort> · base: <base>`;
   - a **single table of the debate commits** (`git -C "$REPO" log --oneline
     <merge-base>..HEAD`), one row per round: `| Round | Commit | Description |` with the
     **bare** short SHA (NOT wrapped in backticks/code — GitHub only autolinks a bare SHA
     to its commit; a code-wrapped one renders as plain text) and the commit subject;
   - a **Legend** — because the commit subjects reference findings by stable id (`F2`,
     `F14`, …), list **one line per finding id** so the ids are legible. Gather the unique
     ids across the run's `verdict-NNN.json` files and, for each, emit `- **Fn** — <the
     first sentence of its issue>`, in numeric id order:
     ```sh
     jq -rs '[.[].findings[]] | unique_by(.id) | sort_by(.id|ltrimstr("F")|tonumber)[]
             | "- **\(.id)** — \(.issue|split(". ")[0])"' "$REPO"/.codex-debate/verdict-*.json
     ```

   That's the whole comment — a short header, one commit table, and the legend. **Do not**
   inline the per-round codex verdicts or your dispositions; they are in the commits (and
   the gitignored `.codex-debate/` scratch) for anyone who wants the detail. Post from the
   target repo: `(cd "$REPO" && gh pr comment <pr> -F <file>)`. The per-round commits sit
   on the local branch for the human to review and push/merge; the skill never pushes or merges.

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
or declares a deadlock, because a debate that quits without agreement is pointless. The
sole carve-out is the [resolved-and-deferred](#steps) gate above — a genuine code defect
is always argued to consensus. To stop one by hand, interrupt and tear down.

<a id="answer-mode"></a>
# Answer mode

Symmetric, not author⇄reviewer: **you and codex are equal peers.** Grammar: `answer
[--effort <level>] -- <prompt>` — strip a leading `--effort <level>`, take the prompt
after `--` (if empty, ask what to answer and stop). Preflight `codex login`. Prepare a
clean `.codex-debate/` (remove prior `answer-*`/`candidate.md`, per review step 1).
Spawn the split ([engine](#the-engine--a-live-codex-in-a-split-terminal-beside-you);
`--effort` applies, default `high`) and run the same symmetric
[ping loop](#the-core-loop--a-symmetric-ping-to-consensus) — answers and verdicts move
as files. Both peers may read the repo to ground their answers but neither edits
(read-only is **instructed**, not enforced, under `--yolo` — same honest limit as review
mode). This mode makes **no** commits and **no** PR writes.

The per-round files are explicit for both peers: **you** write
`.codex-debate/answer-claude-N.md`; codex writes `.codex-debate/answer-codex-N.md` plus
its verdict `.codex-debate/answer-verdict-N.json` (schema below), prints the marker, and
pings you.

- **Round 1 — independent.** Both peers answer the prompt having seen **only the
  prompt**, not each other's answer. Dispatch codex's round-1 ask and write your own
  answer without reading `answer-codex-1.md` until it exists and round 2 begins — that
  independence is what makes agreement meaningful.
- **Rounds 2+ — cross-check.** Each reads the other's latest answer file and either
  concedes (revises its own answer, recording what changed in `changedMind`) or objects
  (holds firm, citing `file:line` for repo prompts). You record your own agreement the
  same way codex does — an explicit "I agree / my objections" note at the top of your
  `answer-claude-N.md`.
- **Convergence is candidate-confirmed.** Because the two answers evolve independently, a
  round where both report agreement (each verdict `agreesWithOther:true` with no open
  objection, and your matching note) can be a **swap false positive** (each adopted the
  other's prior answer; both "agree" but their current texts differ). So on mutual
  agreement, **synthesize one candidate** into `.codex-debate/candidate.md` and run a
  **confirmation round**: both peers judge that *identical* candidate (using the same
  verdict schema, `agreesWithOther` = "I approve this candidate") and approve or object.
  Both approve → that's the converged answer. Either objects → drop the candidate and
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
the unified answer (state the round count and codex's effort). **Assemble the transcript**
deterministically into `.codex-debate/answer-<slug>.md` — a header, then each round's two
answer files (`answer-claude-N.md`, `answer-codex-N.md`) in order, then the confirmed
`candidate.md` — and point the user at it. On failure (codex couldn't produce a valid
verdict, or synthesis/confirmation never converged), report the failure — never present a
half-debate as an agreed answer.

## Files

All debate state is ephemeral, under the gitignored per-worktree `.codex-debate/`, and
**cleared at the start of each run** (step 1): `ask-*.md` (round instructions you write
for codex), `verdict-NNN.json` / `answer-verdict-N.json` (codex's structured verdict you
parse), `section-NNN-2-claude.md` (your per-round dispositions — your memory and codex's
next-round rebuttal), and `answer-claude-N.md` / `answer-codex-N.md` / `candidate.md` /
`answer-<slug>.md` for answer mode. **None of this feeds the PR comment** — that is a
compact commit table (step 4); the debate's per-round detail lives in the commit messages.
There are **no** workflow or `codex exec` scripts; the engine is this protocol plus the
[/kolu skill](../kolu/SKILL.md).

This skill is generated from `agents/.apm/skills/codex-debate/`; edit the source there
and keep the generated `.claude/` and `.agents/` copies identical in the same commit
(see `.claude/rules/apm-workflow.md`).

ARGUMENTS: $ARGUMENTS
