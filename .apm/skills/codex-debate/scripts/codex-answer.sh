#!/usr/bin/env bash
#
# codex-answer.sh — the canonical, deterministic codex invocation for the
# SYMMETRIC answer-debate (the `answer` mode of /codex-debate). codex answers a
# freeform user prompt as one of two equal debaters; on follow-up rounds it
# CROSS-CHECKS the other assistant's ("CLAUDE") latest answer against its own and
# either concedes (revising its answer) or holds firm (recording objections),
# looping until both sides agree. codex runs as a READ-ONLY peer — it may read
# this repo to ground its answer (git diff/log, read files, grep) but cannot
# modify anything. The output is constrained to codex-answer.schema.json and
# written to <out-json>.
#
# This script owns only what is SPECIFIC to answering a prompt: arg parsing, the
# warm/cold prompt text, the answer schema + session file, and the answer-shaped
# error verdict. The shared codex-driving core (read-only exec/resume, retry/
# backoff, thread-id capture, session persistence) lives in codex-exec-lib.sh.
#
# Usage:
#   codex-answer.sh <prompt-file> <crosscheck-file|-> <out-json> [reasoning-effort]
#
#   <prompt-file>     path to a file holding the user's prompt/question
#   <crosscheck-file> path to a file holding CLAUDE's latest answer (JSON) for
#                     codex to cross-check, or "-" on the first round (codex
#                     hasn't seen CLAUDE's answer yet — it answers independently)
#   <out-json>        path the JSON answer is written to (also echoed to stdout)
#   <reasoning-effort> codex model_reasoning_effort for this run; the answer
#                     workflow passes its REASONING_EFFORT constant here so the
#                     value has one home. Defaults to "xhigh" for standalone runs.
#
# Notes:
#   * codex runs under `--sandbox read-only` (see codex-exec-lib.sh), which enforces
#     read-only at the kernel boundary, NOT merely by prompt text. codex reads
#     arbitrary repo files to ground its answer and could be prompt-injected by file
#     contents, so the read-only promise must be enforced, not advertised.
#   * Always emits a schema-valid answer on stdout, even if codex errors — a
#     synthesized error answer (reviewerError:true) so the loop never wedges.
#   * WARM SESSION: round 1 cold-starts codex; every later round resumes that same
#     session so codex retains its OWN prior answer + reasoning across rounds.
set -uo pipefail

prompt_file="${1:?usage: codex-answer.sh <prompt-file> <crosscheck-file|-> <out-json> [reasoning-effort]}"
crosscheck_file="${2:?missing crosscheck-file (use - for none)}"
out="${3:?missing out-json path}"
# The answer workflow owns this value (its REASONING_EFFORT constant) and passes
# it down; "xhigh" is only the default for a standalone invocation of this script.
effort="${4:-xhigh}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
schema="$here/codex-answer.schema.json"
# shellcheck source=codex-exec-lib.sh
source "$here/codex-exec-lib.sh"

# The user's prompt. Required and must be non-empty — an empty prompt would make
# codex answer nothing and silently degrade the debate, so fail loud instead.
if [ ! -s "$prompt_file" ]; then
  echo "ERROR: prompt file '$prompt_file' is missing or empty." >&2
  exit 2
fi
prompt_text="$(cat "$prompt_file")"

# Pull CLAUDE's latest answer, if any (the cross-check input). Built as a plain
# string and injected below via a simple variable reference so any special
# characters in the JSON (backticks, $, ...) stay literal.
crosscheck=""
if [ "$crosscheck_file" != "-" ]; then
  if [ -s "$crosscheck_file" ]; then
    crosscheck="$(cat "$crosscheck_file")"
  else
    # A cross-check was expected (path given, not "-") but the file is missing or
    # empty — the handoff broke. Proceed without it, but make the failure loud so
    # codex's cross-check isn't silently skipped.
    echo "WARNING: expected cross-check file '$crosscheck_file' is missing or empty; proceeding with no cross-check this round." >&2
  fi
fi

