#!/usr/bin/env bash
#
# codex-answer.sh — the canonical, deterministic codex invocation for the
# SYMMETRIC answer-debate (the prompt-mode of /codex-debate). codex answers a
# freeform user prompt as one of two equal debaters; on follow-up rounds it
# CROSS-CHECKS the other assistant's ("CLAUDE") latest answer against its own and
# either concedes (revising its answer) or holds firm (recording objections),
# looping until both sides agree. codex runs as a READ-ONLY peer — it may read
# this repo to ground its answer (git diff/log, read files, grep) but cannot
# modify anything. The output is constrained to codex-answer.schema.json and
# written to <out-json>.
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
#   * codex runs under `--sandbox read-only`, which enforces read-only at the
#     execution boundary (the kernel sandbox blocks file writes and other
#     state-mutating syscalls), NOT merely by prompt text. codex reads arbitrary
#     repo files to ground its answer and could be prompt-injected by file
#     contents, so the read-only promise must be enforced, not advertised. codex
#     auto-falls-back to its bundled bubblewrap when the system one is absent, so
#     this works in containers; read-only permits read commands (git diff/status,
#     grep, reading files) but denies writes. `codex exec` is already
#     non-interactive (approval policy "never"), so a blocked command is denied
#     outright rather than escalating to a prompt that would wedge the loop.
#   * Always emits a schema-valid answer on stdout, even if codex errors — a
#     synthesized error answer (reviewerError:true) so the loop never wedges.
#   * WARM SESSION: round 1 cold-starts codex and records its session id under the
#     scratch dir; every later round resumes that same session (`codex exec
#     resume <id>`) so codex retains its OWN prior answer + reasoning across rounds
#     instead of reconstructing it each time. If the id was never captured, a later
#     round cleanly falls back to a cold start.
set -uo pipefail

prompt_file="${1:?usage: codex-answer.sh <prompt-file> <crosscheck-file|-> <out-json> [reasoning-effort]}"
crosscheck_file="${2:?missing crosscheck-file (use - for none)}"
out="${3:?missing out-json path}"
# The answer workflow owns this value (its REASONING_EFFORT constant) and passes
# it down; "xhigh" is only the default for a standalone invocation of this script.
effort="${4:-xhigh}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
schema="$here/codex-answer.schema.json"
log="$out.log"

# The out path lives under a per-worktree scratch dir (.codex-debate/); make sure
# it exists before codex tries to write the answer there.
mkdir -p "$(dirname "$out")"

# The user's prompt. Required and must be non-empty — an empty prompt would make
# codex answer nothing and silently degrade the debate, so fail loud instead.
if [ ! -s "$prompt_file" ]; then
  echo "ERROR: prompt file '$prompt_file' is missing or empty." >&2
  exit 2
fi
prompt_text="$(cat "$prompt_file")"

# Never let a stale answer from a previous run survive: if the current codex
# invocation fails to write one, the empty-check below must catch it and
# synthesize an error answer (otherwise a leftover file reads as a fresh answer).
rm -f "$out" "$log"

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

# WARM SESSION. codex keeps its OWN answer + reasoning across rounds by resuming
# the same codex session instead of cold-starting `codex exec` each round. The
# session id (codex's thread_id) is persisted in the scratch dir after round 1
# and reused on every follow-up round, so when it cross-checks CLAUDE it argues
# from its original rationale rather than reconstructing it.
#
#   * Round 1 (crosscheck_file == "-"): fresh `codex exec`; capture thread_id below.
#   * Later rounds: `codex exec resume <id>` with just the cross-check follow-up,
#     relying on codex's retained context.
#   * Fallback: if no id was captured (round-1 capture failed), a later round
#     cold-starts with the FULL prompt + cross-check — graceful, never a wedge.
session_id_file="$(dirname "$out")/codex-answer-session.id"
resume_id=""
if [ "$crosscheck_file" = "-" ]; then
  # Round 1 of a fresh debate: start a NEW session and drop any session id left
  # behind by a previous debate in this worktree, so we never resume a stale one.
  rm -f "$session_id_file"
elif [ -s "$session_id_file" ]; then
  resume_id="$(cat "$session_id_file")"
fi

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

