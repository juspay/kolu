#!/usr/bin/env bash
# Bring the kolu-ci linux CI pool up to strength: N long-lived warm boxes
# kolu-ci-1 .. kolu-ci-N that ci/pu/run.sh leases per CI run.
#
# Idempotent. For each slot it probes egress over the box's own ssh_config
# (the same check the lease uses) and only (re)creates a slot that is missing
# or unhealthy. Healthy slots are left untouched so their warm Nix store —
# the whole point of the pool — survives.
#
# Why `pu create`, not `pu fork`: fork's placement is non-deterministic and
# lands cross-gateway often enough that a synthesized ssh_config can't reach the
# forked box (juspay/kolu#1204). `pu create` writes its own correct ssh_config
# and is reliable. A freshly created slot starts COLD; it warms on its first
# real CI run and then stays warm across leases — strictly better than
# re-forking a golden every run.
#
# Usage:
#   ci/pu/pool.sh            # ensure all N slots are healthy
#   ci/pu/pool.sh status     # just report health, change nothing
#   KOLU_CI_POOL=8 ci/pu/pool.sh
#
# Warming is intentionally NOT done here (it's a full linux-lane run per box).
# Keep the pool warm by letting real CI runs land on it, plus a periodic
# master run across idle slots — see .agency/do.md "Keep the pool warm".
set -uo pipefail

POOL_SIZE="${KOLU_CI_POOL:-8}"
POOL_PREFIX="${KOLU_CI_POOL_PREFIX:-kolu-ci-}"
mode="${1:-ensure}"

log() { echo "pool-ensure: $*" >&2; }
cfg() { echo "$HOME/.pu-state/$1/ssh_config"; }
# Reachable AND has outbound egress — the bar a box must clear to be leasable.
healthy() {
  local box="$1"
  [ -f "$(cfg "$box")" ] || return 1
  ssh -F "$(cfg "$box")" -o ConnectTimeout=20 "$box" \
    'timeout 12 curl -sf -o /dev/null https://api.github.com' >/dev/null 2>&1
}

ok=0; fixed=0; failed=0
for i in $(seq 1 "$POOL_SIZE"); do
  box="${POOL_PREFIX}${i}"
  if healthy "$box"; then
    echo "  ✓ $box healthy"
    ok=$((ok + 1))
    continue
  fi
  if [ "$mode" = status ]; then
    echo "  ✗ $box unhealthy/missing"
    failed=$((failed + 1))
    continue
  fi
  # (Re)create the slot. Destroy any broken remnant first so the name is free
  # (pu create refuses an existing name).
  log "$box unhealthy/missing — (re)creating"
  pu destroy "$box" >/dev/null 2>&1
  rm -rf "$(dirname "$(cfg "$box")")"
  if pu create "$box" >/dev/null 2>&1 && healthy "$box"; then
    echo "  + $box (re)created"
    fixed=$((fixed + 1))
  else
    echo "  ! $box FAILED to come up healthy (no egress?) — see juspay/kolu#1204"
    pu destroy "$box" >/dev/null 2>&1
    failed=$((failed + 1))
  fi
done

echo "pool ($POOL_SIZE): $ok healthy, $fixed (re)created, $failed failed"
[ "$failed" -eq 0 ]
