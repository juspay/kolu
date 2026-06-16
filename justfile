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
mod atlas 'docs/atlas/mod.just'

# List available recipes
default:
    @just --list

# Prepare repo for development — install deps and cache so future workflows run faster
prepare: install

# Install pnpm dependencies
install:
    {{ nix_shell }} pnpm install

# Run server + client in parallel.
# Bare `just dev` keeps the canonical 7681/5173 (see README). Override either
# port to run a second instance alongside a primary one; empty falls back to
# the default. `just dev-auto` picks two free ports for you.
#   just dev 7700 5180   (positional: SERVER_PORT then CLIENT_PORT)
# The env vars must be exported before the parallel fork — Vite reads them once
# at startup to compute its proxy target — so resolution happens here, in the
# sequential recipe body, before `_dev` forks server + client.
dev SERVER_PORT="" CLIENT_PORT="":
    #!/usr/bin/env bash
    set -euo pipefail
    export KOLU_DEV_SERVER_PORT="{{ SERVER_PORT }}"
    export KOLU_DEV_CLIENT_PORT="{{ CLIENT_PORT }}"
    echo "→ server http://localhost:${KOLU_DEV_SERVER_PORT:-7681}"
    echo "→ client http://localhost:${KOLU_DEV_CLIENT_PORT:-5173}"
    {{ nix_shell }} just _dev

