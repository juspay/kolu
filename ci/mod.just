# Kolu CI steps

import 'lib.just'

sha := `git rev-parse HEAD`
repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`
system := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
local_system := `nix eval --raw --impure --expr builtins.currentSystem`
root := `git rev-parse --show-toplevel`

# Resolve all SSH hosts before running steps (prompts user if unconfigured)
_preflight:
    #!/usr/bin/env bash
    set -euo pipefail
    for sys in x86_64-linux aarch64-darwin; do
        if [[ "$sys" != "{{ local_system }}" ]]; then
            CI_SYSTEM="$sys" just ci::_host > /dev/null
        fi
    done

default: _preflight && _run-all

[parallel]
_run-all: _linux _darwin

_linux:
    CI_SYSTEM=x86_64-linux just ci::nix-toplevel ci::nix-home ci::e2e

_darwin:
    CI_SYSTEM=aarch64-darwin just ci::nix-toplevel ci::e2e

nix-toplevel:
    just ci::_devour-flake nix {{ root }}

nix-home: nix-toplevel
    just ci::_devour-flake nix/home {{ root }}/nix/home/example

e2e: nix-toplevel
    just ci::_run e2e just test
