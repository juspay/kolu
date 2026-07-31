# Kolu CI pipeline — consumed by odu (github.com/juspay/odu — npins-pinned
# by the independent `ci/flake.nix`).
#
# The runner discovers the recipe tagged [metadata("ci")] (exactly one across
# this justfile and its submodules), expands its reachable dependency subgraph,
# and fans every (recipe × platform) pair out as a pipeline node. Lane hosts
# come from hosts.json ($ODU_HOSTS → ~/.config/odu/hosts.json →
# ~/.config/justci/hosts.json); a `localhost` lane runs against the HEAD
# snapshot, remote lanes `git fetch` the pushed SHA into a writable per-SHA
# workspace on the host.
#
# odu respects just's OS attributes. A `[linux]` recipe is retained on the
# Linux lane and pruned from Darwin (and `odu protect` derives the same filtered
# status list). Keep platform-specific work tagged so unsupported nodes never
# appear on the other lane.

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
#   * `nix` owns the runnable Kolu flake: packages, checks, and dev shells,
#     plus its whole-flake evaluation/schema gate.
#   * Website, example, and CI-tool Nix outputs live in independent subflakes.
#     Their nodes depend on `nix` so Nix builds do not fight over CPU, memory,
#     and store locks; each remains a separate status and source boundary.
#   * Every other node that invokes `nix build` depends on `nix`:
#     home-manager, e2e's `.#koluBin`, smoke's `.#default`, and the pnpm hash
#     rebuild. Their commands remain self-contained, but start from a warmed
#     store after the root evaluator/build process has exited instead of
#     competing with it for CPU, memory, and Nix locks.
#
# This intentionally trades critical-path length for lower peak contention.
[linux]
[macos]
[parallel]
[metadata("ci")]
default: nix agent-flake-nix website-nix website-pnpm-hash-fresh surface-examples-nix solid-browser-example-nix odu-nix home-manager e2e e2e-governance dev-smoke smoke fmt biome unit daemon upgrade-window surface-example-build surface-app-example-build pnpm-hash-fresh atlas-sync osfacts osfacts-live

# Single per-platform `pnpm install`. The runner fans every recipe out into
# its own process and starts them all in parallel as soon as setup completes,
# so any two recipes that each shell out to `pnpm install` against the same
# workspace race and corrupt each other's node_modules (node-pty's native
# postinstall is the visible failure). Funnel every pnpm consumer through
# this node and call pnpm/biome directly downstream — do not invoke top-level
# `just <recipe>` recipes that carry their own `install` dep.
install:
    {{ nix_shell }} pnpm install --frozen-lockfile

# Verify the root pnpmDeps hash matches what fetchPnpmDeps produces from
# ./pnpm-lock.yaml. The website's independent twin is
# `website-pnpm-hash-fresh`.
#
# Two builds are required, not one: `nix build --rebuild` errors with
# "outputs ... are not valid, so checking is not possible" when the store
# path doesn't exist yet. The first `nix build` realizes the path (from
# substituter or fresh fetch); --rebuild then forces re-execution and
# compares, so a stale cached artifact at the declared hash (local store
# or cache.nixos.asia) can't silently satisfy a hash that no longer
# matches the lockfile.
pnpm-hash-fresh: nix
    nix build .#pnpmDeps --no-link
    nix build --rebuild .#pnpmDeps --no-link

# The single ordinary-Nix gate for each platform:
#
# 1. Build every root-flake package, check, and dev shell for the current
#    system. Names come from the flake, so a new output cannot silently escape
#    CI (see ci/flake-build). This includes the workspace typecheck.
# 2. Run `nix flake check --no-build` as the whole-output evaluation/schema
#    gate. Step 1 already realizes the check derivations; this command exists
#    only to validate the flake structure and evaluation.
nix:
    bash ci/flake-build .
    nix flake check --no-build --accept-flake-config -L

