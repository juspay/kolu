#!/usr/bin/env bash
# Provision a warm x86_64-linux CI host for justci's linux lane.
#
# Why fork instead of `pu create`: a freshly-created box has a COLD Nix store,
# so `ci::nix` spends ~180s re-realising the devour-flake closure from the
# substituter — the single biggest chunk of linux-lane wall time (juspay/kolu#1173).
# Forking a long-lived warm "golden" box inherits its hot store, collapsing
# `ci::nix` to ~20s. Forks also never touch the substituter, so they don't
# degrade under concurrent multi-PR load the way cold boxes do (5 cold boxes
# pulling at once was measured stalling individual runs past 12 min).
#
# Robust by design: a missing, unreachable, or stale golden box must never block
# CI, so this falls back to a cold `pu create`, and the caller falls back again
# to ~/.config/justci/hosts.json if this prints nothing.
#
# Prints the (raw-ssh-resolvable) host name on success, nothing on total failure.
# Usage:  host=$(ci/pu-ci-host.sh "kolu-pr-$pr")
set -uo pipefail

host="$1"
golden="${KOLU_CI_GOLDEN:-kolu-ci-golden}"

log() { echo "pu-ci-host: $*" >&2; }

# `pu fork` (unlike `pu create`) does NOT write ~/.pu-state/<host>/ssh_config,
# so raw `ssh <host>` — which justci uses over the wire — can't resolve the
# forked box. Synthesize it from the source's config: a fork lands on the same
# gateway, so only the Host name and `connect <name>` target differ.
synth_ssh_config() {
  local new="$1" src="$2" cfg="$HOME/.pu-state"
  [ -f "$cfg/$src/ssh_config" ] || { log "no source ssh_config for $src"; return 1; }
  mkdir -p "$cfg/$new"
  sed "s/${src}/${new}/g" "$cfg/$src/ssh_config" >"$cfg/$new/ssh_config"
}

# Confirm raw ssh resolves AND the box has outbound egress (the known pu
# no-egress placement failure — see the pu skill).
egress_ok() {
  ssh -o ConnectTimeout=15 -T "$1" 'timeout 12 curl -sf -o /dev/null https://api.github.com' 2>/dev/null
}

# 1) Warm fork of the golden box.
#
# `pu fork` is a fast copy-on-write snapshot ONLY when the fork lands on the
# same Incus storage pool as the source; across pools it falls back to a full
# instance transfer (~17 GB, ~160s) that both defeats the purpose AND hits an
# Incus UUID-migration bug ("invalid UUID length: 0"). So bound the fork with a
# timeout: a fast CoW fork finishes well within it; a slow cross-pool transfer
# is killed and we fall back to a cold create — fork is thus only ever used when
# it's the fast path, never a net slowdown.
# One bounded attempt: a fast CoW fork finishes in well under the timeout; a
# slow cross-pool transfer is killed and we cold-create instead, capping the
# wasted overhead (vs. retrying, which can burn minutes on repeated transfers).
fork_timeout="${KOLU_CI_FORK_TIMEOUT:-45}"
if pu list 2>/dev/null | grep -qw "$golden"; then
  if timeout "$fork_timeout" pu fork "$golden" "$host" >/dev/null 2>&1 \
     && synth_ssh_config "$host" "$golden" && egress_ok "$host"; then
    log "warm fork of $golden -> $host"
    echo "$host"; exit 0
  fi
  pu destroy "$host" >/dev/null 2>&1   # tear down a slow/partial/no-egress fork
  log "fast fork of $golden unavailable; falling back to cold create"
else
  log "golden box '$golden' not found; falling back to cold create"
fi

# 2) Cold create (writes its own ssh_config).
if pu create "$host" >/dev/null 2>&1 && egress_ok "$host"; then
  log "cold create $host (golden unavailable)"
  echo "$host"; exit 0
fi
log "cold create failed/no-egress; caller should fall back to hosts.json"
pu destroy "$host" >/dev/null 2>&1
exit 0
