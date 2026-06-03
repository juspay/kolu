#!/usr/bin/env bash
#
# codex-review.sh — the canonical, deterministic codex invocation for the
# codex<->claude review debate. Runs the codex CLI as a READ-ONLY reviewer of
# the current working-tree state against a base branch, constrained to
# codex-verdict.schema.json, and writes the JSON verdict to <out-json>.
#
# Usage:
#   codex-review.sh <base-branch> <rebuttal-file|-> <out-json>
#
#   <base-branch>    branch to diff against (e.g. master)
#   <rebuttal-file>  path to a file holding CLAUDE's previous response (JSON),
#                    or "-" on the first round (no rebuttal yet)
#   <out-json>       path the JSON verdict is written to (also echoed to stdout)
#
# Notes:
#   * codex runs under `--sandbox read-only`, which enforces read-only at the
#     execution boundary (the kernel sandbox blocks file writes and other
#     state-mutating syscalls), NOT merely by prompt text. codex reviews
#     arbitrary diffs and could be prompt-injected by file contents, so the
#     read-only promise must be enforced, not advertised. codex auto-falls-back
#     to its bundled bubblewrap when the system one is absent, so this works in
#     containers; `--sandbox read-only` permits read-only command execution
#     (git diff/status, reading files) but denies writes. `codex exec` is already
#     non-interactive (approval policy "never"), so a command the sandbox blocks
#     is denied outright rather than escalating to a prompt that would wedge the
#     headless loop.
#   * Always emits a schema-valid verdict on stdout, even if codex errors — a
#     synthesized error verdict (approved:false) so the loop never wedges.
set -uo pipefail

base="${1:?usage: codex-review.sh <base-branch> <rebuttal-file|-> <out-json>}"
rebuttal_file="${2:?missing rebuttal-file (use - for none)}"
out="${3:?missing out-json path}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
schema="$here/codex-verdict.schema.json"
log="$out.log"

# The out path lives under a per-worktree scratch dir (e.g. .codex-debate/);
# make sure it exists before codex tries to write the verdict there.
mkdir -p "$(dirname "$out")"

# Pull CLAUDE's previous response, if any. Built as a plain string and injected
# below via a simple variable reference so any special characters in the JSON
# (backticks, $, ...) stay literal — heredoc expansion results are not re-scanned.
# Never let a stale verdict from a previous run survive: if the current codex
# invocation fails to write one, the empty-check below must catch it and
# synthesize an error verdict (otherwise a leftover /tmp file reads as a fresh
# pass — a false consensus).
rm -f "$out" "$log"

rebuttal=""
if [ "$rebuttal_file" != "-" ]; then
  if [ -s "$rebuttal_file" ]; then
    rebuttal="$(cat "$rebuttal_file")"
  else
    # A rebuttal was expected (path given, not "-") but the file is missing or
    # empty — the handoff broke. Proceed without it, but make the failure loud
    # so codex's responseToRebuttal isn't silently empty.
    echo "WARNING: expected rebuttal file '$rebuttal_file' is missing or empty; proceeding with no rebuttal this round." >&2
  fi
fi

rebuttal_block=""
if [ -n "$rebuttal" ]; then
  rebuttal_block="
This is a FOLLOW-UP round — you already gave your full review. Your job now is to
CLOSE OUT the findings already on the table, not re-scan the whole diff for more.
For each existing finding: verify CLAUDE's fix and mark it resolved, or address
CLAUDE's dispute (concede and mark resolved, or hold firm with specific reasoning
in responseToRebuttal). Raise a NEW finding ONLY if CLAUDE's changes this round
introduced it (a regression). Do NOT keep surfacing pre-existing issues you didn't
raise in round 1 — that prevents the debate from ever converging.

CLAUDE responded to your PREVIOUS review as follows:
$rebuttal
"
fi

# Unquoted heredoc: only $base and $rebuttal_block expand. No backticks and no
# other $/$(...) appear in the body, so there is nothing else to interpret.
prompt="$(cat <<EOF
You are CODEX, a rigorous senior code reviewer. Review the changes in this branch
and give your honest, thorough feedback — exactly as you would on a serious PR.
You're in a debate with the author ("CLAUDE"), who will fix what they agree with
and push back, with reasons, on what they don't.

