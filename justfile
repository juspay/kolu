# Prefix for commands that need a Nix devshell; empty if already inside one.

# Use git+file:// (default) instead of path: — path: disables the eval cache
# and re-copies/re-evaluates on every invocation (~4200ms vs ~130ms hot).
# Caveat: new .nix files must be `git add`ed before nix develop sees them.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop ' + justfile_directory() + ' --accept-flake-config -c' }
# E2e shell includes Playwright browsers (not in default shell for perf).
# Check PLAYWRIGHT_BROWSERS_PATH, not IN_NIX_SHELL — the default shell sets
# IN_NIX_SHELL but doesn't provide browsers, so `just ci::e2e` (which runs
# inside the default shell) must still enter .#e2e to get them.
nix_shell_e2e := if env('PLAYWRIGHT_BROWSERS_PATH', '') != '' { '' } else { 'nix develop ' + justfile_directory() + '#e2e --accept-flake-config -c' }

cucumber_parallel := env('CUCUMBER_PARALLEL', '4')

mod ai 'agents/ai.just'
mod ci 'ci/mod.just'
mod website 'website/mod.just'
mod atlas 'docs/atlas/mod.just'

# List available recipes
default:
    @just --list

# Prepare repo for development — install deps and cache so future workflows run faster
prepare: install

# Install pnpm dependencies
install:
    {{ nix_shell }} pnpm install

# Run server + client in parallel.
# Bare `just dev` keeps the canonical 7681/5173 (see README). Override either
# port to run a second instance alongside a primary one; empty falls back to
# the default. `just dev-auto` picks two free ports for you.
#   just dev 7700 5180   (positional: SERVER_PORT then CLIENT_PORT)
# The env vars must be exported before the parallel fork — Vite reads them once
# at startup to compute its proxy target — so resolution happens here, in the
# sequential recipe body, before `_dev` forks server + client.
dev SERVER_PORT="" CLIENT_PORT="":
    #!/usr/bin/env bash
    set -euo pipefail
    export KOLU_DEV_SERVER_PORT="{{ SERVER_PORT }}"
    export KOLU_DEV_CLIENT_PORT="{{ CLIENT_PORT }}"
    echo "→ server http://localhost:${KOLU_DEV_SERVER_PORT:-7681}"
    echo "→ client http://localhost:${KOLU_DEV_CLIENT_PORT:-5173}"
    {{ nix_shell }} just _dev

