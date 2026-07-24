---
name: lens-debate
description: Review the current diff through two structural lenses — lowy (volatility-based decomposition) and hickey (structural simplicity) — run as two independent parallel subagents, then merged by ONE reconcile-and-apply pass that commits the uncontested fixes. Debate is not the protocol: it is a bounded escalation valve for findings where the two lenses directly contradict each other, and judgment-shaped calls go to the human instead. Use when the user types `/lens-debate`, or asks to "have lowy and hickey review this", "run the lens review", or "review this diff structurally".
argument-hint: "[<pr-number>] [--base <branch>] [--max-rounds <n>] [--no-comment]"
---

# Lowy ∥ Hickey lens review

Two structural reviewers read your change **independently and in parallel** —
**lowy** (volatility-based decomposition: do boundaries encapsulate axes of
change?) and **hickey** (structural simplicity: are independent concerns
complected, or one thing fragmented?). One **reconcile-and-apply** pass merges
their two finding lists and commits the fixes.

Debate is **not** the protocol. It is one of two escalation valves, pulled only
where the lenses directly contradict each other about the same code — and even
then, a discriminating experiment beats another round of argument.

## Why this shape

The value comes from the **fan-out**, not from resolution machinery. On the
gauntlet run over kolu #1975 every finding worth having — a relay self-bind fd
explosion, an Ink screen-ownership fix, a selection-clamp race — came out of a
review stage. None came out of debate resolution. Meanwhile the debate protocol
was explicitly unbounded ("no round cap, no deadlock exit") and spent minutes per
round across three agents on a modest diff: a latency hazard bought nothing.

And the genuinely contested structural calls in that feature were not settled by
lens consensus at all. They were settled by **measurement** (SIGKILL a mux client
and watch whether its forward survives; time `netstat` against `lsof`) or by a
**human** making a scope call in a couple of minutes. So this skill spends its
budget on independent reading, and routes the rest to evidence or to the person
who owns the decision.

Three things from the older engine are load-bearing and survive intact:

- **Independent review.** Neither lens sees the other's findings before forming
  its own, and neither is handed a curated list to react to. A first cut fed
  hickey a pre-curated "lowy finding" to rebut and it concluded *drop*; running
  the reviews independently made hickey raise the same issue on its own and flip
  to *fix* (#1109). Curation biases the outcome.
- **Both lenses run on Opus**, overriding their `model: sonnet` frontmatter —
  every lens *judgment* is an Opus judgment.
- **The lowy lens runs Löwy's electricity probe** (#1111) — not a second voice,
  the same volatility vote with a sharper question.

## Arguments

Parse `[<pr-number>] [--base <branch>] [--max-rounds <n>] [--no-comment]`:

- **`<pr-number>`** (optional): `gh pr checkout <n>` first and default the base
  to that PR's base branch. Omitted → review the current branch's diff.
- **`--base <branch>`**: ref to diff against — always a **remote-tracking ref**,
  never a stale local branch. Default: the repo default branch via
  `git symbolic-ref --short refs/remotes/origin/HEAD`, used as-is.
- **`--max-rounds <n>`**: **hard cap** on valve-1 debate rounds. Default **2**.
  Reaching it is not a reason to keep going — the finding goes to the human.
- **`--no-comment`**: don't post the summary to the PR (a caller that pushes
  later posts it itself — see `/be-review`). Default is to post.

## Steps

### 1. Resolve scope

Determine `repoPath` — the root of the repo **under review**, which a caller may
hand you and which need not be the cwd. Every git command and every file path
below is rooted there (`git -C "$repoPath"`, absolute paths).

`git fetch origin`, resolve `base` per the rules above, then diff against
`MB=$(git merge-base <base> HEAD)` so the base branch's drift since the fork
isn't reviewed as ours. If `merge-base` fails (missing/typoed base, stale ref,
unrelated history), **stop and say so** — never fall back to the raw base tip;
the review scope would be silently wrong. Confirm a non-empty
`git diff --stat $MB`; if it's empty, say there's nothing to review and stop.

### 2. Fan out the two lenses — parallel, independent

Spawn **both** lens subagents in a **single message** (two `Agent` calls, so they
run concurrently), each with `model: opus`. Each prompt says:

- Read `.claude/skills/<lens>/SKILL.md` for your framework first.
- Inspect the FULL change in the repo at `<repoPath>` — your cwd may be a
  different worktree, so use `git -C <repoPath>` and absolute paths: run
  `git -C <repoPath> diff $MB` **and** `git -C <repoPath> status --short`
  (untracked files never appear in the diff), then Read every changed file plus
  enough surrounding code to judge it in context.
- You are reviewing **independently** — you are not seeing any other reviewer's
  findings, and that is the point.
- Return **all** your findings, no cap, each with: `title`, `location`
  (`file:line`), `problem` in your lens's terms, `suggestion` (concrete enough to
  apply verbatim if the other lens simply agrees), `disposition` (`fix` = worth
  changing in THIS PR / `drop` = observation only), and `severity`
  (`minor` = local polish / `major` = structural or correctness-adjacent). An
  empty list is fine only for a genuinely clean diff; don't fabricate, don't hold
  back.
- Pass the author's **rationale** when you have one, so deliberate decisions
  aren't flagged as defects.
- **Write your findings to `<repoPath>/.lens-debate/<lens>-findings.md` as your
  last act, then return only a one-paragraph summary.** The file is the artifact
  every later stage reads; your returned text is not. Never let the invoking
  agent transcribe your findings — it authored the diff you just reviewed, so a
  paraphrase by it is exactly the curation this skill exists to prevent.

