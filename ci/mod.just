# Kolu CI steps

import 'lib.just'

sha := `git rev-parse HEAD`
repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`
system := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
local_system := `nix eval --raw --impure --expr builtins.currentSystem`

[parallel]
default: _linux _darwin

_linux:
    CI_SYSTEM=x86_64-linux just ci::nix-toplevel ci::nix-home ci::e2e

_darwin:
    CI_SYSTEM=aarch64-darwin just ci::nix-toplevel ci::e2e

nix-toplevel:
    just ci::_devour-flake nix .

nix-home: nix-toplevel
    just ci::_devour-flake nix/home ./nix/home/example

e2e: nix-toplevel
    just ci::_run e2e just test
