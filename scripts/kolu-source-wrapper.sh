#!/bin/sh
# The source-tree stand-in for the nix-built `kolu` binary — what the justfile's
# `test-quick` and `record` recipes hand to hooks.ts as KOLU_SERVER (spawned as
# an executable with ["web", "--port", N, ...]). It does what the nix-built
# binary does: set KOLU_CLIENT_DIST and exec tsx on the kolu-cli entry point.
# ONE definition so an entry-point change lands here, not in per-recipe heredoc
# copies.
#
# It forwards "$@" UNCHANGED and bakes no flags of its own. It used to prepend
# `--allow-nix-shell-with-env-whitelist default`, which stopped working when the
# terminal verbs landed: that is a `web` flag, and a verb's own flag before the
# subcommand name is refused. Its caller (hooks.ts) passes the whitelist itself,
# so baking a second copy here would also have been a duplicate flag.
set -eu
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
KOLU_CLIENT_DIST="$root/packages/client/dist" exec tsx "$root/packages/kolu-cli/src/main.ts" "$@"
