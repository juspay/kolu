# Prefix for commands that need a Nix devshell; empty if already inside one.

nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop path:' + justfile_directory() + ' -c' }

mod ci 'ci/mod.just'

# List available recipes
default:
    @just --list

# Install pnpm dependencies
install:
    {{ nix_shell }} pnpm install

# Run server + client in parallel.
# Enters nix develop once, then re-invokes just inside it — subsequent
# recipes see IN_NIX_SHELL so nix_shell becomes a no-op.
dev:
    {{ nix_shell }} just _dev

[private]
_dev: install _dev-parallel

[private]
[parallel]
_dev-parallel: server client

# Run TypeScript type checking across all packages
watch: install
    {{ nix_shell }} pnpm typecheck

# Run server with auto-reload
server:
    cd server && {{ nix_shell }} pnpm dev

# Run client with Vite dev server (HMR)
client:
    cd client && {{ nix_shell }} pnpm dev

# Run unit tests (vitest) across server and client packages
test-unit: install
    {{ nix_shell }} pnpm test:unit

# Run Cucumber e2e tests (nix build once, each worker spawns the binary)
test: install
    #!/usr/bin/env bash
    set -euo pipefail
    KOLU_SERVER="${KOLU_SERVER:-$(nix build --print-out-paths)/bin/kolu}"
    cd tests
    {{ nix_shell }} pnpm install
    # Temp dirs for Claude Code status detection mock tests
    export KOLU_CLAUDE_SESSIONS_DIR="$(mktemp -d)"
    export KOLU_CLAUDE_PROJECTS_DIR="$(mktemp -d)"
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL=8 {{ nix_shell }} pnpm test

# Fast self-contained e2e tests (no nix build, no separate dev server).
# Builds client via pnpm, spawns server from source on random ports.
# Examples:
#   just test-quick                                              # all tests
#   just test-quick features/command-palette.feature:149         # single scenario by line
#   just test-quick features/command-palette.feature             # single feature file
test-quick *args: install
    #!/usr/bin/env bash
    set -euo pipefail
    {{ nix_shell }} pnpm --filter kolu-client build
    # hooks.ts spawn()s KOLU_SERVER as an executable with ["--port", N].
    # Without nix build there's no `kolu` binary, so we create a temp wrapper
    # that does what the nix-built binary does: set KOLU_CLIENT_DIST and exec tsx.
    wrapper="$(mktemp)"
    trap 'rm -f "$wrapper"' EXIT
    cat > "$wrapper" <<SCRIPT
    #!/bin/sh
    KOLU_CLIENT_DIST="$PWD/client/dist" exec tsx "$PWD/server/src/index.ts" --allow-nix-shell-with-env-whitelist default "\$@"
    SCRIPT
    chmod +x "$wrapper"
    # Temp dirs for Claude Code status detection mock tests
    export KOLU_CLAUDE_SESSIONS_DIR="$(mktemp -d)"
    export KOLU_CLAUDE_PROJECTS_DIR="$(mktemp -d)"
    cd tests
    {{ nix_shell }} pnpm install
    KOLU_SERVER="$wrapper" CUCUMBER_PARALLEL="${CUCUMBER_PARALLEL:-8}" \
        {{ nix_shell }} node --import tsx \
        ./node_modules/@cucumber/cucumber/bin/cucumber-js \
        --profile ui {{ args }}

# Compile instructions + deploy primitives via APM
apm:
    uvx --from git+https://github.com/microsoft/apm apm compile
    uvx --from git+https://github.com/microsoft/apm apm install

# Audit APM packages for security issues (Unicode, lockfile consistency)
apm-audit:
    uvx --from git+https://github.com/microsoft/apm apm audit --ci

# Remove all gitignored files (APM output, node_modules, build artifacts, etc.)
clean:
    git clean -fdX

# Format all files in-place
fmt:
    {{ nix_shell }} sh -c 'prettier --write --cache --ignore-unknown . && nixpkgs-fmt *.nix nix/**/*.nix'

# Check formatting without modifying files (used by CI)
fmt-check:
    {{ nix_shell }} sh -c 'prettier --check --cache --ignore-unknown . && nixpkgs-fmt --check *.nix nix/**/*.nix'

# Nix build (server + client)
build:
    nix build

# Run the combined server+client binary
run:
    nix run
