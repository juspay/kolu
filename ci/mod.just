# Kolu CI steps

import 'lib.just'

sha := `git rev-parse HEAD`
repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`
system := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
local_system := `nix eval --raw --impure --expr builtins.currentSystem`
root := `git rev-parse --show-toplevel`
systems := "x86_64-linux aarch64-darwin"

default: _preflight _run-all
    just ci::_summary

[parallel]
_run-all: _local _linux _darwin

# Each lane swallows failures (|| true) so all steps run and post
# their own GitHub status — _summary reads those statuses to decide
# the final pass/fail.
_local:
    just ci::fmt ci::typecheck ci::unit ci::do-results || true

_linux:
    CI_SYSTEM=x86_64-linux just ci::nix ci::home-manager ci::e2e || true

_darwin:
    CI_SYSTEM=aarch64-darwin just ci::nix ci::e2e || true

nix:
    just ci::_devour-flake nix --override-input flake .

home-manager: nix
    just ci::_devour-flake home-manager --override-input flake ./nix/home/example --override-input flake/kolu .

typecheck:
    just ci::_run typecheck just watch

e2e: nix
    just ci::_run e2e just test

# Run vitest unit tests (server + client)
unit:
    just ci::_run unit just test-unit

# Validate /do workflow results against expected steps
do-results:
    just ci::_run do-results just do-results-check

fmt:
    just ci::_run fmt just fmt-check