# Run server + client on two free random ports, printing the resolved URLs.
# For agents / a second worktree that must not collide with a primary instance.
dev-auto:
    #!/usr/bin/env bash
    set -euo pipefail
    # python3 via nix (not a global install) so this works outside the devshell.
    # Both sockets stay open until printed, guaranteeing two *unique* free ports.
    read -r SERVER_PORT CLIENT_PORT < <(nix shell nixpkgs#python3 --command python3 -c 'import socket; a=socket.socket(); a.bind(("",0)); b=socket.socket(); b.bind(("",0)); print(a.getsockname()[1], b.getsockname()[1]); a.close(); b.close()')
    # Positional args — `just dev NAME=VALUE` would bind the literal "NAME=VALUE"
    # to the param, not the value.
    exec just dev "$SERVER_PORT" "$CLIENT_PORT"

[private]
_dev: install _dev-parallel

[private]
[parallel]
_dev-parallel: server client

# Run TypeScript type checking + Biome lint across all packages — fast static-correctness gate.
# Typecheck stays inline; the lint half delegates to ci::biome so the gate flag
# lives in exactly one recipe and local==CI is guaranteed by construction.
# `--no-deps` skips ci::biome's own `install` dep — our top-level `install` already
# ran the same `pnpm install`, so this avoids a redundant second install.
check: install
    {{ nix_shell }} pnpm typecheck
    just --no-deps ci::biome

# Biome lint only — delegates to ci::biome, the single source of truth for the gate.
# `install` runs here (node_modules must exist for a cold `just lint`); `--no-deps`
# then skips ci::biome's duplicate install dep.
lint: install
    just --no-deps ci::biome

# Run server with auto-reload. Honors KOLU_DEV_SERVER_PORT if set (e.g. by
# `just dev`), otherwise the server CLI falls back to its default port.
# KOLU_KAVAL_SOCKET isolates this dev instance's kaval daemon in a private,
# per-port 0700 dir so the always-recycle boot policy never SIGTERMs a production
# kolu.service's daemon (which holds the default $XDG_RUNTIME_DIR/kaval socket)
# — and a second worktree's dev server (its own port) likewise gets its own.
server:
    {{ nix_shell }} bash -c 'd="${XDG_RUNTIME_DIR:-/tmp}/kolu-dev-${KOLU_DEV_SERVER_PORT:-default}"; mkdir -p "$d" && chmod 700 "$d"; cd packages/server && KOLU_KAVAL_SOCKET="$d/pty-host.sock" pnpm dev ${KOLU_DEV_SERVER_PORT:+--port $KOLU_DEV_SERVER_PORT}'

# Run client with Vite dev server (HMR)
client:
    cd packages/client && {{ nix_shell }} pnpm dev

# Run unit tests (vitest) across server and client packages
test-unit: install
    {{ nix_shell }} pnpm test:unit

# Run Cucumber e2e tests (nix build once, each worker spawns the binary)
test: install
    #!/usr/bin/env bash
    set -euo pipefail
    # Raise the fd soft limit before spawning workers/servers. macOS defaults
    # to 256, which a kolu server under parallel load can exhaust on accept()
    # (silent EMFILE — no crash, just refused connections). Hard limit is
    # unlimited; this is free insurance on every platform.
    ulimit -n 65536 2>/dev/null || true
    # Worker-count cap (the count itself is computed below, after the suite
    # lock): 6 on darwin, 8 elsewhere. PAR=8 on the 24-core darwin host (rasam)
    # maximizes throughput but its higher concurrent load pressures the
    # slow-hydration tail — under load a handful of interaction waits
    # (per-terminal Code-tab history enablement, content settle) intermittently
    # miss their POLL budget and a scenario loses all its retries, which is
    # fatal to a *consecutive*-green requirement. PAR=6 trades part of the
    # speed win for markedly fewer load-correlated races (the report's PAR=6
    # hardened runs were 0/3 catastrophic). Linux's watch/render stack is
    # reliable, so it keeps 8. Past the cap the slowest-scenario tail dominates
    # anyway (PAR=12 measured *slower* than PAR=8 on a 24-core host). See
    # docs/ci-e2e-macos-ralph-report.md.
    cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
    cap=8; [ "$(uname)" = Darwin ] && cap=6
    KOLU_SERVER="${KOLU_SERVER:-$(nix build .#koluBin --no-link --print-out-paths)/bin/kolu}"
    cd packages/tests
    # Serialize the cucumber phase across CI runs sharing this host. odu fans
    # each PR's pipeline out independently, so several PRs' e2e lanes land on
    # rasam concurrently (observed: 3 suites = 18 servers + 18 Chromiums on
    # ~7 free cores; every lane took 41-60 min instead of one finishing in
    # minutes). The koluBin build above stays outside the lock — Nix store
    # locking already dedups concurrent builds. mkdir is the portable atomic
    # primitive (no flock(1) on darwin); a dead owner pid means a crashed run,
    # so the lock is stolen rather than waited on. After max-wait we proceed
    # unlocked — degraded mode is exactly today's behavior, never a deadlock.
    # KOLU_E2E_LOCK=0 opts out (e.g. deliberate side-by-side local runs).
    lock=/tmp/kolu-e2e-suite.lock
    if [ "${KOLU_E2E_LOCK:-1}" != 0 ]; then
        deadline=$(( $(date +%s) + 3600 ))
        until mkdir "$lock" 2>/dev/null; do
            owner="$(cat "$lock/pid" 2>/dev/null || true)"
            if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
                echo "e2e-lock: stealing lock from dead pid $owner"
                rm -rf "$lock"
                continue
            fi
            if [ "$(date +%s)" -ge "$deadline" ]; then
                echo "e2e-lock: waited 60m on pid ${owner:-?}; proceeding unlocked"
                lock=""
                break
            fi
            echo "e2e-lock: another suite holds $lock (pid ${owner:-?}); waiting..."
            sleep 15
        done
        if [ -n "$lock" ]; then
            echo "$$" > "$lock/pid"
            trap 'rm -rf "$lock"' EXIT
        fi
    fi
    # Budget workers from *free* cores, not hardware cores — sampled AFTER the
    # lock, so a queued run sizes itself from the load left once the previous
    # suite is done, not from the load that suite was generating. The darwin CI
    # host (rasam) is shared with vira's frequent multi-hour GHC builds (~16
    # cores), so cores/3 sized for the hardware overcommits the leftover ~2x and the
    # suite thrashes (33+ min vs ~3 min idle — see the 2026-06 follow-up in
    # docs/ci-e2e-macos-ralph-report.md). Subtracting the 1-min load average is
    # a no-op on an idle host ((24-~0)/3 still hits the cap) and degrades toward
    # the floor only under real external load. Floor 4 = the setting CI ran
    # stably on for months, never lower.
    load="$(uptime | sed 's/.*load average[s]*: *//' | awk -F'[, ]' '{print int($1)}')"
    free=$(( cores - ${load:-0} ))
    par=$(( free / 3 ))
    if (( par < 4 )); then par=4; fi
    if (( par > cap )); then par=$cap; fi
    par="${CUCUMBER_PARALLEL:-$par}"
    # Fail loud on a non-numeric worker count: cucumber.js drops a NaN
    # `parallel` silently and runs the whole suite SERIAL — a ~5x slowdown
    # that looks green (this exact bug shipped as the literal string "cap").
    case "$par" in *[!0-9]*|'') echo "e2e: invalid worker count '$par'" >&2; exit 1;; esac
    echo "e2e: workers=$par (cores=$cores load=$load cap=$cap)"
    # No `pnpm install` here: the `install` dep (and, in CI, the ci::install
    # node) already installed the whole workspace, packages/tests included. A
    # second `pnpm install` re-links the shared workspace `node_modules/.bin`,
    # and running concurrently with the `unit` lane's `vitest` it transiently
    # makes `.bin/vitest` non-executable → "Permission denied" (exit 126) — the
    # very "two recipes shelling out to pnpm install race and corrupt each
    # other's node_modules" hazard ci/mod.just documents. CI invokes this recipe
    # with `just --no-deps test` so even the `install` dep can't race the unit lane.
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL="$par" {{ nix_shell_e2e }} pnpm test

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

