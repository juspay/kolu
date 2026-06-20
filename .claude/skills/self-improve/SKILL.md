---
name: self-improve
description: >-
  Run at the end of a /be run (or when the user types `/self-improve`): mine this
  session's JSONL transcript for every point a human had to intervene and engineer
  it out, so the next run finishes autonomously. Produces nothing unless a lesson
  durably recurs; then ships a small, evidence-cited edit to the `.apm/skills/*`
  sources as a separate draft PR a human reviews — never on the /be branch, never
  merged. Never auto-select from a natural-language request.
context: fork
argument-hint: "<session-id> [--dry-run]"
---

# Self-improve

**The goal: the next /be run finishes autonomously — a shipped, reviewed PR from a
single human turn, with virtually zero further intervention — while holding the same
bar for quality and correctness.** Autonomy is earned by the agent meeting that bar
*unprompted*, never by lowering it: a "fix" that buys fewer interventions by weakening
a quality gate (skipping evidence, softening the review gauntlet, calling tests-pass
"done") is the worst failure of this skill, not a win.

Every human follow-up in this session — a correction, an interruption, an approval, a
"continue", a "you forgot X" — marks a point where a skill failed to carry the run past
it and a human had to step in. Mine those and engineer each one out. Treat every
intervention as a bug in **our** skills, not the model's.

**Produce nothing unless a lesson durably recurs.** A clean run reported in one line
is the common, correct outcome; a churny PR every run makes the skill-set worse —
restraint over volume.

Reuse the framework, don't reinvent it — `docs/atlas/src/content/atlas/llm-autonomy.mdx`
holds the taxonomy, the autonomy score, the lever map (where fixes go), and the
anti-patterns (fixes that backfire: never reintroduce a post-§0 question, never
parallelize the serial gauntlet). This skill is the per-session loop under that
note's corpus audit.

## Steps

1. **Locate the transcript** — this skill runs forked (`context: fork`) so the whole
   analysis stays off /be's context, which means it does **not** share /be's session;
   the caller passes the run's id as the argument. `SID="${1:-$CLAUDE_CODE_SESSION_ID}"`,
   then `find ~/.claude/projects -name "$SID.jsonl"`. Exactly one match or stop; never
   guess the newest file.
2. **Extract the human interventions** with jq/grep, not an LLM read — the human-typed
   follow-up turns (drop tool results, sidechains, local-command echoes) are the primary
   signal; each is a place autonomy broke. Classify them, then add the mechanical tells
   the human didn't have to flag: failed tool calls (`is_error`), Read-before-Edit
   (`File has not been read yet`), production-kill near-misses (a `pkill`/`just dev` while
   `dev-server` was never loaded), scope over-reach (`gh pr merge --admin`), premature
   'done' (`stub`, or "tests pass" for "I watched it work"), `Stop hook feedback`, speed waste.
3. **Keep only what durably recurs** — ≥3 hits, an irreversible near-miss, or a repeat
   from a prior run; everything else is an observation for the PR body, not an edit.
   Nothing durable → report "clean run" and stop. (With ultracode, confirm survivors with
   a read-only fan-out, one agent each, before editing.)
4. **Engineer it out, lowest-churn first** — a fix turns a human intervention into a
   baked-in default: cross-link an existing skill (most friction is a rule that just
   wasn't loaded) > sharpen one clause > write a new rule or skill, last resort. Edit
   `.apm/skills/*` **sources only** — `.claude/`, `.agents/`, `AGENTS.md` are generated.
   Each edit honors fail-fast / electricity / reuse-source and trips no llm-autonomy
   anti-pattern.
5. **Regenerate + check** — `just ai::apm`, then `just fmt` and `just check`. Red → stop.
6. **Ship a separate draft PR** — branch off the default (`chore/self-improve-*`), commit
   the sources + regenerated copies, open it draft via `/forge-pr` with a per-edit evidence
   ledger, then `git switch -` back to the /be branch. **Never merge, never `--admin`** —
   the human reviews; merging is what makes the edits live.

ARGUMENTS: $ARGUMENTS
