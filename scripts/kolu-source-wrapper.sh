#!/bin/sh
# The source-tree stand-in for the nix-built `kolu` binary — what the justfile's
# `test-quick` and `record` recipes hand to hooks.ts as KOLU_SERVER (spawned as
# an executable with ["web", "--port", N, ...]). It does what the nix-built
# binary does: set KOLU_CLIENT_DIST and exec node with tsx's loader on the
# kolu-cli entry point. ONE definition so an entry-point change lands here, not
# in per-recipe heredoc copies.
#
# ONE PROCESS, like the nix-built binary (`node --import <tsx loader>`): the pid
# the harness spawns is the server itself. The `tsx` command would run the
# server as a child of its own, and a signal that cannot be relayed — the
# SIGKILL the harness sends a server that never answered — would stop only
# that parent and leave the real server running.
#
# It forwards "$@" UNCHANGED and bakes no flags of its own. It used to prepend
# `--allow-nix-shell-with-env-whitelist default`, which stopped working when the
# terminal verbs landed: that is a `web` flag, and a verb's own flag before the
# subcommand name is refused. Its caller (hooks.ts) passes the whitelist itself,
# so baking a second copy here would also have been a duplicate flag.
set -eu
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cli="$root/packages/kolu-cli"
KOLU_CLIENT_DIST="$root/packages/client/dist" exec node \
  --import "$cli/node_modules/tsx/dist/loader.mjs" "$cli/src/main.ts" "$@"
