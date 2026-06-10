#!/usr/bin/env bash
# Lease an idle pool box for an odu CI run, HOLD it for the run's duration, and
# release on exit. This is the standalone successor to ci/pu/run.sh: it no longer
# wraps `odu run` — it only owns the box lease, so the run itself is driven
# through the odu MCP server (`mcp__odu__run` with a `hosts` pin), which is now
# the single front door to CI.
#
# ─── Why a separate leaser (the odu-MCP-only model) ──────────────────────────
# The old run.sh fused lease + run + release into ONE process because the lease
# is held by keeping a file descriptor open, and an fd cannot span an agent's
# separate Bash tool-calls. The odu MCP inverts that: `mcp__odu__run` spawns its
# OWN background `odu run` coordinator and the agent drives it with discrete
# tool-calls (wait_for_settle / tail_log). There is no seam for a wrapper to
# enclose that run, so the lease can no longer live in the run's process.
#
# The fix is to decouple lease-lifetime from run-lifetime. `acquire` leases a box
# and then BLOCKS, holding the lease, until it is signalled. Run it in the
# background (Claude Code: Bash run_in_background); it is the long-lived process
# the lease lives in. The flow is:
#
#   ci/pu/lease.sh acquire <pr>   &   # background: leases, writes .ci/pu-lease.env, holds
#   host=$(. .ci/pu-lease.env; echo "$PU_LEASE_HOST")   # x86_64-linux=<box>, or empty
#   mcp__odu__run  hosts=[$host]                          # MCP owns the run
#   mcp__odu__wait_for_settle
#   ci/pu/lease.sh release                                # frees the box
#
# ─── Why the lease is RELIABLE (auto-releases even on SIGKILL) ───────────────
# Unchanged from run.sh: the lock lives ON THE BOX (`flock`). We hold it from
# here over the ssh DATA CHANNEL — a backgrounded ssh runs `flock -n 9 || exit;
# while read -t TTL; do :; done`, fed by a FIFO this process keeps open. While we
# live and heartbeat, the box's `read` blocks and fd 9 stays open. The moment we
# stop:
#   * graceful release  → release subcommand (or SIGTERM) → we close the fd → box
#                         read hits EOF → frees;
#   * SIGKILL / crash / session-end → our fd dies with us; the parent-guarded
#                         heartbeat child notices within HEARTBEAT secs and closes
#                         its fd too → box frees (≈1 s on a clean kill, ≤HEARTBEAT
#                         on -9);
#   * half-open network → no heartbeat reaches the box → its `read -t TTL` times
#                         out → frees. A liveness backstop, NOT a wall-clock steal.
# A leaked holder (agent forgot to release, never died) can't hold forever: it
# self-releases after MAX_HOLD as a final backstop.
#
# Usage:
#   ci/pu/lease.sh acquire <pr>   # lease + hold (BLOCKS — run in background)
#   ci/pu/lease.sh release        # release the lease recorded in .ci/pu-lease.env
#   ci/pu/lease.sh status         # per-box idle/leased snapshot (a flock probe)
#
# acquire prints `PU_LEASE_HOST=x86_64-linux=<box>` on stdout and writes the same,
# plus run facts for ci/pu/report.sh, to .ci/pu-lease.env. A saturated/unreachable
# pool falls back — cold ephemeral `pu create` → empty pin (hosts.json resolves
# the lane) — so CI is never blocked; an empty PU_LEASE_HOST means "no pin".
set -uo pipefail

POOL_SIZE="${KOLU_CI_POOL:-8}"
POOL_PREFIX="${KOLU_CI_POOL_PREFIX:-kolu-ci-}"
LOCK="${KOLU_CI_LOCK:-/tmp/kolu-ci.lease}"   # one lock per box ⇒ one run per box
TTL="${KOLU_CI_LEASE_TTL:-40}"               # box-side read timeout (half-open backstop)
HEARTBEAT="${KOLU_CI_HEARTBEAT:-10}"         # keepalive interval; must be < TTL
MAX_HOLD="${KOLU_CI_MAX_HOLD:-3600}"         # self-release backstop for a leaked holder (s)
ENV_FILE="${KOLU_CI_LEASE_ENV:-.ci/pu-lease.env}"

log() { echo "ci/pu/lease: $*" >&2; }
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
  rm -f "$ENV_FILE"
}

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