The **lowy** prompt additionally carries the electricity probe: name the
**receptacle** (the stable interface consumers plug into), the **volatile
implementations** it encapsulates, whether this is "electricity" (a
domain-agnostic utility) or an application concern, and where a consumer is
forced to "expose the wires". If the diff has no such boundary, say so — don't
invent one.

### 3. Reconcile and apply — one pass

Point a single reconcile-and-apply subagent (`model: opus`, `repoPath` and `MB`
threaded through) at **both findings files** — it reads them off disk, so the
lists reach it exactly as each lens wrote them. It merges and implements; it does
**not** re-review, invent findings, or drop one silently. Every input finding
leaves this pass with exactly one outcome:

- **`fix` findings both lenses raised about the same issue** — two independent
  Opus lenses reaching the same conclusion *is* consensus. Apply once, under one
  canonical plan (copy the more concrete suggestion; merge only when each has a
  detail the other lacks). Mark the pair `≡`.
- **Uncontested solo `fix` findings** — apply as raised. The other lens read the
  same full diff and said nothing about that code; manufacturing an objection
  round to confirm silence is the cost this skill exists to stop paying.
- **`drop` findings** — recorded as observations, not applied.
- **Direct contradictions** — the two lenses raised the *same* code and their
  claims are incompatible (one says extract, the other says inline). Not applied:
  routed to **valve 1**.
- **Judgment-shaped calls** — routed to **valve 2**.

Each applied fix is its own commit, staging **only** that fix's files (never
`git add -A`), with the message:

```
fix(lens): <the fix's title>

<one-line summary of the change>

Raised by the <lowy|hickey> lens review (finding <id>). Not pushed or merged.
```

Never push, never merge. The pass writes its result to
`<repoPath>/.lens-debate/outcome.md` — per finding: id, origin, title, location,
outcome, and the commit SHA for applied fixes — and returns a short summary.

### 4. The two valves

**Valve 1 — bounded debate, contradictions only.** A finding reaches it only when
both lenses spoke about the same code and disagree.

- **Prefer a discriminating experiment.** If the disagreement is empirically
  testable, design the smallest test whose result differs under each lens's
  claim, run it, and let the output settle it. Record the command and its output
  — that *is* the argument, and it costs one tool call instead of a debate. This
  is how the contested calls in #1975 actually got settled.
- **Only when nothing decides it empirically**, run a bounded exchange: at most
  `--max-rounds` (default **2**) lowy ⇄ hickey round trips, each turn scoped to
  the contested hunks (both lenses have already read the whole diff once). If
  they converge, apply the agreed plan as in step 3. If they don't, **stop** —
  the cap is a hard cap, and the finding moves to valve 2.

**Valve 2 — hand it to the human.** Product scope ("is this worth doing in *this*
PR?"), naming, and boundary taste are not resolved by more agent rounds; they're
resolved by whoever owns the decision. Surface each with both lenses' positions
verbatim. **Do not pick a winner and do not argue it to a synthetic consensus** —
a tie a human breaks in thirty seconds beats a paragraph of manufactured
agreement.

### 5. Report, then comment

Report in chat, and return a `status` for callers:

- **`clean`** — both lenses found nothing worth raising.
- **`applied`** — every finding settled; the fixes are committed locally.
- **`needs-human`** — at least one finding sits in valve 2 (including anything
  that hit the debate cap). Name them; do not report this as consensus.
- **`merge-base-error`** — the scope couldn't be trusted (step 1).

Show `git log --oneline $MB..HEAD` and `git diff --stat $MB`, plus a per-finding
table: origin (lowy/hickey), title, location, disposition, how it settled
(`≡ agreed` / `applied` / `observation` / `experiment` / `debated` / `human`),
and the commit SHA for fixes.

**Render the comment body from the three files in `.lens-debate/` — always,
whether or not you post it.** The two findings files and `outcome.md` hold
everything the comment says, so it is rebuildable by anyone (a later stage, a
re-run, a human) without relying on an agent's memory of the run. Write it to
`<repoPath>/.lens-debate/comment.md`. Under `--no-comment` that file **is** the
hand-off: the caller posts it after its own push (see `/be-review`).

Unless `--no-comment` and when a PR exists, post it under the header
`## [⚖️ Lowy ∥ Hickey lens review](https://kolu.dev/blog/hickey-lowy/)`, with the
status, the per-lens finding counts, and any valve-2 items spelled out with both
positions:

```bash
gh pr comment <pr> -F "$repoPath/.lens-debate/comment.md"
```

## Safety & notes

- **The lenses are read-only reviewers.** The only writes to the tree come from
  the reconcile-and-apply pass (and, for a converged valve-1 finding, the same
  pass re-run on it).
- **Commits, but never pushes or merges.** "Applied" means the lenses agreed the
  change improves this PR — not "ship it". The human reviews and pushes.
- **No unbounded loop.** There is no run-to-consensus path: uncontested findings
  never debate, contradictions get evidence or at most `--max-rounds`, and
  everything else goes to the human.
- **`.lens-debate/` is the run's record**, not just scratch: `lowy-findings.md`,
  `hickey-findings.md`, `outcome.md`, `comment.md`. Each is written by the stage
  that produced it, so no stage retypes another's work. It's gitignored and
  per-worktree, so parallel runs don't collide and the files never show up in the
  diff the lenses review.

The lenses read `.claude/skills/{lowy,hickey}/SKILL.md` at runtime for their
frameworks.

This is generated from `agents/.apm/skills/lens-debate/`; edit the source there and run
`just ai::apm` to regenerate.

ARGUMENTS: $ARGUMENTS
