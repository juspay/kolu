# Kolu CI steps

import 'lib.just'

sha := `git rev-parse HEAD`
repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`
system := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
local_system := `nix eval --raw --impure --expr builtins.currentSystem`
root := `git rev-parse --show-toplevel`
systems := "x86_64-linux aarch64-darwin"

default: _preflight _pc _run-all
    just ci::_summary

# Formatting check — always local, runs before expensive builds
_pc:
    just ci::pc || true

[parallel]
_run-all: _linux _darwin

_linux:
    CI_SYSTEM=x86_64-linux just ci::nix ci::home-manager ci::typecheck ci::e2e || true

_darwin: _preflight
    CI_SYSTEM=aarch64-darwin just ci::nix ci::e2e || true

nix:
    just ci::_devour-flake nix --override-input flake .

home-manager: nix
    just ci::_devour-flake home-manager --override-input flake ./nix/home/example --override-input flake/kolu .

typecheck:
    just ci::_run typecheck just watch

e2e: nix
    just ci::_run e2e just test

pc:
    just ci::_run pc just pc-check
