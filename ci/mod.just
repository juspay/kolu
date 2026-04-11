# Kolu CI steps.
#
# Imports localci/ — a forge-agnostic reusable CI library (to be extracted
# to its own repo in a later phase). See ci/localci/README.md.

import 'localci/lib.just'
import 'localci/forges/github.just'

module_name  := "ci"
sha          := `git rev-parse HEAD`
system       := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
local_system := `nix eval --raw --impure --expr builtins.currentSystem`
root         := `git rev-parse --show-toplevel`
systems      := "x86_64-linux aarch64-darwin"

# Inner workflow: preflight → parallel fanout across systems → summary.
# `default` (defined in lib.just) acquires the single-instance lock and
# execs into this recipe.
_inner: _preflight _run-all _summary

# Each lane swallows failures (|| true) so all steps run and post their own
# events + signoffs — _summary reads the event stream to decide final pass/fail.
[parallel]
_run-all: _local _linux _darwin

_local:
    just ci::fmt ci::typecheck ci::unit ci::apm-sync || true

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