# WARM SESSION. Round 1 (crosscheck_file == "-") cold-starts and resets any stale
# id; later rounds resume codex's own answer session. Resolve the id first so the
# prompt below can lean on codex's retained context when warm.
session_id_file="$(dirname "$out")/codex-answer-session.id"
[ "$crosscheck_file" = "-" ] && is_round1=1 || is_round1=
resume_id="$(codex_resolve_session "$session_id_file" "$is_round1")"

# Synthesize codex-answer's error verdict shape when codex produces nothing after
# every attempt (called by codex_exec_round). reviewerError:true is the signal the
# workflow aborts the debate on.
synthesize_error_verdict() {
  local out="$1" tail_log="$2" attempts="$3"
  jq -n --arg log "$tail_log" --arg attempts "$attempts" '{
    answer: ("codex produced no answer this round after " + $attempts + " attempt(s). Tail of log: " + $log),
    keyPoints: [],
    agreesWithOther: false,
    objections: [],
    changedMind: "",
    reviewerError: true
  }' >"$out"
}

# Two prompts: a lean cross-check follow-up for the WARM (resume) path that leans
# on codex's retained answer, and the full answer prompt for the COLD path (round
# 1, or the fallback when no session id was captured). Unquoted heredocs: only
# $prompt_text and $crosscheck expand; their expansions are inserted literally
# (heredoc results aren't re-scanned), so special chars stay inert.
if [ -n "$resume_id" ] && [ -n "$crosscheck" ]; then
  prompt="$(cat <<EOF
You are CODEX, continuing the SAME answer session you started earlier — you still
have your own previous answer and reasoning in context. You and another assistant
("CLAUDE") were each asked the SAME question and are now cross-checking each other
to reach ONE agreed answer.

The original question was:
$prompt_text

CLAUDE's LATEST answer (JSON) is:
$crosscheck

Cross-check CLAUDE's answer against your own (READ-ONLY — you may read repo files,
git diff/log, grep to verify, but do NOT modify, create, or delete anything, and
run no git write command: add/commit/push/stash/checkout). Then:
  - Where CLAUDE is right and you were wrong or incomplete, UPDATE your answer to
    match and note what you changed in changedMind.
  - Where CLAUDE is wrong or has a gap, keep your position and record it under
    objections with a specific, evidence-backed reason (cite file:line for repo
    questions).

Return the JSON schema:
  - answer: your UPDATED, self-contained unified answer as it stands now.
  - keyPoints: the core claims your answer rests on.
  - objections: your remaining disagreements with CLAUDE's latest answer (empty
    when you fully agree).
  - changedMind: what CLAUDE convinced you to change this round (empty if nothing).
  - agreesWithOther: true ONLY when CLAUDE's latest answer is correct and complete
    and you have NO objection left — your two answers say the same thing.
EOF
)"
else
  prompt="$(cat <<EOF
You are CODEX, a rigorous, truthful expert. Answer the user's question below
thoroughly and honestly — exactly as you would for a careful colleague. You are in
a debate with another assistant ("CLAUDE") who is answering the SAME question
independently; afterward you'll cross-check each other until you agree, so give
your best, most defensible answer now.

You may inspect this repository to ground your answer (READ-ONLY — read files, run
git diff/log/grep; do NOT modify, create, or delete anything, and run no git write
command: add/commit/push/stash/checkout). Cite file:line for claims about this
codebase. If the question isn't about this repo, answer from your own knowledge.

The question:
$prompt_text

Return the JSON schema:
  - answer: your complete, self-contained answer.
  - keyPoints: the core claims your answer rests on, one per item.
  - objections: leave empty this round (you haven't seen CLAUDE's answer yet).
  - changedMind: empty string this round.
  - agreesWithOther: false this round (you haven't seen CLAUDE's answer yet).
EOF
)"
fi

# Drive codex for this round (retry/backoff, thread capture, error fallback) — the
# shared core does the work; this script supplied the prompt, schema, and shapes.
codex_exec_round "$schema" "$out" "$session_id_file" "$effort" "$resume_id" "$prompt"
