# Kolu CI pipeline — consumed by github:juspay/ci.
#
# The runner discovers the recipe tagged [metadata("ci")] (exactly one across
# this justfile and its submodules), expands its reachable dependency subgraph,
# and fans every (recipe × platform) pair out into a process-compose node.
# Local platform runs against the worktree; non-local platforms ship a git
# bundle over SSH to the host configured under that system tuple in
# ~/.config/ci/hosts.json.
#
# Today every reachable recipe is replicated to every pipeline platform — the
# per-recipe [linux]/[macos] filter is on the runner's roadmap. So a step
# tagged [linux]-only would still be scheduled on macOS and fail there; keep
# leaf recipes platform-neutral until that lands.

# Re-enter nix devShell when the runner ssh's into a remote that doesn't have
# the project's dev tools (jq/gh/pnpm/biome/…) on PATH. Skipped when already
# inside the shell so local invocations stay cheap.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop --accept-flake-config -c' }

# Pipeline root: every recipe listed here becomes a (recipe × platform) node.
# Body is empty — the runner expands `depends_on` from this DAG and executes
# each leaf via `just --no-deps <recipe>`. `just ci` (without the runner) still
# works for single-platform local runs via the [parallel] expansion.
[linux]
[macos]
[parallel]
[metadata("ci")]
default: nix home-manager e2e smoke fmt typecheck biome unit surface-example-build pnpm-hash-fresh

# Verify the declared pnpmDeps hashes match what fetchPnpmDeps produces from
# the current pnpm-lock.yaml files. Covers both the main kolu lockfile
# (./pnpm-lock.yaml → .#pnpmDeps) and the website lockfile
# (./website/pnpm-lock.yaml → .#website-pnpm-deps).
#
# Two builds are required, not one: `nix build --rebuild` errors with
# "outputs ... are not valid, so checking is not possible" when the store
# path doesn't exist yet. The first `nix build` realizes the path (from
# substituter or fresh fetch); --rebuild then forces re-execution and
# compares, so a stale cached artifact at the declared hash (local store
# or cache.nixos.asia) can't silently satisfy a hash that no longer
# matches the lockfile.
pnpm-hash-fresh:
    nix build .#pnpmDeps .#website-pnpm-deps --no-link
    nix build --rebuild .#pnpmDeps .#website-pnpm-deps --no-link

# Build all flake outputs via devour-flake.
nix:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .

home-manager: nix
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake ./nix/home/example --override-input flake/kolu .

typecheck:
    {{ nix_shell }} just check

e2e: nix
    {{ nix_shell }} just test

# Boot the packaged Kolu and verify /api/health — runtime smoke that catches
# packaging regressions where `nix build` passes but the binary crashes at
# boot (e.g. missing workspace dep — see #761).
smoke: nix
    {{ nix_shell }} just smoke

# Run vitest unit tests (server + client).
unit:
    {{ nix_shell }} just test-unit

# Build the @kolu/surface framework's example app (vite client + tsc on
# server). Catches example-only regressions that the workspace-wide
# typecheck doesn't see — broken Tailwind imports, JSX errors, missing
# imports in the production bundle. Cheap (~1s).
surface-example-build:
    {{ nix_shell }} sh -c 'pnpm install --frozen-lockfile && pnpm --filter @kolu/surface-example build:client'

fmt:
    {{ nix_shell }} just fmt-check

# Biome lint — recommended preset with each currently-noisy rule explicitly
# off in biome.jsonc. Each disabled rule has a follow-up PR slot (#710).
biome:
    {{ nix_shell }} biome lint .
