#!/bin/sh
set -eu
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
KOLU_CLIENT_DIST="$root/packages/client/dist" exec tsx "$root/packages/kolu-cli/src/main.ts" "$@"
