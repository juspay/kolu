# Kolu website — Astro static site.
#
# Imported from the root justfile as `mod website`. Recipes run in their own
# nix devShell (the website flake — zero flake inputs, opens fast).

nix_shell := if env('IN_NIX_SHELL', '') == 'kolu-website-shell' { '' } else { 'nix develop ' + justfile_directory() + ' --accept-flake-config -c' }

# List available recipes
default:
    @just --list website

# Install pnpm deps for the website
install:
    {{ nix_shell }} pnpm install --ignore-workspace

# Live preview with HMR (astro dev)
dev: install
    {{ nix_shell }} pnpm dev

# Type-check .astro files and TypeScript
check: install
    {{ nix_shell }} pnpm check

# Build the static site via pnpm (fast, local) — emits ./dist
build: install
    {{ nix_shell }} pnpm build

# Build the static site via Nix (reproducible) — prints the store path
nix-build:
    nix build {{ justfile_directory() }}#default --print-out-paths

# Serve the Nix-built site locally to inspect the deploy artifact
preview:
    #!/usr/bin/env bash
    set -euo pipefail
    out=$(nix build {{ justfile_directory() }}#default --print-out-paths --no-link)
    echo "Serving $out on http://127.0.0.1:4321"
    {{ nix_shell }} pnpm exec astro preview --root "$out" --port 4321

# Refresh fetchPnpmDeps hash after pnpm-lock.yaml changes.
# Runs `nix build .#pnpmDeps` twice — first to realize, then --rebuild to
# force re-execution, so a stale cache can't satisfy an outdated hash.
pnpm-hash-fresh:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ justfile_directory() }}
    nix build .#pnpmDeps --no-link
    nix build --rebuild .#pnpmDeps --no-link