# Evaluate every remote-agent package from the exact minimal source flake baked
# into Kolu's wrappers. The package names come from Kolu's agent manifest,
# and the system comes from Nix itself: no platform or consumer-owned map can
# drift from the source flake. Keep this CI-only so a fresh `nix run` does not
# pay to evaluate remote agents it may never provision.
#
# LOAD-BEARING, not a nicety. `default.nix`'s build-input prove covers only the
# manifest's `prove` list — `padi-agent`, the attr both dial paths actually
# resolve, cannot be proven there (it references the baked source itself; see
# that file's expose/prove note). This recipe is therefore the ONLY gate on the
# exposed attrs. Delete it and a fileset gap that reaches `default` or the TUIs
# surfaces at dial time on a user's box.
agent-flake-nix: nix
    #!/usr/bin/env bash
    set -euo pipefail
    # Same package the production wrapper bakes and `just server` exports —
    # root flake owns it; ./ci re-exports for historical callers only.
    agent_flake_ref="$(nix build .#agent-flake-source --no-link --print-out-paths)"
    system="$(nix eval --impure --raw --expr builtins.currentSystem)"
    agent_packages="$({{ nix_shell }} jq -r '.expose[]' nix/agent-packages.json)"
    [[ -n "$agent_packages" ]]
    while IFS= read -r package; do
      drv="$(nix eval --accept-flake-config --raw "$agent_flake_ref#packages.$system.$package.drvPath")"
      case "$drv" in
        *.drv) ;;
        *) echo "$package resolved to '$drv', not a derivation path" >&2; exit 1 ;;
      esac
    done <<< "$agent_packages"

# Build and schema-check the website subflake after the root Kolu build exits.
# Packages and checks are both required; the website intentionally has no
# development shell of its own.
website-nix: nix
    bash ci/flake-build --kinds packages,checks ./website
    nix flake check ./website --no-build --accept-flake-config -L

# Verify website/pnpm-lock.yaml against the website subflake's declared fixed
# output hash. The first build realizes the path; --rebuild then proves the
# cached path was not masking a stale hash.
website-pnpm-hash-fresh: website-nix
    nix build ./website#pnpm-deps --no-link
    nix build --rebuild ./website#pnpm-deps --no-link

# Build every Nix package shipped by the @kolu/surface examples. These depend
# on Kolu's workspace source and pnpm closure, so run after the root Nix gate.
surface-examples-nix: nix
    bash ci/flake-build --kinds packages ./packages/surface/example
    nix flake check ./packages/surface/example --no-build --accept-flake-config -L

# Build the @kolu/solid-browser docsite from its independent example subflake.
solid-browser-example-nix: nix
    bash ci/flake-build --kinds packages ./packages/solid-browser/example
    nix flake check ./packages/solid-browser/example --no-build --accept-flake-config -L

# Build the repository-pinned Odu coordinator from ci/flake.nix. Odu drives the
# pipeline, but its package must not make `nix run` evaluate CI tooling.
odu-nix: nix
    bash ci/flake-build --kinds packages ./ci
    nix flake check ./ci --no-build --accept-flake-config -L

# Build the separate home-manager example flake after the root Nix gate has
# warmed kolu's store paths. Darwin checks the activation package and launchd
# configuration. Linux checks the NixOS configuration and runs the service,
# adoption, and upgrade VM tests.
home-manager: nix
    if [ "$(uname)" = Darwin ]; then \
      bash ci/flake-build --kinds checks ./nix/home/example -- --override-input kolu .; \
    else \
      bash ci/flake-build --kinds checks --nixos-toplevels ./nix/home/example -- --override-input kolu .; \
    fi

# Boot the packaged Kolu and verify /api/health — runtime smoke that catches
# packaging regressions where `nix build` passes but the binary crashes at
# boot (e.g. missing workspace dep — see #761). smoke.sh shells out to
# `nix build .#default` itself. The `nix` dependency means that command starts
# from an already-realized path rather than competing with the full-output
# build; the node remains separate because booting the result is a distinct
# runtime proof.
smoke: nix
    {{ nix_shell }} bash .apm/skills/ci/smoke.sh

