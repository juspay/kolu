# Prefix for commands that need a Nix devshell; empty if already inside one.

nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop path:' + justfile_directory() + ' -c' }

cucumber_parallel := env('CUCUMBER_PARALLEL', '4')

mod ai 'agents/ai.just'

# List available recipes
default:
    @just --list

# Prepare repo for development — install deps and cache so future workflows run faster
prepare: install

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

# Run server with auto-reload
server:
    cd server && {{ nix_shell }} pnpm dev

# Run client with Vite dev server (HMR)
client:
    cd client && {{ nix_shell }} pnpm dev

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
    cd tests
    {{ nix_shell }} pnpm install
    KOLU_SERVER="$wrapper" CUCUMBER_PARALLEL={{ cucumber_parallel }} \
        {{ nix_shell }} node --import tsx \
        ./node_modules/@cucumber/cucumber/bin/cucumber-js \
        --profile ui {{ args }}

# Remove all gitignored files (node_modules, build artifacts, etc.)
clean:
    git clean -fdX

# Format all files in-place. `just fmt` (below) is the CI-side check.
fmt-write:
    {{ nix_shell }} sh -c 'prettier --write --cache --ignore-unknown . && nixpkgs-fmt *.nix nix/**/*.nix'

# Nix build (server + client, default flake output)
build:
    nix build

# Run the combined server+client binary
run:
    nix run

# ─── CI ──────────────────────────────────────────────────────────────────────
# `just ci` runs all CI steps via localci. `localci::run` is the library's
# entry point (see vendor/localci/lib.just) — it acquires a perl Fcntl::flock
# on .localci/current and execs into the scheduler.
#
# Each recipe below with a `[group("localci:system:...")]` attribute is a
# CI step. The attribute tells the scheduler which lane it runs in; just's
# native dep syntax (e.g. `e2e: nix`) encodes intra-lane ordering.
#
# Library recipes are mounted under the `localci::` namespace (one line in
# `just --list`). The forge backend is imported flat so the library can
# invoke `_signoff`/`_list-statuses` as unqualified top-level names from
# inside the module.

mod localci 'vendor/localci/lib.just'
import 'vendor/localci/forges/github.just'

ci: localci::run

# devour-flake builds every output of a flake in one go (all packages,
# checks, devshells, NixOS configs, home-manager configs, etc.) via one
# nix build invocation. https://github.com/srid/devour-flake
devour_flake := "nix build github:srid/devour-flake -L --no-link --print-out-paths"

# TypeScript type checking across all packages — fast static-correctness gate
[group("localci:system:local")]
typecheck: install
    {{ nix_shell }} pnpm typecheck

# Format check (prettier + nixpkgs-fmt). Use `just fmt-write` to format in place.
[group("localci:system:local")]
fmt:
    {{ nix_shell }} sh -c 'prettier --check --cache --ignore-unknown . && nixpkgs-fmt --check *.nix nix/**/*.nix'

# Unit tests (vitest, server + client)
[group("localci:system:local")]
unit: install
    {{ nix_shell }} pnpm test:unit

# Verify vendored .claude/ matches .apm/ sources + security audit
[group("localci:system:local")]
apm-sync: ai::apm-sync

# Build all flake outputs (server, client, NixOS tests, home-manager configs, …)
[group("localci:system:x86_64-linux")]
[group("localci:system:aarch64-darwin")]
nix:
    {{ devour_flake }} --override-input flake .

# Build the example home-manager configuration via devour-flake
[group("localci:system:x86_64-linux")]
home-manager: nix
    {{ devour_flake }} --override-input flake ./nix/home/example --override-input flake/kolu .

# Cucumber e2e tests. CI runs under localci with the `nix` dep above; for a
# fast dev loop without devour-flake, use `just test-quick` instead.
[group("localci:system:x86_64-linux")]
[group("localci:system:aarch64-darwin")]
e2e: install nix
    #!/usr/bin/env bash
    set -euo pipefail
    KOLU_SERVER="${KOLU_SERVER:-$(nix build --print-out-paths)/bin/kolu}"
    cd tests
    {{ nix_shell }} pnpm install
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL={{ cucumber_parallel }} {{ nix_shell }} pnpm test