# ── acquire: lease a box (or fall back), record it, then hold until signalled ──
acquire() {
  local pr="${1:?usage: ci/pu/lease.sh acquire <pr>}"
  trap 'release; exit 0' INT TERM
  trap release EXIT

  # Lease an idle pool box, scanning slots in a rotated order so concurrent runs
  # don't stampede slot 1. (No RNG dependency: rotate by PR number.)
  local host="" order rot i box
  order=$(seq 1 "$POOL_SIZE")
  rot=$(( pr % POOL_SIZE ))
  order=$(echo "$order" | tail -n +$((rot + 1)); echo "$order" | head -n "$rot")
  for i in $order; do
    box="${POOL_PREFIX}${i}"
    if try_lease "$box"; then host="$box"; break; fi
  done

  # Pool saturated/unreachable → cold ephemeral box (old run.sh behavior).
  if [ -z "$host" ]; then
    log "no idle pool box; falling back to a cold ephemeral create"
    local eph="kolu-pr-${pr}"
    if pu create "$eph" >/dev/null 2>&1 && egress_ok "$eph"; then
      host="$eph"; EPHEMERAL="$eph"
    else
      pu destroy "$eph" >/dev/null 2>&1
      log "cold create failed/no-egress — hosts.json will resolve the linux lane"
    fi
  fi

  # Record the lease for the MCP caller (PU_LEASE_HOST → mcp__odu__run hosts) and
  # for ci/pu/report.sh (PU_BOX / PU_SHA / PU_EPHEMERAL). An empty PU_LEASE_HOST
  # means "no pin — let hosts.json resolve the lane".
  local sha pin
  sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  pin="${host:+x86_64-linux=$host}"
  mkdir -p "$(dirname "$ENV_FILE")" 2>/dev/null
  {
    echo "PU_LEASE_HOST=$pin"
    echo "PU_BOX=${host:-}"
    echo "PU_EPHEMERAL=${EPHEMERAL:-}"
    echo "PU_SHA=$sha"
    echo "PU_HOLDER_PID=$$"
    echo "PU_PR=$pr"
  } >"$ENV_FILE"
  echo "PU_LEASE_HOST=$pin"
  log "holding ${host:-<hosts.json>} for PR $pr — release with: ci/pu/lease.sh release"

  # Hold the lease until released/killed, or MAX_HOLD elapses (leak backstop).
  local waited=0
  while [ "$waited" -lt "$MAX_HOLD" ]; do sleep "$HEARTBEAT"; waited=$((waited + HEARTBEAT)); done
  log "MAX_HOLD ${MAX_HOLD}s reached — self-releasing ${host:-<hosts.json>}"
}

# ── release: signal the holder recorded in ENV_FILE (kill → its EXIT trap frees) ──
release_cmd() {
  [ -f "$ENV_FILE" ] || { log "no lease to release ($ENV_FILE absent)"; return 0; }
  local PU_HOLDER_PID="" PU_BOX=""
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  if [ -n "$PU_HOLDER_PID" ] && kill -0 "$PU_HOLDER_PID" 2>/dev/null; then
    kill -TERM "$PU_HOLDER_PID" 2>/dev/null
    log "signalled holder $PU_HOLDER_PID to release ${PU_BOX:-<hosts.json>}"
  else
    log "holder gone; lease on ${PU_BOX:-<hosts.json>} already free"
    rm -f "$ENV_FILE"
  fi
}

# ── status: per-box idle/leased snapshot via a parallel flock probe ──
status_cmd() {
  local tmp i b cfg
  tmp="$(mktemp -d)"
  for i in $(seq 1 "$POOL_SIZE"); do
    b="${POOL_PREFIX}${i}"; cfg="$(cfg "$b")"
    (
      if [ ! -f "$cfg" ]; then state="— missing"
      else
        out="$(ssh -F "$cfg" -o ConnectTimeout=15 "$b" "flock -n $LOCK -c true && echo IDLE || echo BUSY" 2>/dev/null)"
        case "$out" in IDLE) state="idle";; BUSY) state="leased";; *) state="unreachable";; esac
      fi
      printf '  %s\t%s\n' "$b" "$state" >"$tmp/$i"
    ) &
  done
  wait
  for i in $(seq 1 "$POOL_SIZE"); do cat "$tmp/$i" 2>/dev/null; done
  rm -rf "$tmp"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  acquire) acquire "$@" ;;
  release) release_cmd ;;
  status)  status_cmd ;;
  *) echo "usage: ci/pu/lease.sh {acquire <pr>|release|status}" >&2; exit 2 ;;
esac
