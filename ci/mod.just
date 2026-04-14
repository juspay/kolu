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
    just ci::fmt ci::typecheck ci::unit ci::apm-sync || true

_linux:
    CI_SYSTEM=x86_64-linux just ci::pnpm-hash-fresh ci::nix ci::_linux-fanout || true

# Runs post-nix steps in parallel. Within the same just process, their
# `: nix` deps are already satisfied, so nix is not rebuilt.
[parallel]
_linux-fanout: home-manager e2e run

[parallel]
_darwin-fanout: e2e run

_darwin:
    CI_SYSTEM=aarch64-darwin just ci::nix ci::_darwin-fanout || true

# Verify the declared pnpmDeps hash in default.nix matches what
# fetchPnpmDeps actually produces from the current pnpm-lock.yaml. The
# first `nix build` realizes the output path (from substituter or fresh);
# `--rebuild` then forces re-execution and compares, so a stale declared
# hash cannot be silently satisfied by a cached artifact at that hash in
# the binary cache (cache.nixos.asia). Runs on one system — the hash is
# platform-independent (pnpm install --force bypasses os/cpu/libc gating).
pnpm-hash-fresh:
    just ci::_run pnpm-hash-fresh just ci::_pnpm-hash-fresh-do

_pnpm-hash-fresh-do:
    #!/usr/bin/env bash
    set -euo pipefail
    nix build .#pnpmDeps --no-link
    nix build --rebuild .#pnpmDeps --no-link

nix:
    just ci::_devour-flake nix --override-input flake .

home-manager: nix
    just ci::_devour-flake home-manager --override-input flake ./nix/home/example --override-input flake/kolu .

typecheck:
    just ci::_run typecheck just check

e2e: nix
    just ci::_run e2e just test

# Smoke-test `nix run .` works
run: nix
    just ci::_run run nix run . -- --help

# Run vitest unit tests (server + client)
unit:
    just ci::_run unit just test-unit

# Verify vendored .claude/ matches .apm/ sources + security audit
apm-sync:
    just ci::_run apm-sync just ai::apm-sync

fmt:
    just ci::_run fmt just fmt-check