# One codex invocation: warm-resume when we have a session id (carries codex's own
# prior answer), else a cold start. `--json` emits a `thread.started` event
# carrying codex's thread_id, captured below to resume next round; it does NOT
# change the answer, which `--output-schema`/`-o` still write to "$out". `resume`
# has no `--sandbox` flag, so read-only is enforced there via `-c sandbox_mode` —
# the same kernel-enforced policy, set through config instead of the flag.
run_codex() {
  if [ -n "$resume_id" ]; then
    codex exec resume \
      -c sandbox_mode="read-only" \
      -c model_reasoning_effort="$effort" \
      --json \
      --output-schema "$schema" \
      -o "$out" \
      "$resume_id" "$prompt"
  else
    codex exec \
      --sandbox read-only \
      -c model_reasoning_effort="$effort" \
      --json \
      --output-schema "$schema" \
      -o "$out" \
      "$prompt"
  fi
}

# model_reasoning_effort is scoped to the debate here (via -c, from the $effort the
# workflow passes down — default "xhigh") rather than relying on the user's global
# ~/.codex/config.toml — we always want codex thinking at full depth here.
#
# RETRY/BACKOFF. codex's CLI fails transiently often enough to matter (API
# hiccups, a spurious internal error) and writes no answer — which would otherwise
# degrade the round to reviewer-error on a single bad roll. Retry with linear
# backoff, accepting the first attempt that writes a non-empty answer to "$out".
# Tunable via env: CODEX_REVIEW_RETRIES (total attempts, default 3),
# CODEX_REVIEW_BACKOFF (base seconds, default 5 — attempt n waits n*base). Only
# after every attempt fails empty do we synthesize the reviewerError answer below.
attempts="${CODEX_REVIEW_RETRIES:-3}"
backoff="${CODEX_REVIEW_BACKOFF:-5}"
# Validate both as positive integers. Left unchecked, a non-numeric value makes the
# arithmetic test error every iteration, so the loop would spin forever instead of
# giving up. Fall back to the documented defaults (and clamp attempts to >=1)
# loudly rather than wedge the headless debate on a typo'd override.
if ! [[ "$attempts" =~ ^[0-9]+$ ]] || [ "$attempts" -lt 1 ]; then
  echo "WARNING: CODEX_REVIEW_RETRIES='$attempts' is not a positive integer; using 3." >&2
  attempts=3
fi
if ! [[ "$backoff" =~ ^[0-9]+$ ]]; then
  echo "WARNING: CODEX_REVIEW_BACKOFF='$backoff' is not a non-negative integer; using 5." >&2
  backoff=5
fi
n=1
: >"$log"  # start each round fresh; attempts below APPEND so no failure's diagnostics are lost
while :; do
  rm -f "$out"
  # Append (not truncate): when every attempt fails, the synthesized reviewerError
  # answer's tail_log must reflect ALL attempts' diagnostics, not just the last.
  echo "=== attempt $n/$attempts ===" >>"$log"
  if ! run_codex </dev/null >>"$log" 2>&1; then
    echo "codex exec exited non-zero (attempt $n/$attempts; see $log)" >&2
  fi
  # Success the moment codex writes an answer: the kernel sandbox + --output-schema
  # make a non-empty "$out" a real, schema-valid answer, not a partial.
  [ -s "$out" ] && break
  # Out of attempts — fall through to the synthesized reviewerError answer.
  [ "$n" -ge "$attempts" ] && break
  wait_s=$(( backoff * n ))
  echo "codex produced no answer (attempt $n/$attempts); retrying in ${wait_s}s..." >&2
  n=$(( n + 1 ))
  sleep "$wait_s"
done

if [ -s "$out" ]; then
  # Persist codex's session id so NEXT round can resume this same warm session
  # (carrying codex's own prior answer + reasoning). The successful attempt's
  # `thread.started` is the last one appended to the log; on a resume round it
  # echoes the same id, so overwriting is a harmless refresh. Failure to capture
  # an id just means next round cold-starts via the fallback above — not fatal.
  sid="$(grep -o '"thread_id":"[^"]*"' "$log" | tail -1 | cut -d'"' -f4)"
  if [ -n "$sid" ]; then
    printf '%s\n' "$sid" >"$session_id_file"
  fi
fi

if [ ! -s "$out" ]; then
  # codex produced no answer — synthesize a schema-valid error answer so the debate
  # loop can surface the failure instead of hanging. The reviewerError flag is the
  # machine-detectable signal the workflow uses to abort with a terminal failure: a
  # broken/unavailable codex is INFRASTRUCTURE failure, not substantive
  # disagreement, so it must NOT spin the loop forever.
  tail_log="$(tail -c 2000 "$log" 2>/dev/null || true)"
  jq -n --arg log "$tail_log" --arg attempts "$attempts" '{
    answer: ("codex produced no answer this round after " + $attempts + " attempt(s). Tail of log: " + $log),
    keyPoints: [],
    agreesWithOther: false,
    objections: [],
    changedMind: "",
    reviewerError: true
  }' >"$out"
fi

cat "$out"
