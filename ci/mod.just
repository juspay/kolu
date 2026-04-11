# Kolu CI steps.
#
# Imports localci/ — a forge-agnostic reusable CI library (to be extracted
# to its own repo in a later phase). See ci/localci/README.md.

import 'localci/lib.just'
import 'localci/forges/github.just'

module_name := "ci"
systems     := "x86_64-linux aarch64-darwin"

# Inner workflow: preflight → parallel fanout across systems → summary.
# `default` (defined in lib.just) acquires the single-instance lock and
# execs into this recipe.
_inner: _preflight _run-all _summary

# Fans lanes out across target systems in parallel. Each lane MUST tolerate
# its own failures (see the `|| true` in every lane below) — otherwise a
# failing step on one system would abort the whole `just` process and the
# sibling systems would never run, defeating the purpose of parallel CI.
# `_summary` reads the events.ndjson file after all lanes finish and decides
# final pass/fail from there.
[parallel]
_run-all: _local _linux _darwin

# `|| true` is load-bearing: `just ci::fmt ci::typecheck ci::unit ci::apm-sync`
# runs those four recipes sequentially in ONE just process, stopping on first
# failure. Without the `|| true` the outer _local would fail and abort the
# parallel fanout. Each recipe's own failure is already captured by _run's ERR
# trap (emits step_end{state:failure} + forge signoff), so discarding the exit
# code here loses nothing — the failure lives in events.ndjson for _summary.
_local:
    just ci::fmt ci::typecheck ci::unit ci::apm-sync || true

# Same `|| true` rationale as _local — this lane fans nix → {home-manager, e2e}
# and must not propagate sub-step failures up to _run-all.
_linux:
    CI_SYSTEM=x86_64-linux just ci::nix ci::_linux-fanout || true

# Runs home-manager and e2e in parallel after nix has completed.
# Within the same just process, their `: nix` deps are already satisfied.
[parallel]
_linux-fanout: home-manager e2e

_darwin:
    CI_SYSTEM=aarch64-darwin just ci::nix ci::e2e || true

# Leaf steps dispatch directly via parenthesized dep syntax — no subprocess
# per step, just a dependency call into the orchestrator helpers in lib.just.

nix: (_devour-flake "nix" "--override-input" "flake" ".")

home-manager: nix (_devour-flake "home-manager" "--override-input" "flake" "./nix/home/example" "--override-input" "flake/kolu" ".")

typecheck: (_run "typecheck" "just check")

e2e: nix (_run "e2e" "just test")

# Run vitest unit tests (server + client)
unit: (_run "unit" "just test-unit")

# Verify vendored .claude/ matches .apm/ sources + security audit
apm-sync: (_run "apm-sync" "just ai::apm-sync")

fmt: (_run "fmt" "just fmt-check")
