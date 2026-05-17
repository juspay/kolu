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

# Run TypeScript type checking + Biome lint across all packages — fast static-correctness gate
check: install
    {{ nix_shell }} sh -c 'pnpm typecheck && biome lint .'

# Biome lint only — mirrors ci::biome. Format stays on Prettier for now (see biome.jsonc).
lint: install
    {{ nix_shell }} biome lint .

# Run server with auto-reload
server:
    cd packages/server && {{ nix_shell }} pnpm dev

# Run client with Vite dev server (HMR)
client:
    cd packages/client && {{ nix_shell }} pnpm dev

# Run the @kolu/surface framework example (notes app — all 4 primitives)
surface-example: install
    {{ nix_shell }} pnpm --filter @kolu/surface-example dev

# Run unit tests (vitest) across server and client packages
test-unit: install
    {{ nix_shell }} pnpm test:unit

# Run Cucumber e2e tests (nix build once, each worker spawns the binary)
test: install
    #!/usr/bin/env bash
    set -euo pipefail
    KOLU_SERVER="${KOLU_SERVER:-$(nix build .#koluBin --print-out-paths)/bin/kolu}"
    cd packages/tests
    {{ nix_shell_e2e }} pnpm install
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL={{ cucumber_parallel }} {{ nix_shell_e2e }} pnpm test

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

# Validate the workspace's import graph against .dependency-cruiser.mjs.
# Exits non-zero on `error`-severity violations (warnings are reported but
# don't fail). Used by ci::depcruise.
depcruise: install
    {{ nix_shell }} ./node_modules/.bin/depcruise --validate .dependency-cruiser.mjs --no-progress packages

# Regenerate the dependency graph: a high-level package-collapsed view
# at the top, plus per-package module-level graphs (one .ts file per
# node, edges between files) for drill-down. Mermaid output throughout —
# GitHub renders both layers inline, no graphviz dependency.
depcruise-graph: install
    #!/usr/bin/env bash
    set -euo pipefail
    out=docs/dependency-graph.md
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT

    # Cruise once, reformat many. -T json is the source of truth; depcruise-fmt
    # re-renders without re-parsing 356 modules.
    {{ nix_shell }} ./node_modules/.bin/depcruise \
        --config .dependency-cruiser.mjs --no-progress \
        -T json packages > "$tmp/cruise.json"

    # Top-level: one node per workspace package.
    {{ nix_shell }} ./node_modules/.bin/depcruise-fmt -T mermaid \
        --collapse '^packages/(integrations/[^/]+|[^/]+)' \
        "$tmp/cruise.json" > "$tmp/overview.mmd"

    # Per-package module graphs. Order matters for stable diffs.
    # Workspace packages live at two depths: `packages/<name>/` and
    # `packages/integrations/<name>/`. Match either by enumerating
    # tsconfig.json files (one per workspace package).
    pkgs=$(find packages -mindepth 2 -maxdepth 3 -name tsconfig.json \
        -not -path '*/node_modules/*' -not -path '*/dist/*' \
        -not -path '*/example/*' \
        -exec dirname {} \; | sort -u)

    {
        echo '<!-- Generated by `just depcruise-graph`. Do not edit by hand. -->'
        echo
        echo '# Dependency graph'
        echo
        echo 'Generated by [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser); regenerate with `just depcruise-graph`.'
        echo
        echo '## Package overview'
        echo
        echo 'One node per workspace package, edges between them. Mirrors the architecture table in the top-level README.'
        echo
        echo '```mermaid'
        cat "$tmp/overview.mmd"
        echo '```'
        echo
        echo '## Module-level detail'
        echo
        echo 'Each section below shows the internal `.ts` / `.tsx` files within one workspace package and the imports between them. Cross-package edges are excluded — those live in the overview above. Packages with a single source file are omitted.'
        for pkg in $pkgs; do
            slug=$(echo "$pkg" | sed 's|^packages/||')
            {{ nix_shell }} ./node_modules/.bin/depcruise-fmt -T mermaid \
                --include-only "^$pkg/" \
                "$tmp/cruise.json" > "$tmp/pkg.mmd"
            # Skip packages with no internal edges — a single-node graph
            # is noise (e.g. `nonempty/src/index.ts` standing alone).
            lines=$(grep -c -- '-->' "$tmp/pkg.mmd" || true)
            if [ "${lines:-0}" -eq 0 ]; then continue; fi
            echo
            echo "### \`$slug\`"
            echo
            echo '```mermaid'
            cat "$tmp/pkg.mmd"
            echo '```'
        done
    } > "$out"
    echo "wrote $out"

# Remove all gitignored files (node_modules, build artifacts, etc.)
clean:
    git clean -fdX

# Format all files in-place
fmt: install
    {{ nix_shell }} sh -c 'biome format --write . && nixpkgs-fmt *.nix nix/**/*.nix website/*.nix'

# Check formatting without modifying files (used by CI)
fmt-check: install
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check *.nix nix/**/*.nix website/*.nix'

# Nix build (server + client)
build:
    nix build

# Run the combined server+client binary
run:
    nix run
