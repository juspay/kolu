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

# Top-level entrypoint: acquire single-instance lock via perl Fcntl::flock,
# then exec into the inner recipe chain. Kernel releases the lock on any exit
# (clean, crash, SIGKILL). The lock file contents persist as the current-or-
# last run sha, which agents read unconditionally.
#
# perl is portable (ships on every Linux + macOS) and gives us kernel-backed
# advisory locking without needing flock(1) (absent on Darwin). The
# `$^F = 10` trick prevents FD_CLOEXEC from being set on newly-opened fds,
# so the lock fd survives the exec into `just ci::_inner` and is held for
# the full duration of the run (not just perl's lifetime).
default:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{ root }}/.localci"
    cd "{{ root }}"
    exec perl -MFcntl=:flock -e '
        BEGIN { $^F = 10 }
        open(my $f, "+>>", ".localci/current") or die "open: $!\n";
        flock($f, LOCK_EX | LOCK_NB) or do {
            seek $f, 0, 0;
            my $prev = <$f> // "?";
            chomp $prev;
            die "localci already running (sha=$prev)\n";
        };
        truncate($f, 0); seek $f, 0, 0;
        print $f "{{ sha }}\n";
        $f->flush;
        exec @ARGV or die "exec: $!\n";
    ' just ci::_inner

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

nix:
    just ci::_devour-flake nix --override-input flake .

home-manager: nix
    just ci::_devour-flake home-manager --override-input flake ./nix/home/example --override-input flake/kolu .

typecheck:
    just ci::_run typecheck just check

e2e: nix
    just ci::_run e2e just test

# Run vitest unit tests (server + client)
unit:
    just ci::_run unit just test-unit

# Verify vendored .claude/ matches .apm/ sources + security audit
apm-sync:
    just ci::_run apm-sync just ai::apm-sync

fmt:
    just ci::_run fmt just fmt-check
