# Prefix for commands that need a Nix devshell; empty if already inside one.

nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop -c' }

# localci branch/ref to use (override: just localci_ref=main run-ci)
localci_ref := "justfile-config"
localci := "nix run github:srid/localci/" + localci_ref + " --"

mod ci

# List available recipes
default:
    @just --list

# Install pnpm dependencies
install:
    {{ nix_shell }} pnpm install

# Run server + client in parallel via process-compose
dev: install
    {{ nix_shell }} kolu-dev

# Run TypeScript type checking across all packages
watch: install
    {{ nix_shell }} pnpm typecheck

# Run server with auto-reload
server: install
    cd server && {{ nix_shell }} pnpm dev

# Run client with Vite dev server (HMR)
client: install
    cd client && {{ nix_shell }} pnpm dev

# Run Cucumber e2e tests (nix build once, each worker spawns the binary)
test: install
    #!/usr/bin/env bash
    set -euo pipefail
    KOLU_SERVER="$(nix build --print-out-paths)/bin/kolu"
    cd tests
    {{ nix_shell }} pnpm install
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL=8 {{ nix_shell }} pnpm test

# Run Cucumber e2e tests against an already-running dev server (just dev)
test-dev: install
    cd tests \
        && {{ nix_shell }} pnpm install \
        && KOLU_SERVER=http://localhost:5173 {{ nix_shell }} pnpm test

# Run CI: build all flake outputs on each platform, run e2e tests
# Uses localci (https://github.com/srid/localci) to run commands and post GitHub commit statuses.
# TODO: add cache push (nix copy) after builds https://github.com/srid/localci/issues/4
run-ci:
    {{ localci }} --tui

# Run pre-commit hooks on all files
pc:
    {{ nix_shell }} pre-commit run -a

# Nix build (server + client)
build:
    nix build

# Run the combined server+client binary
run:
    nix run
