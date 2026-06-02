# Kolu CI pipeline — consumed by github:juspay/justci.
#
# The runner discovers the recipe tagged [metadata("ci")] (exactly one across
# this justfile and its submodules), expands its reachable dependency subgraph,
# and fans every (recipe × platform) pair out into a process-compose node.
# Local platform runs against the worktree; non-local platforms ship a git
# bundle over SSH to the host configured under that system tuple in
# ~/.config/justci/hosts.json.
#
# Today every reachable recipe is replicated to every pipeline platform — the
# per-recipe [linux]/[macos] filter is on the runner's roadmap. So a step
# tagged [linux]-only would still be scheduled on macOS and fail there; keep
# leaf recipes platform-neutral until that lands.

# Submodule recipes default to running from the submodule's directory (`ci/`),
# but commands like `nix build … --override-input flake .` and `nix develop -c`
# expect the repo root. Pin the working directory once instead of cd'ing in
# every body.
set working-directory := '..'

# Re-enter nix devShell when the runner ssh's into a remote that doesn't have
# the project's dev tools (jq/gh/pnpm/biome/…) on PATH. Skipped when already
# inside the shell so local invocations stay cheap.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop --accept-flake-config -c' }

# Pipeline root: every recipe listed here becomes a (recipe × platform) node.
# Body is empty — the runner expands `depends_on` from this DAG and executes
# each leaf via `just --no-deps <recipe>`. `just ci` (without the runner) still
# works for single-platform local runs via the [parallel] expansion.
#
# Dependency edges exist to ORDER work, and every edge is latency: a node
# can't start until all its deps finish. The runner already fans these out
# maximally, so the wall-clock is the *critical path* — the longest dependency
# chain. We keep that path as short as honestly possible:
#
#   * `nix` (devour-flake, all outputs incl. the typecheck `checks.*`) is the
#     big build, but `e2e`, `smoke`, and `home-manager` no longer wait on it.
#     Each of those self-builds exactly the store path it needs (`just test`
#     builds `.#koluBin`; `smoke.sh` builds `.#default`; `home-manager` builds
#     kolu via `--override-input`), and Nix store locking dedups the shared
#     drv with `nix`'s concurrent build — so they overlap the big build
#     instead of queuing behind it. This moves the ~2-min `e2e` lane (the long
#     pole) off the `nix → e2e` chain and onto its own parallel branch.
#   * Coverage is unchanged: `nix` still runs (it's a direct `default` dep), so
#     the typecheck/website/packaging gates all still fire. The only behavior
#     traded is that `e2e`/`smoke`/`home-manager` now run even when `nix`
#     fails — which surfaces *more* independent signal per run, and all four
#     stay required checks, so the merge gate is identical.
#
# The cost is more concurrent nix builds on one host; on the ephemeral per-run
# linux box (a full machine) that's the intended trade. See the ralph report
# at docs/ci-workflow-ralph-report.md for the critical-path measurements.
[linux]
[macos]
[parallel]
[metadata("ci")]
default: nix home-manager e2e smoke fmt biome unit surface-example-build pnpm-hash-fresh docs-moc

# Single per-platform `pnpm install`. The runner fans every recipe out into
# its own process and starts them all in parallel as soon as setup completes,
# so any two recipes that each shell out to `pnpm install` against the same
# workspace race and corrupt each other's node_modules (node-pty's native
# postinstall is the visible failure). Funnel every pnpm consumer through
# this node and call pnpm/biome directly downstream — do not invoke top-level
# `just <recipe>` recipes that carry their own `install` dep.
install:
    {{ nix_shell }} pnpm install --frozen-lockfile

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

# Build all flake outputs via devour-flake. This includes `checks.*`, so the
# workspace typecheck (checks.x86_64-linux.typecheck) runs here — it replaced
# the standalone `typecheck` recipe (juspay/kolu#1049). The typecheck result
# is content-addressed, so it only re-runs when a typechecked source changes.
nix:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .

# Builds the home-manager example flake, which pulls kolu in via
# `--override-input flake/kolu .` — so it builds kolu from source itself. No
# `nix` dep: store locking dedups the shared kolu drv with the `nix` node's
# concurrent build, letting the home-manager VM work overlap the big build
# instead of queuing behind every devour-flake output.
home-manager:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake ./nix/home/example --override-input flake/kolu .

# Boot the packaged Kolu and verify /api/health — runtime smoke that catches
# packaging regressions where `nix build` passes but the binary crashes at
# boot (e.g. missing workspace dep — see #761). smoke.sh shells out to
# `nix build .#default` itself, so no `nix` dep (and no pnpm install): it
# builds the `.#default` drv directly, deduped against `nix`'s concurrent
# build via store locking, and boots as soon as that one path is ready.
smoke:
    {{ nix_shell }} bash ci/smoke.sh

# No `nix` dep: `just test` builds `.#koluBin` itself (justfile `test`
# recipe), so e2e needs only the pnpm deps `install` provides — not the full
# devour-flake build. Dropping the `nix` edge lets the ~2-min suite run
# concurrently with the big build (koluBin drv deduped via store locking)
# instead of strictly after it. This is the single largest critical-path win.
e2e: install
    # CUCUMBER_RETRY=1 is the residual safety net for darwin-runner-load
    # flakes that survive the structural fixes in #955. Local
    # `just test-quick` runs leave it unset (0 = off) so real failures
    # surface on the first attempt.
    CUCUMBER_RETRY=1 {{ nix_shell }} just test

# Run vitest unit tests (server + client).
unit: install
    {{ nix_shell }} pnpm test:unit

# Build the @kolu/surface framework's example app (vite client + tsc on
# server). Catches example-only regressions that the workspace-wide
# typecheck doesn't see — broken Tailwind imports, JSX errors, missing
# imports in the production bundle. Cheap (~1s).
surface-example-build: install
    {{ nix_shell }} pnpm --filter @kolu/surface-example build:client

fmt: install
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check *.nix nix/**/*.nix website/*.nix'

# Biome lint — recommended preset with each currently-noisy rule explicitly
# off in biome.jsonc. Each disabled rule has a follow-up PR slot (#710).
biome: install
    {{ nix_shell }} biome lint .


# MOC integrity gate. The check lives in the docs/plans module
# (`plans::check`), co-located with what it guards; this node keeps it in the
# CI DAG and posts the ci::docs-moc status. Run locally as `just plans::check`.
docs-moc:
    just plans::check
