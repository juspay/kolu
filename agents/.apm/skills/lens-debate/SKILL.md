---
name: lens-debate
description: Run a structural-review debate between two lenses — lowy (volatility-based decomposition) and hickey (structural simplicity) — on the current diff. Each reviews independently, then the reviews are reconciled (cross-lens agreements settle with zero debate) and only genuinely contested findings debate in parallel per-file threads until the lenses agree; the agreed fixes are applied. Use when the user types `/lens-debate`, or asks to "have lowy and hickey review this", "run the lens debate", "debate this diff structurally", or "argue the structure of this PR until the lenses agree".
argument-hint: "[<pr-number>] [--base <branch>] [--max-rounds <n>] [--no-commit] [--no-apply] [--no-comment] [--with-police]"
---

# Lowy ⇄ Hickey lens debate

Two structural reviewers argue your change to a settled conclusion. **lowy**
(volatility-based decomposition — do boundaries encapsulate axes of change?) and
**hickey** (structural simplicity — are independent concerns complected, or one
thing fragmented?) each review the diff *independently*, then the engine
**reconciles** the two reviews — findings both lenses raised with compatible
conclusions settle immediately, unopposed solo findings settle after one batched
objection check — and only the **genuinely contested** findings are debated, in
parallel per-file threads, until the lenses agree on each one. The agreed `fix`
findings are applied — each as its own commit — and the outcome is **posted to
the PR** as a comment. You stay out of the middle: the script couriers
schema-constrained dispositions between the lenses and decides when they agree.

This is the sibling of `/agent-debate` — same debate-to-consensus shape (structured
per-round dispositions, commits but never pushes or merges), differing in *who debates
whom*. The **mechanics** now differ: this skill runs on the `Workflow` tool, whereas
`/agent-debate` drives a selected live Claude/Codex/Grok peer in a split terminal
(so it does not share an engine or schema-forced-JSON consensus with this one).

## Why this shape

The structure was found by trial in #1109, and two parts of it are load-bearing:

- **Independent parallel review, then debate.** lowy and hickey review the diff
  *simultaneously and independently* — neither sees the other's findings before
  forming its own. A first cut fed hickey a *pre-curated* "lowy finding" to rebut
  and it concluded *drop* — framing bias. Running the reviews independently in
  parallel made hickey raise the same issue on its own, flipping the verdict to
  *fix*. **Curation biases the outcome; independent-then-debate does not.** So the
  lenses never trust a handed-down finding list — each reads the source itself.
  (Reconciliation is downstream of this, never a shortcut around it: matching
  runs only *after* both independent reviews exist, so nothing a lens sees before
  forming its findings was curated.)

- **Both lenses run on Opus** (overriding their `model: sonnet` frontmatter), as
  `/be` already requires for structural review. Every lens *judgment* — the
  reviews, the objection checks, the debate turns — runs on Opus; only the
  mechanical stages (merge-base resolution, hunk extraction: Haiku) and the
  conservative reconciliation matcher (Sonnet) run cheaper, because none of them
  casts a vote.

