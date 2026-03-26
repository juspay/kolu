# Prefix for commands that need a Nix devshell; empty if already inside one.

nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop path:' + justfile_directory() + ' -c' }

mod ci 'ci/mod.just'

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
    KOLU_SERVER="$(nix build path:{{ justfile_directory() }} --print-out-paths)/bin/kolu"
    cd tests
    {{ nix_shell }} pnpm install
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL=8 {{ nix_shell }} pnpm test

# Run e2e tests against a running dev server. Pass a feature file:line to run one scenario.
# Examples:
#   just test-dev                                              # all tests
#   just test-dev features/command-palette.feature:149         # single scenario by line
#   just test-dev features/command-palette.feature             # single feature file
test-dev *args: install
    cd tests \
        && {{ nix_shell }} pnpm install \
        && KOLU_SERVER=http://localhost:5173 {{ nix_shell }} node --import tsx \
            ./node_modules/@cucumber/cucumber/bin/cucumber-js \
            --import 'step_definitions/**/*.ts' --import 'support/**/*.ts' \
            {{ if args == "" { "--profile ui" } else { args } }}

# Run pre-commit hooks on all files
pc:
    {{ nix_shell }} pre-commit run -a

# Nix build (server + client)
build:
    nix build

# Run the combined server+client binary
run:
    nix run