# Run server + client on two free random ports, printing the resolved URLs.
# For agents / a second worktree that must not collide with a primary instance.
dev-auto:
    #!/usr/bin/env bash
    set -euo pipefail
    # python3 via nix (not a global install) so this works outside the devshell.
    # Both sockets stay open until printed, guaranteeing two *unique* free ports.
    read -r SERVER_PORT CLIENT_PORT < <(nix shell nixpkgs#python3 --command python3 -c 'import socket; a=socket.socket(); a.bind(("",0)); b=socket.socket(); b.bind(("",0)); print(a.getsockname()[1], b.getsockname()[1]); a.close(); b.close()')
    # Positional args — `just dev NAME=VALUE` would bind the literal "NAME=VALUE"
    # to the param, not the value.
    exec just dev "$SERVER_PORT" "$CLIENT_PORT"

[private]
_dev: install _dev-parallel

[private]
[parallel]
_dev-parallel: server client

# Run TypeScript type checking + Biome lint across all packages — fast static-correctness gate
check: install
    {{ nix_shell }} sh -c 'pnpm typecheck && biome lint .'

# Biome lint only — mirrors ci::biome. Format stays on Prettier for now (see biome.jsonc).
lint: install
    {{ nix_shell }} biome lint .

# Run server with auto-reload. Honors KOLU_DEV_SERVER_PORT if set (e.g. by
# `just dev`), otherwise the server CLI falls back to its default port.
server:
    cd packages/server && {{ nix_shell }} pnpm dev ${KOLU_DEV_SERVER_PORT:+--port $KOLU_DEV_SERVER_PORT}

# Run client with Vite dev server (HMR)
client:
    cd packages/client && {{ nix_shell }} pnpm dev

# Run unit tests (vitest) across server and client packages
test-unit: install
    {{ nix_shell }} pnpm test:unit

# Run Cucumber e2e tests (nix build once, each worker spawns the binary)
test: install
    #!/usr/bin/env bash
    set -euo pipefail
    # Raise the fd soft limit before spawning workers/servers. macOS defaults
    # to 256, which a kolu server under parallel load can exhaust on accept()
    # (silent EMFILE — no crash, just refused connections). Hard limit is
    # unlimited; this is free insurance on every platform.
    ulimit -n 65536 2>/dev/null || true
    # Worker count scales with the host unless CUCUMBER_PARALLEL is set
    # explicitly: ~1 worker per 3 cores, clamped to [4,8]. The 24-core darwin
    # CI host (rasam) gets 8 — ~45% faster than the old fixed 4 — while laptops
    # and smaller CI stay at 4. Past 8 the slowest-scenario tail dominates and
    # extra workers only add contention (PAR=12 measured *slower* than PAR=8 on
    # a 24-core host). See docs/ci-e2e-macos-ralph-report.md.
    cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
    par=$(( cores / 3 ))
    if (( par < 4 )); then par=4; fi
    if (( par > 8 )); then par=8; fi
    par="${CUCUMBER_PARALLEL:-$par}"
    KOLU_SERVER="${KOLU_SERVER:-$(nix build .#koluBin --no-link --print-out-paths)/bin/kolu}"
    cd packages/tests
    # No `pnpm install` here: the `install` dep (and, in CI, the ci::install
    # node) already installed the whole workspace, packages/tests included. A
    # second `pnpm install` re-links the shared workspace `node_modules/.bin`,
    # and running concurrently with the `unit` lane's `vitest` it transiently
    # makes `.bin/vitest` non-executable → "Permission denied" (exit 126) — the
    # very "two recipes shelling out to pnpm install race and corrupt each
    # other's node_modules" hazard ci/mod.just documents. CI invokes this recipe
    # with `just --no-deps test` so even the `install` dep can't race the unit lane.
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL="$par" {{ nix_shell_e2e }} pnpm test

# Fast self-contained e2e tests (no nix build, no separate dev server).
# Builds client via pnpm, spawns server from source on random ports.
# Examples:
#   just test-quick                                              # all tests
#   just test-quick features/command-palette.feature:149         # single scenario by line
#   just test-quick features/command-palette.feature             # single feature file
test-quick *args: install
    #!/usr/bin/env bash
    set -euo pipefail
    {{ nix_shell_e2e }} pnpm --filter kolu-client build
    # hooks.ts spawn()s KOLU_SERVER as an executable with ["--port", N].
    # Without nix build there's no `kolu` binary, so we create a temp wrapper
    # that does what the nix-built binary does: set KOLU_CLIENT_DIST and exec tsx.
    wrapper="$(mktemp)"
    trap 'rm -f "$wrapper"' EXIT
    cat > "$wrapper" <<SCRIPT
    #!/bin/sh
    KOLU_CLIENT_DIST="$PWD/packages/client/dist" exec tsx "$PWD/packages/server/src/index.ts" --allow-nix-shell-with-env-whitelist default "\$@"
    SCRIPT
    chmod +x "$wrapper"
    cd packages/tests
    {{ nix_shell_e2e }} pnpm install
    KOLU_SERVER="$wrapper" CUCUMBER_PARALLEL={{ cucumber_parallel }} \
        {{ nix_shell_e2e }} node --import tsx \
        ./node_modules/@cucumber/cucumber/bin/cucumber-js \
        --profile ui {{ args }}

# Boot the packaged Kolu and verify /api/health — production-like runtime smoke
smoke:
    {{ nix_shell }} bash ci/smoke.sh

# Remove all gitignored files (node_modules, build artifacts, etc.)
clean:
    git clean -fdX

# Format all files in-place
fmt: install
    {{ nix_shell }} sh -c 'biome format --write . && nixpkgs-fmt *.nix nix/**/*.nix website/*.nix'

# Check formatting without modifying files (used by CI)
fmt-check: install
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check *.nix nix/**/*.nix website/*.nix'

# Nix build (server + client) — prints store path, no ./result symlink
build:
    nix build --no-link --print-out-paths

# Run the combined server+client binary
run:
    nix run