# `smoke`'s dev-mode twin. `smoke` boots the PACKAGED binary; this one boots
# `just dev` and asserts the browser console is clean — the only node that
# exercises Vite's DEV module graph, which is untree-shaken and therefore the
# only place a server-only module reached through a package barrel is visible
# (kolu#2042: `node:fs` in the browser, `nix build` and the whole e2e suite
# green, `just dev` dead on load).
#
# Needs no `nix build`, so it does NOT depend on `nix` — it runs from source
# like `unit` does. `--no-deps`: ci::install already installed the workspace,
# and a second concurrent `pnpm install` corrupts the shared node_modules/.bin
# (see the funnel rule at the top of this file).
dev-smoke: install
    {{ nix_shell }} just --no-deps test-dev

# `just test` builds `.#koluBin` itself (justfile `test` recipe). Depend on
# `nix` as well as the shared pnpm install so that build is an already-realized
# lookup, not a concurrent Nix build.
e2e: install nix
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

# Wave 0's non-browser guard: parse the real Gherkin suite, compare its
# immutable inventory with every committed inventory reachable from HEAD, and
# require a landed coverage-ledger row for every scenario revision that
# disappeared. Runs on both platforms so the platform-specific default counts
# stay executable facts.
e2e-governance: install
    {{ nix_shell }} just --no-deps test-e2e-governance

# Run the canonical fork-free unit recipe after this CI process's install. The
# root recipe owns package concurrency; `--no-deps` preserves CI's single-install
# funnel rather than replaying the root recipe's install dependency.
unit: install
    {{ nix_shell }} just --no-deps test-unit

# The daemon-forking unit suites as their OWN required node (juspay/kolu#1375 A7).
# Default-OFF gating means `unit` alone would silently skip every daemon suite
# forever with CI still green; making `daemon` a distinct DAG node (asserted present
# by daemon-node.test.ts) is what keeps that coverage from evaporating in a recipe
# refactor. Sets the gate + the run-bind leash (a spawned daemon dies with the run);
# CI boxes are leased/contained, so the fork storm cannot reach production.
# `unit` must finish first: both recipes traverse the same 63-package workspace,
# and running two pnpm/Vitest trees concurrently was externally SIGKILLed on
# petit even with each tree's package concurrency bounded to one.
daemon: install unit
    {{ nix_shell }} just --no-deps test-daemon