- **The lowy lens runs Löwy's electricity probe.** Beyond the generic "where's
  the boundary?", the lowy reviewer must name the *receptacle* (the stable
  interface consumers plug into), the *volatile implementations* behind it,
  whether the thing is "electricity" (a domain-agnostic utility) or an app
  concern, and where a consumer is forced to "expose the wires." This is **not a
  second lens** — a separate voice would double-count lowy and reintroduce the
  framing bias above. It's the same volatility vote with a sharper probe that
  reliably pulls structural review out of abstraction and into "what plugs into
  what" (the abstraction-without-grounding failure mode a lens debate is prone
  to). It earned its keep on a live run (#1111).

## Why most findings never debate

Campaign history said most debates were 1-round agreements — the lenses raised
overlapping findings, or one lens simply had no objection to the other's. The
engine settles exactly those cases **without spending debate turns**, in a
reconciliation phase that runs strictly *after* both independent reviews:

1. **Cross-lens reconciliation.** One conservative matcher pairs findings the
   two lenses *independently* raised about the same underlying issue. A pair
   with equal dispositions (and, for fixes, suggestions that are the same change
   in substance — the matcher emits the canonical plan) settles on the spot: two
   independent Opus lenses arriving at the same conclusion **is** consensus;
   cross-examination adds nothing. A matched pair that *disagrees* (disposition
   or plan) is the real cross-examination case and goes to a thread. The matcher
   is instructed to never force a match — an unmatched finding merely falls
   through to the (cheap, safe) objection check, while a false pair would
   silently settle a debate that should have happened.
2. **Real-only rule.** A **minor**-severity solo finding in a file the other
   lens didn't flag *at all* auto-settles as raised: the other lens read the
   same full diff and had nothing to say about that region, so forcing a
   cross-exam manufactures an opinion it chose not to have. (Reviewers tag every
   finding `minor` or `major`; anything structural or correctness-adjacent is
   major and never takes this path.)
3. **Batched objection check.** Every remaining solo finding gets ONE
   opportunity per opposing lens to object — a single batched call per lens
   covering all of the opponent's solos, with the relevant hunks inlined. No
   objection → the finding settles exactly as raised. An objection → the finding
   is genuinely contested and debates. (A `code-police` finding, when
   `--with-police` ran, needs *both* debaters' non-objection — police has no
   vote, so a debater must ratify what it didn't raise.)

Only findings that survive all three — real, two-sided disagreements — reach the
debate phase.

## Why deadlock is not possible

Neither this skill nor `/agent-debate` has a deadlock exit — both run until
consensus, as many rounds as it takes. But the *reason* convergence is safe to
rely on is even stronger here. In `/agent-debate` the asymmetry is reviewer vs
**author**: the invoking agent wrote the code and carries an authorship stake, so in
principle it could dig in and dispute a finding round after round (the loop
trusts good-faith concession to break the tie, and aborts only on reviewer
*infrastructure* failure).

Here both sides are **disinterested third-party lenses** applied to someone
else's diff. Neither authored the code; neither has anything to defend. Their
disagreements are not ego conflicts but framework-weighting differences ("is this
worth fixing in *this* PR?") about a shared question with a knowable answer. Two
good-faith analysts, each told to argue from the code and concede when the other
is right, **converge** — there is no fixed position to defend. So there is **no
deadlock exit**: each debate thread runs until consensus, as many rounds as it
takes.

Three mechanics make that real rather than hopeful, now applied per thread:

1. **Independent review** (above) removes the up-front framing bias.
2. **Settled findings lock.** The moment both lenses agree on a finding's
   disposition, it leaves the thread's active set. The contested set is
   monotonically non-increasing — a thread can only shrink, never grow, so it
   can't oscillate a settled point back open.
3. **Sequential reveal inside the thread.** Within a thread round lowy posts
   first and hickey answers lowy's *current* positions, so the two land together
   instead of chasing each other's stale positions. (Round 1 is seeded with the
   positions already on record — review stances and objection-check positions —
   so the first exchange starts from real positions instead of re-eliciting
   them.)

`--max-rounds` (default **12**) is a pure safety backstop, applied **per
thread**, so a pathological oscillation can't run unbounded — not a deadlock
cap. Reaching it is reported as `unresolved` (needs a human), never `deadlock`,
and should essentially never happen between two good-faith lenses.

## Debate threads — parallel, scoped

Contested findings are grouped **per file** (findings about the same file share
a thread — their arguments usually interlock) and every thread debates **in
parallel**: each is its own lowy ⇄ hickey exchange with the sequential reveal
*inside* the thread. Wall clock is set by the *deepest single disagreement*, not
by `rounds × 2 × turn-time` summed across every finding.

Debate turns are **scoped**: at reconciliation a mechanical agent pre-extracts
each contested finding's relevant diff hunks, and a turn receives those hunks
plus both lenses' current positions — **not** an instruction to re-read the full
diff. The full-diff read is load-bearing in the *independent reviews* (that's
where curation bias is fought) and only there; by debate time both lenses have
already read the whole change once, and a turn may still `Read` the specific
files involved when the hunks aren't enough. If extraction comes back empty for
a finding, the turn is told so and reads the file directly — loudly, never a
silent fallback.

### The escalation valve

A thread that runs past **3 rounds** is *not* ground to stop — it keeps
debating, to consensus or the `--max-rounds` backstop (the no-deadlock invariant
is untouched). But it **is** returned in the result's **`escalations`** field:
`{ file, findingIds, rounds, resolved }` per escalated thread. **When to pull
the valve:** a caller/coordinator that sees an escalated thread — especially an
*unresolved* one — should hand that one thread's findings (with both lenses'
final positions from `settled`/`unresolved`) to warm, interactive debate
terminals (e.g. a live `/agent-debate`-style session or a human-adjudicated
debate) instead of re-running another cold engine pass over the whole diff. The
engine's exchange format is deliberately structured (schema-forced positions);
past ~3 rounds a disagreement is usually about *values or scope*, which
converges faster in a richer medium than in more rounds of the same format.

**This skill requires Claude Code's `Workflow` tool** (it is the engine). Under
codex/opencode runtimes the skill is inert.

## Arguments

Parse `[<pr-number>] [--base <branch>] [--max-rounds <n>] [--no-commit] [--no-apply] [--no-comment] [--with-police]`:

- **`<pr-number>`** (optional): a PR to debate. If given, `gh pr checkout <n>`
  first and default the base to that PR's base branch. If omitted, debate the
  **current branch's** diff.
- **`--base <branch>`**: ref to diff against. Always a **remote-tracking ref**,
  never a stale local branch. Default: `origin/<PR base>` when a PR number is
  given, else the repo default branch via
  `git symbolic-ref --short refs/remotes/origin/HEAD` (e.g. `origin/master`),
  used **as-is**. Fallback `origin/master`. Step 1 runs `git fetch origin` first.
  The workflow resolves this to the **merge-base** of `base` and HEAD and diffs
  against that, so the base branch's drift since the fork isn't reviewed as ours.
- **`--max-rounds <n>`**: safety backstop on debate rounds, **per thread**.
  Default **12**. Not a deadlock cap (see above) — raise it freely.
- **`--no-commit`**: still apply the agreed fixes to the working tree, but leave
  them uncommitted for you to commit yourself. Default is to **commit each fix
  individually** (see below).
- **`--no-apply`**: skip the Apply phase entirely — the debate still settles every
  finding, but the agreed `fix` plans are **returned** (the `fixes` field) instead
  of implemented. For callers that want to review or re-validate the change
  requests against a different tree before applying them themselves. Implies
  nothing about commenting; the comment then records the fixes as "handed off".
  (`--no-commit` is moot under `--no-apply` — nothing is implemented, so nothing
  is committed.)
- **`--no-comment`**: don't post the debate summary to the PR. By **default**,
  when a PR exists, the summary IS posted as a PR comment (see step 3).
- **`--with-police`**: fold in `/code-police` as a third, **lower-weight voice**.
  It runs in the parallel review and *seeds* findings into the debate, but does
  **not** get a vote in consensus — only lowy ⇄ hickey decide agreement. Off by
  default (in #1109 its findings largely duplicated the lens findings).

## Steps

### 1. Resolve context

- Determine `repoPath` (the worktree root, normally the cwd).
- **`git fetch origin`** so the base remote-tracking ref is current.
- Resolve `base` per the rules above (a remote-tracking ref like `origin/master`).
- If a PR number was given, `gh pr checkout <n>` and confirm the branch.
- Confirm a non-empty diff: `git diff --stat <base>`. If empty, say there's
  nothing to review and stop.

### 2. Run the debate Workflow

Invoke the **`Workflow` tool** pointing at this skill's committed script, passing
context through `args`:

```
Workflow({
  scriptPath: ".claude/skills/lens-debate/debate.workflow.js",
  args: {
    repoPath: "<worktree root>",         // also the per-worktree scratch dir root
    base: "<base branch>",               // a remote-tracking ref, e.g. origin/master
    maxRounds: <n, default 12>,          // per-thread safety backstop
    commit: <false only if --no-commit>,
    apply: <false only if --no-apply>,
    withPolice: <true only if --with-police>,
    rationale: "<optional author note on deliberate design decisions>",
    model: "<optional model override; defaults to opus>"
  }
})
```

The workflow runs in the background and notifies you when it completes. It runs
four phases the user can watch via `/workflows`:

- **Review** — `review:lowy`, `review:hickey` (and `review:code-police` with
  `--with-police`) in parallel, each independent, each a full-diff read.
- **Reconcile** — `reconcile:match` (the cross-lens matcher, Sonnet),
  `reconcile:hunks` (per-finding hunk extraction, Haiku), then
  `objection:lowy` / `objection:hickey` (one batched Opus objection check per
  lens over the opponent's solo findings). Everything that settles here settles
  with **zero debate turns**.
- **Debate** — parallel per-file threads, `lowy:<file>:rN` / `hickey:<file>:rN`,
  each thread running until every finding in it is agreed. Agreed findings drop
  out of each subsequent thread round. Agreement on a `fix` means both lenses
  agree on the disposition *and* the plan — if they both say `fix` but propose
  different changes, the finding stays open until the plans converge too (so
  Apply never picks one lens's plan arbitrarily).
- **Apply** — a single `apply:all` agent implements **every** agreed `fix` in one
  session and (unless `--no-commit`) commits each one individually, staging
  **exactly** that fix's changed files with a message carrying the debate context.
  One orientation for all fixes instead of a fresh implement+commit agent per
  finding. Skipped wholesale under `--no-apply` — the plans come back in `fixes`
  for the caller to apply.

When `rationale` is set, pull it from the PR/issue description (the deliberate
design decisions the author wants the lenses to respect, e.g. a deliberate
fail-open) so the lenses don't flag intentional choices.

Ephemeral scratch (commit-message files) lives under the gitignored, per-worktree
`<repoPath>/.lens-debate/`, so parallel debates in different worktrees never
collide and the scratch never shows up in the diff the lenses review. It returns:

```
{ status: "consensus" | "apply-incomplete" | "unresolved" | "clean",
  rounds, base, withPolice,
  settled,     // per-finding: id, origin, title, location, severity, agreed
               // disposition, plan, HOW it settled (`via`: reconciled |
               // auto-minor | no-objection | objection-agreed | debated), both
               // reasonings for debated ones; a matched pair's secondary id
               // carries duplicateOf/pairedWith
  unresolved,  // findings still contested at the per-thread backstop (empty on
               // consensus; matched pairs appear once)
  applied,     // [{ id, title, pairedWith, files, commit }] (empty under --no-apply)
  applyGaps,   // [{ id, reason }] agreed fixes that didn't cleanly land — empty unless status is "apply-incomplete"
  fixes,       // the agreed `fix` findings with converged plans — the caller's change requests under --no-apply
  reviews,     // each lens's independent findings
  history,     // per-thread, per-round dispositions
  escalations, // [{ file, findingIds, rounds, resolved }] threads that ran past 3 rounds — the valve (see above)
  turns,       // per-stage agent-call counts { mech, review, match, objection, debate, apply }
  comment }    // the deterministically rendered PR comment body — post it VERBATIM (step 3)
```

- **consensus** — every finding settled (the normal outcome). `rounds` is the
  depth of the deepest debate thread; `rounds: 0` means everything settled at
  reconciliation, with zero debate turns.
- **clean** — every lens found nothing worth raising.
- **apply-incomplete** — the lenses *converged*, but the Apply phase didn't land
  every agreed fix cleanly: a fix was **missing from the apply agent's output**
  (so we can't confirm it was applied) or, in commit mode, was **changed but
  returned no commit SHA** (its per-fix commit didn't land). The offending fixes
  are in `applyGaps`. Any edits present stay in the working tree, but this is
  **not** a clean consensus — surface the gap and reconcile it (re-apply or commit
  the outstanding fix) before relying on the per-fix history. Do **not** report it
  as a plain consensus.
- **unresolved** — a thread hit the per-thread backstop with findings still
  contested. Rare; needs a human. This is NOT a deadlock — the lenses simply
  didn't converge in the round budget; raise `--max-rounds`, adjudicate the
  listed findings, or pull the escalation valve (hand the thread to warm debate
  terminals — see above).

### 3. Present the result

Report in chat (do **not** push or merge — the per-fix commits sit on the local
branch for the human to review):

- The outcome (`status`), the deepest-thread round count, and how the findings
  settled (the `via` mix: reconciled / auto-minor / unopposed / debated).
- `git log --oneline <base>..HEAD` (the per-fix commits) and `git diff --stat
  <base>` so the user sees what the debate changed.
- A per-finding table from `settled`: origin (lowy/hickey/police), title,
  location, agreed disposition (fix/drop), how it settled, and the applied
  commit SHA for fixes.
- On any **unresolved** finding, surface both lenses' final positions plainly so
  the human can adjudicate — do not pick a winner yourself.
- On any **escalated** thread, say so and point at the valve: the caller can
  hand that thread's findings to warm debate terminals instead of re-running.
- **Post the debate summary to the PR (default).** When a PR exists and
  `--no-comment` was NOT passed, post the workflow's **deterministically rendered
  `comment`** verbatim — write it to a file and `gh pr comment <pr> -F <file>`:

  ```bash
  mkdir -p "$repoPath/.lens-debate"   # clean/all-drop/--no-commit runs never run the Apply commit step, so the dir may not exist yet
  printf '%s' "$comment" > "$repoPath/.lens-debate/comment.md"
  gh pr comment <pr> -F "$repoPath/.lens-debate/comment.md"
  ```

  The workflow returns `comment` already rendered — the
  `## [⚖️ Lowy ⇄ Hickey lens debate](https://kolu.dev/blog/hickey-lowy/)` header
  with the outcome badge and deepest-thread round count, the independent per-lens
  finding counts, the settled-without-debate breakdown, the applied fixes (with
  commit SHAs, matched pairs marked `≡`), the agreed no-change observations, any
  escalated threads, and any unresolved findings with both lenses' positions.
  Posting the returned string (rather than re-improvising a table) keeps the
  comment a **deterministic** render of the debate outcome. This mirrors
  `/agent-debate`; `--no-comment` suppresses it.

## Safety & notes

- **The lenses are read-only reviewers; only the Apply phase writes.** lowy and
  hickey never edit code — they only emit dispositions. The sole writes to the
  tree come from the single `apply:all` agent implementing the *agreed* fixes
  (one session, one commit per finding) — not one agent per fix.
- **Commits, but never pushes or merges.** Each agreed fix is committed locally
  (unless `--no-commit`) so the PR history reads as the debate's conclusions, but
  the skill never pushes or merges. Consensus means "both lenses agree on the
  disposition," not "ship it" — the human reviews the commits and pushes/merges.
- **No deadlock; bounded by a per-thread safety backstop.** Every thread runs to
  consensus. `--max-rounds` only prevents a pathological unbounded run; reaching
  it is reported as `unresolved`, not deadlock. The escalation valve (>3 rounds
  → `escalations`) is advisory output, never an exit.
- **Reconciliation never curates.** The matcher runs only after both independent
  reviews exist, and when unsure it does NOT pair — a wrong non-match costs one
  cheap objection check; a wrong match would silently skip a debate.
- **Parallel-safe.** Ephemeral scratch lives under the gitignored, per-worktree
  `<repoPath>/.lens-debate/`, so debates on many worktrees run at once without
  clobbering each other.
- **Posts to the PR by default** (unless `--no-comment`) — the point is to leave
  the structural-review trail on the PR.

## Files

- `debate.workflow.js` — the Workflow script (parallel review + reconciliation +
  the parallel per-file thread debate + the apply phase). Its decision logic is
  unit-tested by evaluating the script with stubbed `agent()` responses — see
  `agents/tests/debate.workflow.test.ts` in the kolu repo.

The lenses read `.claude/skills/{lowy,hickey}/SKILL.md` (and
`.claude/skills/code-police/SKILL.md` with `--with-police`) at runtime for their
frameworks.

This is generated from `agents/.apm/skills/lens-debate/`; edit the source there and run
`just ai::apm` to regenerate.

ARGUMENTS: $ARGUMENTS
