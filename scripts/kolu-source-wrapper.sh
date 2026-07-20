#!/bin/sh
# The source-tree stand-in for the nix-built `kolu` binary — what the justfile's
# `test-quick` and `record` recipes hand to hooks.ts as KOLU_SERVER (spawned as
# an executable with ["--port", N]). It does what the nix-built binary does:
# set KOLU_CLIENT_DIST and exec tsx on the kolu-cli entry point. ONE definition
# so an entry-point change lands here, not in per-recipe heredoc copies.
set -eu
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
KOLU_CLIENT_DIST="$root/packages/client/dist" exec tsx "$root/packages/kolu-cli/src/main.ts" --allow-nix-shell-with-env-whitelist default "$@"