# Capture marketing screencasts (KOLU_X11CAP): headful Chrome at 2x under Xvfb,
# grabbed by `ffmpeg -f x11grab`, transcoded into website/public/demo/. Per do.md
# this is meant to run on a pu box. Layers the screencast nix deps (ffmpeg-full +
# Xvfb, from packages/tests/screencast/shell.nix) onto the e2e shell — the
# top-level flake devShells are untouched.
#   just record                       # all recordings
#   just record new-terminal-demo     # one recording, by name
record name="": install
    #!/usr/bin/env bash
    set -euo pipefail
    {{ nix_shell_e2e }} pnpm --filter kolu-client build
    wrapper="$(mktemp)"
    trap 'rm -f "$wrapper"' EXIT
    cat > "$wrapper" <<SCRIPT
    #!/bin/sh
    KOLU_CLIENT_DIST="$PWD/packages/client/dist" exec tsx "$PWD/packages/server/src/index.ts" --allow-nix-shell-with-env-whitelist default "\$@"
    SCRIPT
    chmod +x "$wrapper"
    name_filter=""
    [ -n "{{ name }}" ] && name_filter="--name {{ name }}"
    cd packages/tests
    {{ nix_shell_e2e }} pnpm install
    KOLU_SERVER="$wrapper" KOLU_X11CAP=1 CUCUMBER_PARALLEL=1 \
        {{ nix_shell_e2e }} nix-shell screencast/shell.nix --run \
        "node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber-js --profile ui features/recordings.feature $name_filter"

# Boot the packaged Kolu and verify /api/health — production-like runtime smoke
smoke:
    {{ nix_shell }} bash ci/smoke.sh

# Remove all gitignored files (node_modules, build artifacts, etc.)
clean:
    git clean -fdX

# Format all files in-place
fmt: install
    {{ nix_shell }} sh -c 'biome format --write . && nixpkgs-fmt *.nix nix/**/*.nix website/*.nix'

# Check formatting without modifying files (used by CI)
fmt-check: install
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check *.nix nix/**/*.nix website/*.nix'

# Nix build (server + client) — prints store path, no ./result symlink
build:
    nix build --no-link --print-out-paths

# Run the combined server+client binary
run:
    nix run
