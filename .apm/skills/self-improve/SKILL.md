---
name: self-improve
description: >-
  Run at the end of a /be run (or when the user types `/self-improve`): mine
  this session's JSONL transcript for every point a human had to intervene and
  engineer it out. Produces nothing unless a lesson durably recurs; then ships
  a small, evidence-cited edit to the apm sources as a separate draft PR a
  human reviews. Never auto-select from a natural-language request.
context: fork
argument-hint: "<session-id> [--dry-run]"
---

# Self-improve

**Goal: the next /be run finishes autonomously — same quality bar, zero
intervention.** Autonomy is earned by meeting the bar unprompted, never by
weakening a gate: a "fix" that buys fewer interventions by softening review,
evidence, or done-criteria is this skill's worst failure. Speed is the second
axis: same shipped PR, less wall-clock, usually by parallelizing *independent*
work (never the serial gauntlet, which stays sole-editor). Every human
follow-up marks a skill that failed to carry the run — treat each as a bug in
**our** skills, not the model's.

**Produce nothing unless a lesson durably recurs.** A clean run reported in one
line is the common, correct outcome. The framework (taxonomy, autonomy score,
lever map, anti-patterns) lives in
`docs/atlas/src/content/atlas/llm-autonomy.mdx` — reuse it, don't reinvent it.

## Steps

1. **Locate the transcript.** This runs forked, so the caller passes the run's
   id: `SID="${1:-$CLAUDE_CODE_SESSION_ID}"`, then
   `find ~/.claude/projects -name "$SID.jsonl"` — exactly one match or stop;
   never guess the newest file.
2. **Extract interventions** with jq/grep, not an LLM read: human follow-up
   turns are the primary signal; add the mechanical tells (failed tool calls,
   Read-before-Edit errors, production-kill near-misses, scope over-reach,
   premature "done", Stop-hook feedback, and independent work run serially).
3. **Keep only what durably recurs** — ≥3 hits, an irreversible near-miss, or
   a repeat from a prior run; everything else is a PR-body observation, not an
   edit. Nothing durable → report "clean run" and stop.
4. **Engineer it out, lowest-churn first**: cross-link an existing skill >
   sharpen one clause > new rule or skill, last resort. Fixes land in an apm
   **source** only — grep **both** trees (root `.apm/skills/*` and
   `agents/.apm/skills/*`) per `.claude/rules/apm-workflow.md`. **Word each
   fix as the weakest rule that covers the evidence** (the weakest valid
   hypothesis generalises best — arXiv:2301.12987 — not the shortest): every
   prohibition, mandate, and scope must trace to an observed intervention; cut
   any commitment the evidence doesn't demand, and never tiebreak on brevity —
   a terse blanket ban is usually *stronger* than a precisely-scoped clause,
   and misfires on unobserved runs. State the rule without retelling the
   incident: provenance goes in the PR body and git history, not the skill
   text.
5. **Ship from a throwaway worktree — PWD is NEVER mutated** (steps 1–4 only
   read it: no `git switch`, no edits, no commits here). Branch off
   freshly-fetched `origin/master`:
   ```sh
   git fetch origin
   DEF=$(git symbolic-ref --short refs/remotes/origin/HEAD)
   ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
   WT="$ROOT/.worktrees/self-improve-$SID"; BR="chore/self-improve-$SID"
   git worktree prune
   git worktree add -b "$BR" "$WT" "$DEF"
   ```
   Apply the edits inside `$WT`, then inside `$WT`: **an `agents/.apm/**` edit
   must be committed BEFORE `just ai::apm`** — the regen vendors that package
   from a git checkout, so an uncommitted edit silently regenerates the old
   text. Then `just ai::apm`, confirm the new wording actually landed in the
   generated `.claude/skills/`, `just fmt`, `just check`.
   - Green → commit (`chore(skills): …` + a provenance trailer citing `$SID`),
     push, open a **draft** PR via `/forge-pr` with a per-edit evidence
     ledger. **Never merge** — the human reviews.
   - Red → **STOP, open NO PR**, report the failed gate and its output — never
     collapse a red gate to a silent "clean run".
6. **Tear down last, on both paths** (separate agent steps mean no EXIT trap
   spans them): `git worktree remove --force "$WT"; git worktree prune;
   git branch -D "$BR"`. The PR rides the pushed remote ref, so this is safe —
   a crash must leave neither a dangling worktree nor a dangling branch.

ARGUMENTS: $ARGUMENTS
