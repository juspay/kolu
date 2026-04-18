# Kolu website — Astro static site.
#
# Imported from the root justfile as `mod website`. The website is built
# by the root flake (packages.${system}.website); there is no separate
# website flake. Recipes reuse the root's default devShell.

root := justfile_directory() + "/.."
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop ' + root + ' --accept-flake-config -c' }

# List available recipes
default:
    @just --list website

# Install pnpm deps for the website (standalone, not part of the root workspace)
install:
    cd {{ justfile_directory() }} && {{ nix_shell }} pnpm install --ignore-workspace

# Live preview with HMR (astro dev) → http://localhost:4321
dev: install
    cd {{ justfile_directory() }} && {{ nix_shell }} pnpm dev

# Type-check .astro files and TypeScript
check: install
    cd {{ justfile_directory() }} && {{ nix_shell }} pnpm check

# Build the static site via pnpm (fast, local) — emits ./dist
build: install
    cd {{ justfile_directory() }} && {{ nix_shell }} pnpm build

# Build the static site via Nix (reproducible) — prints the store path
nix-build:
    nix build {{ root }}#website --print-out-paths

# Serve the Nix-built site locally to inspect the deploy artifact
preview:
    #!/usr/bin/env bash
    set -euo pipefail
    out=$(nix build {{ root }}#website --print-out-paths --no-link)
    echo "Serving $out on http://127.0.0.1:4321"
    cd {{ justfile_directory() }} && {{ nix_shell }} pnpm exec astro preview --root "$out" --port 4321
