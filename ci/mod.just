set working-directory := '..'

nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop --accept-flake-config -c' }

# Pipeline root: every recipe listed here becomes a (recipe × platform) node.
[linux]
[macos]
[parallel]
[metadata("ci")]
default: nix agent-flake-nix agent-bake agent-models agent-published website-nix website-pnpm-hash-fresh surface-examples-nix solid-browser-example-nix odu-nix home-manager e2e e2e-governance dev-smoke smoke fmt biome unit daemon upgrade-window surface-example-build surface-app-example-build pnpm-hash-fresh

# Single per-platform `pnpm install`; every pnpm consumer funnels through it.
install:
    {{ nix_shell }} just _materialize-pinned-members
    {{ nix_shell }} pnpm install --frozen-lockfile

# Verify the root pnpmDeps hash against what fetchPnpmDeps produces from ./pnpm-lock.yaml.
pnpm-hash-fresh: nix
    nix build .#pnpmDeps --no-link
    nix build --rebuild .#pnpmDeps --no-link

# The single ordinary-Nix gate for each platform.
[metadata("odu:pin")]
nix:
    bash ci/flake-build --link .
    nix flake check --no-build --accept-flake-config -L

# Evaluate every remote-agent package from the minimal source flake baked into Kolu's wrappers.
agent-flake-nix: nix
    #!/usr/bin/env bash
    set -euo pipefail
    agent_flake_ref="$(nix build .#agent-flake-source --no-link --print-out-paths --accept-flake-config)"
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
website-nix: nix
    bash ci/flake-build --link --kinds packages,checks ./website
    nix flake check ./website --no-build --accept-flake-config -L

# Verify website/pnpm-lock.yaml against the website subflake's declared fixed output hash.
website-pnpm-hash-fresh: website-nix
    nix build ./website#pnpm-deps --no-link
    nix build --rebuild ./website#pnpm-deps --no-link

# Build every Nix package shipped by the @kolu/surface examples.
surface-examples-nix: nix
    bash ci/flake-build --kinds packages ./packages/surface/example
    nix flake check ./packages/surface/example --no-build --accept-flake-config -L

# Build the @kolu/solid-browser docsite from its independent example subflake.
solid-browser-example-nix: nix
    bash ci/flake-build --kinds packages ./packages/solid-browser/example
    nix flake check ./packages/solid-browser/example --no-build --accept-flake-config -L

# Build the repository-pinned Odu coordinator from ci/flake.nix.
odu-nix: nix
    bash ci/flake-build --link --kinds packages ./ci
    nix flake check ./ci --no-build --accept-flake-config -L

# Build the separate home-manager example flake against this checkout.
home-manager:
    if [ "$(uname)" = Darwin ]; then \
      bash ci/flake-build --kinds checks ./nix/home/example -- --override-input kolu .; \
    else \
      bash ci/flake-build --kinds checks --nixos-toplevels ./nix/home/example -- --override-input kolu .; \
    fi

# Boot the packaged Kolu and verify /api/health.
smoke: nix
    {{ nix_shell }} bash dev/skills/ci/smoke.sh

# `smoke`'s dev-mode twin: boot `just dev` and assert the browser console is clean.
dev-smoke: install
    {{ nix_shell }} just --no-deps test-dev

# The working-tree agent bake's regression guard (#2039).
agent-bake: nix
    {{ nix_shell }} just --no-deps test-agent-bake

# Padi's model call against the two real packages — this tree's floor and upstream's.
agent-models: install nix
    {{ nix_shell }} just --no-deps test-agent-models

# Can every kind of host take the package kolu delivers, and answer every call its contract makes?
agent-published: install nix
    {{ nix_shell }} just --no-deps test-agent-published

# The browser e2e suite, sharded: odu's zero-based pair becomes Cucumber's `CUCUMBER_SHARD`.
[metadata("odu:shard=4")]
e2e: install nix
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${ODU_SHARD_INDEX:-}" || -n "${ODU_SHARD_TOTAL:-}" ]]; then
      if [[ ! "${ODU_SHARD_INDEX:-}" =~ ^(0|[1-9][0-9]*)$ ]] \
        || [[ ! "${ODU_SHARD_TOTAL:-}" =~ ^[1-9][0-9]*$ ]] \
        || ((ODU_SHARD_INDEX >= ODU_SHARD_TOTAL)); then
        echo "ci::e2e: invalid shard pair ODU_SHARD_INDEX='${ODU_SHARD_INDEX:-}' ODU_SHARD_TOTAL='${ODU_SHARD_TOTAL:-}'" >&2
        exit 2
      fi
      export CUCUMBER_SHARD="$((ODU_SHARD_INDEX + 1))/$ODU_SHARD_TOTAL"
      echo "e2e: shard=$CUCUMBER_SHARD (odu index=$ODU_SHARD_INDEX of $ODU_SHARD_TOTAL)"
    fi
    CUCUMBER_RETRY=$([ "$(uname)" = Darwin ] && echo 2 || echo 1) {{ nix_shell }} just --no-deps test

# Wave 0's non-browser guard over the Gherkin suite's committed inventories.
e2e-governance: install
    {{ nix_shell }} just --no-deps test-e2e-governance

# Run the canonical fork-free unit recipe after this CI process's install.
unit: install
    {{ nix_shell }} just --no-deps test-unit

# The daemon-forking packages' suites as their own required node (juspay/kolu#1375 A7).
[metadata("odu:shard=5")]
daemon: install
    {{ nix_shell }} just --no-deps test-daemon

# Mixed-version daemon upgrade-window — the real previous-release e2e.
upgrade-window: install nix
    #!/usr/bin/env bash
    set -euo pipefail
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
      git fetch --tags --force 2>/dev/null || true
      ref="$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
    fi
    if ! [[ "${ref}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "upgrade-window: REFUSING — no version tag (vX.Y.Z) via ls-remote/fetch; refusing the last-kaval-commit fallback that collapses the window" >&2
      exit 1
    fi
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

# Build every @kolu/surface example client.
surface-example-build: install
    {{ nix_shell }} pnpm --filter "@kolu/surface-example*" build:client

# Build the @kolu/surface-app library's example app (vite client).
surface-app-example-build: install
    {{ nix_shell }} pnpm --filter @kolu/surface-app-example build:client

fmt: install
    {{ nix_shell }} just _fmt-check

# Biome lint — the recommended preset, failing on any warning.
biome: install
    {{ nix_shell }} biome lint --error-on-warnings .

# Attach a live dashboard to a run in progress (paints over `.ci/odu.sock`).
attach:
    nix run ./ci#odu -- ci attach

# The final green-gate: the complete required-status-check set.
protect *args:
    bash ci/protect {{ args }}

# Bring the pool up to strength; healthy (warm) slots are left untouched.
pool-ensure:
    bash dev/skills/ci/pu/pool.sh

# Report pool health without changing anything.
pool-status:
    bash dev/skills/ci/pu/pool.sh status