# Mixed-version daemon upgrade-window — the REAL previous-release e2e (boot the
# previous tag's kaval, current padi against it, Restart kaval). Slow by design:
# fetches tags, nix-builds previous-tag #kaval AND current #kaval, refuses if
# their store paths are identical (that would collapse the window to a
# same-version recycle — the failure mode that green-washed a first landing),
# then runs one vitest file under the daemon gate. Both platforms.
# KOLU_UPGRADE_WINDOW_REQUIRE=1 makes a missing/non-tag/identical previous a
# hard fail (so CI never silently skips or same-versions). Depends on `nix`
# so the current flake is already warm; the previous-ref build is additional.
upgrade-window: install nix
    #!/usr/bin/env bash
    set -euo pipefail
    # CI checkouts are SHA-only and often have NO local tags AND no usable
    # `origin` remote (odu fetches a single SHA into a worktree). A bare
    # `git tag` list is empty → the old "last kaval-touching rev" fallback
    # built a kaval IDENTICAL to current and the e2e green-washed a
    # same-version recycle. Discover the latest vX.Y.Z from every candidate
    # remote URL, fetch THAT tag into the local object store, then nix-build.
    latest_version_tag() {
      local url="$1"
      git ls-remote --tags --refs "$url" 2>/dev/null \
        | awk '{print $2}' \
        | sed 's|refs/tags/||' \
        | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
        | sort -V \
        | tail -1 \
      || true
    }
    # Candidate remotes: configured remotes first, then the known GitHub URL
    # odu itself fetches from (see _ci-setup: "fetching … from https://github.com/juspay/kolu").
    candidates=()
    while IFS= read -r r; do
      [ -n "$r" ] || continue
      u="$(git remote get-url "$r" 2>/dev/null || true)"
      [ -n "$u" ] && candidates+=("$u")
    done < <(git remote 2>/dev/null || true)
    candidates+=("https://github.com/juspay/kolu" "https://github.com/juspay/kolu.git")
    ref=""
    source_url=""
    for url in "${candidates[@]}"; do
      echo "upgrade-window: probing tags at ${url}"
      t="$(latest_version_tag "$url")"
      if [[ "${t}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        ref="$t"
        source_url="$url"
        break
      fi
    done
    if ! [[ "${ref}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      # Last resort: local tags after an opportunistic fetch.
      git fetch --tags --force 2>/dev/null || true
      ref="$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
    fi
    if ! [[ "${ref}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "upgrade-window: REFUSING — no version tag (vX.Y.Z) via ls-remote/fetch; refusing the last-kaval-commit fallback that collapses the window" >&2
      exit 1
    fi
    # Materialise the tag object locally so git+file?ref= can resolve it.
    fetch_url="${source_url:-https://github.com/juspay/kolu}"
    git fetch --force "$fetch_url" "refs/tags/${ref}:refs/tags/${ref}" \
      || { echo "upgrade-window: REFUSING — could not fetch tag ${ref} from ${fetch_url}" >&2; exit 1; }
    git rev-parse --verify "refs/tags/${ref}" >/dev/null \
      || { echo "upgrade-window: REFUSING — tag ${ref} not in local object store after fetch" >&2; exit 1; }
    echo "upgrade-window: previous ref=${ref} (version tag required)"
    prev_out="$(nix build --no-link --print-out-paths "git+file://${PWD}?ref=${ref}#kaval")"
    prev_padi_out="$(nix build --no-link --print-out-paths "git+file://${PWD}?ref=${ref}#padi")"
    curr_out="$(nix build --no-link --print-out-paths ".#kaval")"
    echo "upgrade-window: previous kaval store=${prev_out}"
    echo "upgrade-window: current  kaval store=${curr_out}"
    if [ "${prev_out}" = "${curr_out}" ]; then
      echo "upgrade-window: REFUSING — previous kaval store path equals current (${prev_out}); mixed-version window collapsed to same-version" >&2
      exit 1
    fi
    echo "upgrade-window: store paths differ — window is real"
    export KOLU_PREVIOUS_KAVAL_BIN="${prev_out}/bin/kaval"
    export KOLU_PREVIOUS_PADI_BIN="${prev_padi_out}/bin/padi"
    export KOLU_PREVIOUS_KAVAL_REF="${ref}"
    export KOLU_PREVIOUS_KAVAL_STORE="${prev_out}"
    export KOLU_CURRENT_KAVAL_STORE="${curr_out}"
    test -x "$KOLU_PREVIOUS_KAVAL_BIN"
    test -x "$KOLU_PREVIOUS_PADI_BIN"
    KOLU_DAEMON_TESTS=1 KOLU_DAEMON_BIND_PID=$$ KOLU_UPGRADE_WINDOW_REQUIRE=1 \
      KOLU_PREVIOUS_KAVAL_BIN="$KOLU_PREVIOUS_KAVAL_BIN" \
      KOLU_PREVIOUS_PADI_BIN="$KOLU_PREVIOUS_PADI_BIN" \
      KOLU_PREVIOUS_KAVAL_REF="$KOLU_PREVIOUS_KAVAL_REF" \
      KOLU_PREVIOUS_KAVAL_STORE="$KOLU_PREVIOUS_KAVAL_STORE" \
      KOLU_CURRENT_KAVAL_STORE="$KOLU_CURRENT_KAVAL_STORE" \
      {{ nix_shell }} pnpm --filter @kolu/padi exec vitest run src/upgradeWindow/previousRelease.e2e.test.ts

# Build EVERY @kolu/surface example client (the base example, remote-process-monitor,
# and the fleet-top tutorial parts) — the `@kolu/surface-example*` filter runs
# `build:client` in each package that defines it and skips those that don't (the
# stdio-only mini-ci, the daemon-only fleet-top part 2). Catches example-only
# regressions the workspace-wide typecheck doesn't see — broken Tailwind imports,
# JSX errors, missing imports in the production bundle. These are LIVING DOCS: the
# tutorial pages embed this code, so its clients must BUILD, not just typecheck.
# (The fleet-top-agent binary is a subflake package output, built by
# `surface-examples-nix`.)
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
    {{ nix_shell }} just _fmt-check

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

# osfacts hermetic gate (lane 1). `nix build .#osfacts` runs cargo-nextest in
# checkPhase (process-per-test, per-test timeouts). Depends on `nix` so the
# root flake-build has already warmed the store; this node is the explicit,
# named status for the binary + scar-tissue suite on both platforms — and the
# merge-required half of the osfacts pair (see osfacts-live).
osfacts: nix
    nix build .#osfacts --no-link -L
    # Subflake path must build the same derivation (vazhi pattern).
    bash ci/flake-build --kinds packages ./osfacts

# osfacts live-host oracle (lane 2). In the default run DAG on both platforms,
# after the heavy fan-out drains: its Linux performance scenario is a smoke,
# not a benchmark of how badly concurrent compilers can contend for shared
# caches. The dependencies also put the built binary in the store first.
# Diffs that binary against the host's own tools (`ss` / `lsof`) on a real,
# noisy box — the class of test that can catch OS regressions hermetic
# fixtures cannot. Exit non-zero is honest: a red fails the `/ci` run (no
# exit-0 shim). odu has no informational/soft-fail node kind, so this leaf
# also posts `ci::osfacts-live@…` statuses; it must NOT be absorbed into
# GitHub `required_status_checks` — branch protection stays hermetic-only
# (`ci::osfacts@…`). Do not re-run bare `odu protect` (non-dry-run) without
# excluding these contexts until odu gains a soft-fail kind. Darwin rides
# odu's platform targeting (rasam in the aarch64-darwin pool).
[linux]
[macos]
osfacts-live: osfacts atlas-sync pnpm-hash-fresh agent-flake-nix website-nix home-manager unit daemon e2e
    bash osfacts/scripts/live-oracle.sh


# ── odu convenience (coordinator-side; NOT part of the [metadata("ci")] DAG) ──
# Thin wrappers over `nix run ./ci#odu` so the live dashboard is one just away.
# Unreachable from `default`, so the runner never schedules them.

# Attach a live dashboard to a run in progress (paints over `.ci/odu.sock`).
attach:
    nix run ./ci#odu -- attach

# The final green-gate: print the required `<recipe>@<platform>` status
# contexts the canonical DAG produces for BOTH CI platforms (x86_64-linux +
# aarch64-darwin) — exactly the contexts branch protection gates on. This is
# the source of truth for "is CI done"; verify each is green with
# `gh pr checks`. Pins both platforms so the required list is never a
# single-platform subset (see the ci skill's green-gate). Extra args pass
# straight through to odu, so `just ci::protect --dry-run` prints the contexts
# without touching the PR.
#
# Caveat — osfacts-live: odu has no soft-fail node, so dry-run lists
# `ci::osfacts-live@…` with every other leaf. Those contexts post and may red
# a full `/ci` run, but must stay out of GitHub `required_status_checks`
# (hermetic-only merge gate). Filter them out before any non-dry-run protect
# PATCH, or leave branch protection alone until odu gains a soft-fail kind.
protect *args:
    nix run ./ci#odu -- protect --platform x86_64-linux --platform aarch64-darwin {{ args }}

# ── linux CI host pool (coordinator-side; NOT part of the [metadata("ci")] DAG) ──
# These run on the machine driving CI (not on a pool box), so they're
# unreachable from `default` and the runner never schedules them. They manage
# the fixed pool of warm boxes (kolu-ci-1 .. kolu-ci-N) that odu leases from
# natively per run (odu picks a free box from the `hosts.json` pool, holds it
# for the run, and releases on finish), replacing the old fork-a-golden-per-run
# model. See .agency/do.md and docs/pu-box-ci-ralph-report.md.

# Bring the pool up to strength: (re)create any missing/unhealthy slot, leave
# healthy (warm) slots untouched. Size with KOLU_CI_POOL (default 8).
pool-ensure:
    bash .apm/skills/ci/pu/pool.sh

# Report pool health without changing anything.
pool-status:
    bash .apm/skills/ci/pu/pool.sh status