Inspect the change yourself (READ-ONLY — do not modify, create, or delete anything,
and run no git write command: add/commit/push/stash/checkout):

    git diff $base       (committed + unstaged changes on this branch)
    git status --short   (untracked/new files — read those too; they aren't in the diff)

Read every changed file plus enough surrounding code to judge it in context.
Ignore the debate's own scratch dir '.codex-debate/' if it appears.

Give ALL your feedback in this pass — every issue worth raising, at EVERY severity
(blocking, major, minor, nit): correctness bugs, logic errors, silently swallowed
errors, unjustified fallbacks, security problems, and clear simplicity/efficiency
issues. Don't hold issues back for a later round, and don't limit yourself to
blockers — surface everything you see now. Cite file:line. (If the change is
genuinely clean, approving with no findings is fine — just never stay quiet about
a real issue to seem agreeable.)
$rebuttal_block
Return your review in the JSON schema:
  - findings: one entry per issue, each with a severity and a stable id (F1, F2, …)
    reused across rounds for the same issue. Set status=resolved once it is
    adequately addressed (CLAUDE fixed it, OR you accept CLAUDE's reasoning); else open.
  - approved: true ONLY when EVERY finding is resolved — all your feedback addressed
    at every severity, not just blockers. The review is not done while any issue you
    raised still stands open.
  - responseToRebuttal: when CLAUDE disputes a finding, address each dispute
    individually — concede (mark that finding resolved) or hold firm with specific,
    technical reasoning. Leave no dispute unanswered. Empty on round 1.
EOF
)"

# model_reasoning_effort=xhigh is scoped to the debate here (via -c) rather than
# relying on the user's global ~/.codex/config.toml — review is the one place we
# always want codex thinking at full depth, regardless of their default.
#
# RETRY/BACKOFF. codex's CLI fails transiently often enough to matter (API
# hiccups, a spurious internal error) and writes no verdict — which would
# otherwise degrade the whole track to reviewer-error on a single bad roll.
# Retry the invocation with linear backoff, accepting the first attempt that
# writes a non-empty verdict to "$out". Tunable via env: CODEX_REVIEW_RETRIES
# (total attempts, default 3), CODEX_REVIEW_BACKOFF (base seconds, default 5 —
# attempt n waits n*base). Only after every attempt fails empty do we synthesize
# the reviewerError verdict below.
attempts="${CODEX_REVIEW_RETRIES:-3}"
backoff="${CODEX_REVIEW_BACKOFF:-5}"
# Validate both as positive integers. Left unchecked, a non-numeric value makes
# the arithmetic `[ "$n" -ge "$attempts" ]` test error every iteration, so the
# loop would spin forever instead of giving up and synthesizing the reviewerError
# verdict. Fall back to the documented defaults (and clamp attempts to >=1) loudly
# rather than wedge the headless debate on a typo'd override.
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
  # verdict's tail_log must reflect ALL attempts' diagnostics — surfacing the exact
  # transient failures this retry loop exists to weather — not just the final one.
  echo "=== attempt $n/$attempts ===" >>"$log"
  if ! codex exec \
        --sandbox read-only \
        -c model_reasoning_effort="xhigh" \
        --output-schema "$schema" \
        -o "$out" \
        "$prompt"</dev/null >>"$log" 2>&1; then
    echo "codex exec exited non-zero (attempt $n/$attempts; see $log)" >&2
  fi
  # Success the moment codex writes a verdict: the kernel sandbox + --output-schema
  # make a non-empty "$out" a real, schema-valid verdict, not a partial.
  [ -s "$out" ] && break
  # Out of attempts — fall through to the synthesized reviewerError verdict.
  [ "$n" -ge "$attempts" ] && break
  wait_s=$(( backoff * n ))
  echo "codex produced no verdict (attempt $n/$attempts); retrying in ${wait_s}s..." >&2
  n=$(( n + 1 ))
  sleep "$wait_s"
done

if [ ! -s "$out" ]; then
  # codex produced no verdict — synthesize a schema-valid error verdict so the
  # debate loop can surface the failure instead of hanging. The reviewerError
  # flag is the machine-detectable signal the workflow uses to abort with a
  # terminal failure: a broken/unavailable codex is INFRASTRUCTURE failure, not
  # substantive disagreement, so it must NOT be routed to Claude (there are no
  # findings to act on) and must NOT spin the loop forever.
  tail_log="$(tail -c 2000 "$log" 2>/dev/null || true)"
  jq -n --arg log "$tail_log" --arg attempts "$attempts" '{
    approved: false,
    summary: ("codex produced no verdict this round after " + $attempts + " attempt(s). Tail of log: " + $log),
    findings: [],
    responseToRebuttal: "",
    reviewerError: true
  }' >"$out"
fi

cat "$out"
