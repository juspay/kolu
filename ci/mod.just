# Kolu CI pipeline — consumed by odu (github.com/juspay/odu — npins-pinned and re-exported as `nix run .#odu`).
#
# The runner discovers the recipe tagged [metadata("ci")] (exactly one across
# this justfile and its submodules), expands its reachable dependency subgraph,
# and fans every (recipe × platform) pair out as a pipeline node. Lane hosts
# come from hosts.json ($ODU_HOSTS → ~/.config/odu/hosts.json →
# ~/.config/justci/hosts.json); a `localhost` lane runs against the HEAD
# snapshot, remote lanes `git fetch` the pushed SHA into a writable per-SHA
# workspace on the host.
#
# Today every reachable recipe is replicated to every pipeline platform — a
# per-recipe [linux]/[macos] filter is future work (it was on justci's roadmap
# too). So a step tagged [linux]-only would still be scheduled on macOS and
# fail there; keep leaf recipes platform-neutral until that lands.

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
#   * `nix` (all packages, checks, and dev shells incl. typecheck) is the
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
default: nix flake-check home-manager e2e smoke fmt biome unit surface-example-build surface-app-example-build pnpm-hash-fresh atlas-sync

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

# Build every derivation output the flake exposes for the current system.
# Per-system enumeration is deliberate: odu runs this recipe once in each
# platform lane, and each lane proves its own packages, checks, and dev shells.
# Names come from the flake itself so adding one cannot silently escape CI.
# This includes `checks.*`, so the workspace typecheck
# (checks.x86_64-linux.typecheck) runs here — it replaced the standalone
# `typecheck` recipe (juspay/kolu#1049). The typecheck result is
# content-addressed, so it only re-runs when a typechecked source changes.
nix:
    #!/usr/bin/env bash
    set -euo pipefail
    system="$(nix eval --impure --raw --expr builtins.currentSystem)"
    flake_outputs="$(nix flake show --json .)"
    outputs=()
    for kind in packages checks devShells; do
      names="$(
        jq -cer --arg kind "$kind" --arg system "$system" '
          .[$kind][$system]
          | if type == "object"
            then keys
            else error("ci::nix: flake output " + $kind + "." + $system + " is missing or is not an object")
            end
        ' <<< "$flake_outputs"
      )"
      count="$(jq -r 'length' <<< "$names")"
      if (( count == 0 )); then
        echo "ci::nix: flake exposed no $kind outputs for $system" >&2
        exit 1
      fi
      while IFS= read -r name; do
        outputs+=(".#$kind.$system.$name")
      done < <(jq -r '.[]' <<< "$names")
    done
    nix build -L --no-link --print-out-paths "${outputs[@]}"

# `nix flake check`: evaluate every flake output and run the flake's `checks.*`.
# Complements the `nix` node (which builds the output drvs) with the
# flake-schema + whole-output *evaluation* gate — it forces every output to
# evaluate, so an eval-time regression like an import-from-derivation that can't
# be realised mid-eval (juspay/kolu#1317) fails here even when a plain build of
# the affected drv would have succeeded. Store locking dedups its check builds
# against the concurrent `nix` node, so it overlaps that build rather than
# repeating it. No `nix` dep — it's an independent parallel leaf.
flake-check:
    nix flake check --accept-flake-config -L

