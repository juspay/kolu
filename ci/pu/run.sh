#!/usr/bin/env bash
# Lease an idle pool box, run justci's linux lane against it, release on exit.
#
# Replaces the per-run fork+destroy model (the old ci/pu-ci-host.sh) with a
# FIXED POOL of long-lived warm boxes — kolu-ci-1 .. kolu-ci-N. A run *leases*
# an idle box for its duration and *releases* it; nothing is created or
# destroyed on the hot path. The wins over fork-per-run:
#   * the Nix store is warm by construction — no fork, so neither of fork's two
#     bugs (no ssh_config; cross-pool 17 GB transfer + UUID crash) is on the
#     hot path. Fork survives only as the pool-SEEDING mechanism (ci::pool-ensure).
#   * concurrent PRs never stampede the substituter — a warm leased box pulls
#     nothing, so the "5 cold boxes stalled > 12 min" contention can't happen.
# Background + measurements: docs/pu-box-ci-ralph-report.md, juspay/kolu#1173.
#
# ─── Why this is one process that WRAPS justci (not a host-printing helper) ───
# The lease is held for exactly the run's duration by keeping a file descriptor
# open. An fd cannot span the agent's separate Bash tool-calls, so the lease
# must live in the same process that runs justci. Hence: lease → run → release,
# all here, with release wired to EXIT.
#
# ─── Why the lease is RELIABLE (auto-releases even on SIGKILL) ───────────────
# The lock lives ON THE BOX (`flock`). We hold it from here over the ssh DATA
# CHANNEL: a backgrounded ssh runs `flock -n 9 || exit; while read -t TTL; do
# :; done`, with its stdin fed by a FIFO this process keeps open. While we live
# and heartbeat, the box's `read` blocks and fd 9 stays open, so the lock is
# held. The moment we stop:
#   * graceful release  → we close the write fd → box read hits EOF → exits → frees;
#   * SIGKILL / crash   → our fd dies with us; the parent-guarded heartbeat child
#                         notices within HEARTBEAT secs and closes its fd too →
#                         box read hits EOF → frees (verified: frees in ≈1 s on a
#                         clean kill, ≤HEARTBEAT on -9);
#   * half-open network → no heartbeat reaches the box → its `read -t TTL` times
#                         out → exits → frees. This is the only timer, and it is
#                         a liveness backstop, NOT a wall-clock "steal" heuristic.
# No dependence on sshd ClientAlive config, no fixed-deadline lease theft.
# `flock` is system-wide per inode, so claims from different coordinators/PRs are
# mutually exclusive on the box regardless of who dials in.
#
# Usage:  ci/pu/run.sh <pr-number> [extra justci args...]
#   e.g.  ci/pu/run.sh 1234 --progress json
# Prints the justci output on stdout (so the caller can tail --progress json).
# Always falls back — saturated pool → cold ephemeral box → hosts.json — so a
# busy or unreachable pool never blocks CI.
set -uo pipefail

pr="${1:?usage: ci/pu/run.sh <pr> [justci args...]}"; shift || true

JUSTCI="${KOLU_JUSTCI:-github:juspay/justci}"
POOL_SIZE="${KOLU_CI_POOL:-8}"
POOL_PREFIX="${KOLU_CI_POOL_PREFIX:-kolu-ci-}"
LOCK="${KOLU_CI_LOCK:-/tmp/kolu-ci.lease}"   # one lock per box ⇒ one run per box
TTL="${KOLU_CI_LEASE_TTL:-40}"               # box-side read timeout (half-open backstop)
HEARTBEAT="${KOLU_CI_HEARTBEAT:-10}"         # keepalive interval; must be < TTL

log() { echo "ci/pu/run: $*" >&2; }
cfg() { echo "$HOME/.pu-state/$1/ssh_config"; }
dial() { local h="$1"; shift; ssh -F "$(cfg "$h")" -o ConnectTimeout=20 "$h" "$@"; }
egress_ok() { dial "$1" 'timeout 12 curl -sf -o /dev/null https://api.github.com' >/dev/null 2>&1; }

# ── lease state (set on a successful claim) ──
LEASED=""; HOLDER_PID=""; HB_PID=""; FD_OPEN=""; EPHEMERAL=""

release() {
  [ -n "$HB_PID" ] && kill "$HB_PID" 2>/dev/null
  [ -n "$FD_OPEN" ] && exec 8>&- 2>/dev/null         # close write end → box EOF → flock frees
  [ -n "$HOLDER_PID" ] && wait "$HOLDER_PID" 2>/dev/null
  [ -n "$LEASED" ] && { log "released lease on $LEASED"; rm -f "/tmp/lease-$LEASED.out"; }
  [ -n "$EPHEMERAL" ] && { log "destroying ephemeral $EPHEMERAL"; pu destroy "$EPHEMERAL" >/dev/null 2>&1; }
}
trap release EXIT INT TERM

