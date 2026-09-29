# env from saatchi: PORT (bind), HOME (already .saatchi/home), DATA (serve this)
#
# THIS RECIPE RUNS IN SAATCHI'S BARE ENV, not your repo's.
# saatchi puts its own bun/just/ffmpeg on PATH — not your toolchain.
# A bare `bun` / `npm` / `cargo` here is exit 127. Re-enter YOUR
# environment, then start the app:
#
# kolu: build the browser client, then run the CLI's `web` subcommand, which
# serves the client dist + the api on ONE port. The env-prefixed variables ride
# through `nix develop` (the way the justfile's test-quick passes KOLU_SERVER);
# the whitelist flag is mandatory because this recipe IS inside a nix shell —
# kolu refuses to start in one otherwise (its devshell env would leak into the
# user's terminals).
serve:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{justfile_directory()}}/..
    nix develop --command pnpm --filter kolu-client build
    PORT="$PORT" \
    KOLU_CLIENT_DIST="$PWD/packages/client/dist" \
    KOLU_STATE_DIR="$HOME/.local/state/kolu-saatchi" \
    KOLU_PADI_STATE_DIR="$HOME/.local/state/kolu-saatchi/padi" \
    XDG_RUNTIME_DIR="$HOME/.local/state/kolu-saatchi/run" \
    exec nix develop --command tsx packages/kolu-cli/src/main.ts web \
        --allow-nix-shell-with-env-whitelist default \
        --port "$PORT"