# Builds the home-manager example flake, which pulls kolu in via
# `--override-input kolu .` — so it builds kolu from source itself. Like
# `ci::nix`, it enumerates the current system on purpose: the Linux lane builds
# Linux checks/configurations and the Darwin lane builds Darwin checks. No
# `nix` dep: store locking dedups the shared kolu drv with the `nix` node's
# concurrent build, letting the home-manager VM work overlap the big build
# instead of queuing behind every flake output.
home-manager:
    #!/usr/bin/env bash
    set -euo pipefail
    system="$(nix eval --impure --raw --expr builtins.currentSystem)"
    outputs=()
    check_installables="$(
      nix eval --raw "./nix/home/example#checks.$system" \
        --override-input kolu . \
        --apply "attrs: builtins.concatStringsSep \"\\n\" (map (name: \"./nix/home/example#checks.$system.\" + name) (builtins.attrNames attrs))"
    )"
    while IFS= read -r output; do
      [[ -n "$output" ]] && outputs+=("$output")
    done <<< "$check_installables"
    if (( ${#outputs[@]} == 0 )); then
      echo "ci::home-manager: example exposed no checks for $system" >&2
      exit 1
    fi
    config_installables="$(
      nix eval --raw ./nix/home/example#nixosConfigurations \
        --override-input kolu . \
        --apply "configs: builtins.concatStringsSep \"\\n\" (map (name: \"./nix/home/example#nixosConfigurations.\" + name + \".config.system.build.toplevel\") (builtins.filter (name: configs.\${name}.pkgs.stdenv.hostPlatform.system == \"$system\") (builtins.attrNames configs)))"
    )"
    while IFS= read -r output; do
      [[ -n "$output" ]] && outputs+=("$output")
    done <<< "$config_installables"
    nix build -L --no-link --print-out-paths \
      --override-input kolu . \
      "${outputs[@]}"

# Boot the packaged Kolu and verify /api/health — runtime smoke that catches
# packaging regressions where `nix build` passes but the binary crashes at
# boot (e.g. missing workspace dep — see #761). smoke.sh shells out to
# `nix build .#default` itself, so no `nix` dep (and no pnpm install): it
# builds the `.#default` drv directly, deduped against `nix`'s concurrent
# build via store locking, and boots as soon as that one path is ready.
smoke:
    {{ nix_shell }} bash .apm/skills/ci/smoke.sh

# No `nix` dep: `just test` builds `.#koluBin` itself (justfile `test`
# recipe), so e2e needs only the pnpm deps `install` provides — not the full
# full-output build. Dropping the `nix` edge lets the ~2-min suite run
# concurrently with the big build (koluBin drv deduped via store locking)
# instead of strictly after it. This is the single largest critical-path win.
e2e: install
    # CUCUMBER_RETRY is the residual safety net for darwin-runner-load flakes
    # that survive the structural fixes in #955. Darwin runs at 2, linux at 1:
    # the darwin residual is an fs-event-drop class (e.g. the live-reload
    # edit→preview refresh whose single FSEvents notification the kernel
    # occasionally drops under the post-koluBin-build storm) that can lose two
    # attempts; the third absorbs that tail. Linux's filesystem watch is
    # reliable, so it stays at 1. Local `just test-quick` leaves it unset
    # (0 = off) so real failures surface on the first attempt.
    # `--no-deps`: ci::install already installed the workspace; without it the
    # `test: install` dep re-runs `pnpm install` concurrently with the unit lane
    # and the two races corrupt the shared node_modules/.bin (vitest exit 126).
    # See the funnel rule at the top of this file and the `test` recipe comment.
    CUCUMBER_RETRY=$([ "$(uname)" = Darwin ] && echo 2 || echo 1) {{ nix_shell }} just --no-deps test

# Run vitest unit tests (server + client).
unit: install
    {{ nix_shell }} pnpm test:unit

# Build EVERY @kolu/surface example client (the base example, remote-process-monitor,
# and the fleet-top tutorial parts) — the `@kolu/surface-example*` filter runs
# `build:client` in each package that defines it and skips those that don't (the
# stdio-only mini-ci, the daemon-only fleet-top part 2). Catches example-only
# regressions the workspace-wide typecheck doesn't see — broken Tailwind imports,
# JSX errors, missing imports in the production bundle. These are LIVING DOCS: the
# tutorial pages embed this code, so its clients must BUILD, not just typecheck.
# (The fleet-top-agent binary is a flake package output, built by the `nix` lane.)
# Cheap (~1s).
surface-example-build: install
    {{ nix_shell }} pnpm --filter "@kolu/surface-example*" build:client

# Build the @kolu/surface-app library's example app (vite client). Same purpose
# as surface-example-build but for surface-app: catches example-only regressions
# the workspace-wide typecheck misses — broken composition (installSurfaceApp,
# composeSurfaces, implementSurfaceApp), Tailwind/JSX errors, missing bundle
# imports. Cheap (~1s).
surface-app-example-build: install
    {{ nix_shell }} pnpm --filter @kolu/surface-app-example build:client

fmt: install
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check *.nix nix/**/*.nix website/*.nix'

# Biome lint — recommended preset with each deliberately-advisory rule
# explicitly off (with a reason) in biome.jsonc. `--error-on-warnings` makes
# the gate fail on *any* warning, not just errors, so warning-severity lint
# debt can no longer accrue invisibly on master (#1362).
biome: install
    {{ nix_shell }} biome lint --error-on-warnings .


# Atlas sync gate. The check lives in the docs/atlas module
# (`atlas::check-sync`): it rebuilds the self-contained Atlas and fails if the
# committed docs/atlas/dist/ is stale (a note changed without committing the
# regenerated HTML). Co-located with what it guards; this node keeps it in the
# CI DAG and posts the ci::atlas-sync status. Run locally as
# `just atlas::check-sync`. atlas uses an isolated (--ignore-workspace)
# node_modules, so its install never races the root pnpm install above.
atlas-sync:
    {{ nix_shell }} just atlas::check-sync


# ── linux CI host pool (coordinator-side; NOT part of the [metadata("ci")] DAG) ──
# These run on the machine driving CI (not on a pool box), so they're
# unreachable from `default` and the runner never schedules them. They manage
# the fixed pool of warm boxes (kolu-ci-1 .. kolu-ci-N) that .apm/skills/ci/pu/lease.sh
# leases per run (the box is pinned into the run via the odu MCP's `hosts`
# argument), replacing the old fork-a-golden-per-run model. See .agency/do.md
# and docs/pu-box-ci-ralph-report.md.

# Bring the pool up to strength: (re)create any missing/unhealthy slot, leave
# healthy (warm) slots untouched. Size with KOLU_CI_POOL (default 8).
pool-ensure:
    bash .apm/skills/ci/pu/pool.sh

# Report pool health without changing anything.
pool-status:
    bash .apm/skills/ci/pu/pool.sh status