# Try to lease ONE pool box. On success: sets LEASED + holds the lock; returns 0.
#
# Speed matters: `pu list` costs ~34 s and an ssh handshake ~5 s through the pu
# proxy, so the hot path makes EXACTLY ONE ssh per candidate and never calls
# `pu list`. The "does this slot exist" guard is the LOCAL ssh_config file
# (written by `pu create`, kept current by ci::pool-ensure) — a zero-latency
# disk check. Egress is verified INSIDE the holder session (no extra round
# trip): a BUSY box fails `flock` and exits before the curl, so only the winner
# pays for it; a box that's up but lost egress announces NOEGRESS and is skipped.
try_lease() {
  local box="$1" fifo i out
  [ -f "$(cfg "$box")" ] || return 1                         # slot exists? (local, instant)
  out="/tmp/lease-$box.out"; : >"$out"
  fifo="$(mktemp -u)"; mkfifo "$fifo" || return 1
  # Backgrounded holder: grab the lock (else BUSY), verify egress (else NOEGRESS),
  # announce HELD, then block on the heartbeat channel (read -t TTL). stdin = the
  # FIFO this process keeps open.
  ssh -F "$(cfg "$box")" -o ConnectTimeout=20 \
      -o ServerAliveInterval="$HEARTBEAT" -o ServerAliveCountMax=2 "$box" \
      "exec 9>$LOCK
       flock -n 9 || { echo BUSY; exit 7; }
       timeout 12 curl -sf -o /dev/null https://api.github.com || { echo NOEGRESS; exit 8; }
       echo HELD
       while read -t $TTL -r _; do :; done" \
      < "$fifo" >"$out" 2>/dev/null &
  HOLDER_PID=$!
  exec 8>"$fifo"; rm -f "$fifo"                              # keep write end; unlink path

  for i in $(seq 1 40); do
    grep -q HELD "$out" 2>/dev/null && break
    grep -qE 'BUSY|NOEGRESS' "$out" 2>/dev/null && {
      grep -q NOEGRESS "$out" && log "$box: no egress — skipping"
      exec 8>&-; wait "$HOLDER_PID" 2>/dev/null; HOLDER_PID=""; return 1; }
    kill -0 "$HOLDER_PID" 2>/dev/null || { exec 8>&-; HOLDER_PID=""; return 1; }   # holder died (unreachable slot)
    sleep 0.5
  done
  grep -q HELD "$out" 2>/dev/null || { exec 8>&-; kill "$HOLDER_PID" 2>/dev/null; HOLDER_PID=""; return 1; }

  FD_OPEN=1; LEASED="$box"
  # Heartbeat keeps the box's `read -t TTL` fed WHILE we live. Guarded on the
  # parent pid so a SIGKILL'd parent → child exits next tick → fd closes → frees.
  local parent=$$
  ( while kill -0 "$parent" 2>/dev/null; do echo >&8 2>/dev/null || exit 0; sleep "$HEARTBEAT"; done ) &
  HB_PID=$!
  log "leased $box"
  return 0
}

# ── 1) Lease an idle pool box, scanning slots in a rotated order so concurrent
#       runs don't stampede slot 1. (No RNG dependency: rotate by PR number.) ──
host=""
order=$(seq 1 "$POOL_SIZE")
rot=$(( pr % POOL_SIZE ))
order=$(echo "$order" | tail -n +$((rot + 1)); echo "$order" | head -n "$rot")
for i in $order; do
  box="${POOL_PREFIX}${i}"
  if try_lease "$box"; then host="$box"; break; fi
done

# ── 2) Pool saturated/unreachable → cold ephemeral box (old behavior). ──
if [ -z "$host" ]; then
  log "no idle pool box; falling back to a cold ephemeral create"
  eph="kolu-pr-${pr}"
  if pu create "$eph" >/dev/null 2>&1 && egress_ok "$eph"; then
    host="$eph"; EPHEMERAL="$eph"
  else
    pu destroy "$eph" >/dev/null 2>&1
    log "cold create failed/no-egress — will let hosts.json resolve the linux lane"
  fi
fi

# ── 3) Run justci. With a host: pin the linux lane to it. Without: hosts.json. ──
# KOLU_CI_DRYRUN=<secs> stands in for the justci run (holds the lease that long)
# so the lease/contention/release path can be exercised without the full pipeline.
sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
start="$(date +%s)"
if [ -n "${KOLU_CI_DRYRUN:-}" ]; then
  echo "DRYRUN host=${host:-<hosts.json>} pr=$pr"
  sleep "$KOLU_CI_DRYRUN"; rc=0
elif [ -n "$host" ]; then
  log "running linux lane on $host"
  nix run "$JUSTCI" -- run --host "x86_64-linux=$host" "$@"; rc=$?
else
  nix run "$JUSTCI" -- run "$@"; rc=$?
fi
end="$(date +%s)"

# Record run facts for ci/pu/report.sh (which box, timing, verdict). Best-effort;
# never let bookkeeping change the run's exit code.
if mkdir -p .ci 2>/dev/null; then
  {
    echo "PU_BOX=${host:-}"
    echo "PU_EPHEMERAL=${EPHEMERAL:-}"
    echo "PU_SHA=$sha"
    echo "PU_START=$start"
    echo "PU_END=$end"
    echo "PU_EXIT=$rc"
    echo "PU_PR=$pr"
  } >.ci/pu-run.env 2>/dev/null || true
fi
log "linux lane finished in $((end - start))s (exit $rc) on ${host:-hosts.json}"
exit "$rc"
