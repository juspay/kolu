# Prefix for commands that need a Nix devshell; empty if already inside one.

# Use git+file:// (default) instead of path: — path: disables the eval cache
# and re-copies/re-evaluates on every invocation (~4200ms vs ~130ms hot).
# Caveat: new .nix files must be `git add`ed before nix develop sees them.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop ' + justfile_directory() + ' --accept-flake-config -c' }
nix_format_paths := '*.nix nix/**/*.nix packages/*/nix/*.nix website/*.nix ci/flake.nix packages/surface/example/flake.nix packages/solid-browser/example/flake.nix'
# E2e shell includes Playwright browsers (not in default shell for perf).
# Check PLAYWRIGHT_BROWSERS_PATH, not IN_NIX_SHELL — the default shell sets
# IN_NIX_SHELL but doesn't provide browsers, so `just ci::e2e` (which runs
# inside the default shell) must still enter .#e2e to get them.
nix_shell_e2e := if env('PLAYWRIGHT_BROWSERS_PATH', '') != '' { '' } else { 'nix develop ' + justfile_directory() + '#e2e --accept-flake-config -c' }

cucumber_parallel := env('CUCUMBER_PARALLEL', '4')

# osfacts-client is a workspace member kolu does not own: it is grafted from the
# npins `osfacts` pin (`_materialize-osfacts-client`), so its tests and typecheck
# are that repo's CI's job — and its fixtures resolve against ITS repo root, not
# kolu's. Every `pnpm -r` here must skip it. The root package.json's `typecheck`
# and `test:unit` scripts carry the same filter for callers that enter through
# pnpm instead of just (the Nix typecheck derivation).
pnpm_vendored_filter := '--filter=!osfacts-client'

# SURFACE_AGENT_FLAKE_REF: the production koluBin wrapper bakes the exact agent
# source tree so a remote dial can resolve padi for the host's arch. A run from
# source has no wrapper, so it sources the SAME (name, value) set Nix builds the
# wrapper's `--set` args from (`default.nix`'s `agentBakedEnv`) — one definition,
# no parallel path. Kept as ONE snippet because both working-tree entrypoints
# need it — `dev` before its parallel fork, and the standalone `server` — and
# `ci::agent-bake` runs this exact string to prove it still exports (#2039).
#
# Two entrypoints bake, not one, because `_dev-parallel` must stay nix-free:
# ci::dev-smoke enters there (packages/tests/devSmoke.ts) and has no `nix` dep.
# So `dev` bakes once in its sequential body and forks `_server-raw`, while the
# standalone `server` bakes for itself. Nothing bakes twice.
agent_bake := 'set -a; . "$(nix build --no-link --print-out-paths --accept-flake-config .#agent-flake-env)"; set +a'

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
install: _materialize-osfacts-client
    {{ nix_shell }} pnpm install

# Graft osfacts-client into the tree from the npins `osfacts` pin.
#
# `osfacts-client` is a pnpm workspace member with no copy in this repo — the
# client lives in juspay/osfacts and nothing here may duplicate it. Nix does
# this graft for a build (nix/workspace.nix); this recipe is the working-tree
# twin, so `just install`, `just dev`, and a bare vitest run all read the same
# pinned bytes. Re-copied every time: the pin is the truth, the directory is
# a cache of it, and a stale cache is the one failure this must not have.
[private]
_materialize-osfacts-client:
    #!/usr/bin/env bash
    set -euo pipefail
    src="$(nix eval --impure --raw --expr 'toString ((import ./npins).osfacts + "/client-ts")')"
    rm -rf osfacts-client
    cp -r "$src" osfacts-client
    chmod -R u+w osfacts-client
    echo "osfacts-client ← $src"

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
    # Baked here, before the fork, for the same reason the ports are — see
    # `agent_bake` above. Resolved ONCE, and node --watch restarts inherit it,
    # so restart to pick up an agent-tree edit; Nix reads the git-TRACKED tree,
    # so a new file must be `git add`ed before a dialed remote sees it.
    {{ agent_bake }}
    echo "→ server http://localhost:${KOLU_DEV_SERVER_PORT:-7681}"
    echo "→ client http://localhost:${KOLU_DEV_CLIENT_PORT:-5173}"
    echo "→ agent source baked (restart to pick up an agent-tree edit)"
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

# Default slot = bare `just dev`; pass a port for `just dev PORT …` (e.g. 7780).
# Shared across worktrees on the same slot — clears a foreign holder so the next
# `just dev` spawns a padi from THIS tree. Never touches production.
# Kill padi/kaval for a `just dev` slot and wipe its state dir.
dev-clean SERVER_PORT="":
    #!/usr/bin/env bash
    set -euo pipefail
    runtime="${XDG_RUNTIME_DIR:-/tmp}"
    slot="${KOLU_DEV_SERVER_PORT:-{{ SERVER_PORT }}}"
    slot="${slot:-default}"
    dev_dir="$runtime/kolu-dev-$slot"
    # Match padiDigest(): sha256 of path.resolve(stateRoot), first 16 hex chars.
    # realpath -m keeps a stable absolute path even if the dir is already gone.
    state_root="$(realpath -m "$dev_dir/padi-state")"
    digest="$(printf '%s' "$state_root" | sha256sum | cut -c1-16)"
    padi_rt="$runtime/padi-$digest"
    kaval_rt="$runtime/kaval-$digest"

    kill_pidfile() {
      local f="$1" label="$2"
      if [ ! -f "$f" ]; then
        return 0
      fi
      local pid
      pid="$(tr -d '[:space:]' <"$f" || true)"
      if [ -z "$pid" ] || ! [[ "$pid" =~ ^[0-9]+$ ]]; then
        echo "dev-clean: ignore junk $label pidfile $f"
        return 0
      fi
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "dev-clean: $label pid $pid already dead"
        return 0
      fi
      # Safety: only kill if the runtime dir's state-root manifest (when present)
      # still names THIS state root — never a production / foreign digest collision.
      local manifest
      manifest="$(dirname "$f")/state-root"
      if [ -f "$manifest" ]; then
        local claimed
        claimed="$(tr -d '[:space:]' <"$manifest" || true)"
        if [ -n "$claimed" ] && [ "$claimed" != "$state_root" ]; then
          echo "dev-clean: REFUSING to kill $label pid $pid — $manifest claims $claimed (expected $state_root)" >&2
          return 1
        fi
      fi
      echo "dev-clean: SIGTERM $label pid $pid"
      kill -TERM "$pid" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.1
      done
      if kill -0 "$pid" 2>/dev/null; then
        echo "dev-clean: SIGKILL $label pid $pid"
        kill -KILL "$pid" 2>/dev/null || true
      fi
    }

    echo "dev-clean: slot=$slot state-root=$state_root digest=$digest"
    # Order: padi first (it owns/supervises kaval), then kaval, then dirs.
    kill_pidfile "$padi_rt/supervisor.pid" "padi-supervisor" || true
    kill_pidfile "$padi_rt/padi.pid" "padi" || true
    kill_pidfile "$kaval_rt/kaval.pid" "kaval" || true

    for dir in "$padi_rt" "$kaval_rt" "$dev_dir"; do
      if [ -e "$dir" ]; then
        echo "dev-clean: rm -rf $dir"
        rm -rf "$dir"
      fi
    done
    echo "dev-clean: done — next bare \`just dev\` will spawn a fresh padi for this worktree"

[private]
_dev: install _dev-parallel

[private]
[parallel]
_dev-parallel: _server-raw client

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
# KOLU_PADI_STATE_DIR isolates this dev instance's PADI state root the same way:
# without it, dev would share the default `~/.local/state/padi` with production,
# and the P0 supervisor gate (one supervisor per padi state root) would refuse to
# boot beside a live `kolu.service` (its padi is already supervised). A per-port
# dev state root gives each dev instance its OWN padi to supervise — the local
# twin of the KOLU_REMOTE_PADI_STATE_DIR isolation the remote arm uses.
#
# Bakes: `just server` + `just client` in two terminals is a standalone way to
# run the stack, and without it that pair hits the same "missing its agent
# source" wall `just dev` used to. `dev` forks `_server-raw`, not this.
server:
    #!/usr/bin/env bash
    set -euo pipefail
    {{ agent_bake }}
    just --no-deps _server-raw

# The server without the bake — `_dev-parallel`'s nix-free half. Never a
# standalone entrypoint; use `just server`.
[private]
_server-raw:
    {{ nix_shell }} bash -c 'd="${XDG_RUNTIME_DIR:-/tmp}/kolu-dev-${KOLU_DEV_SERVER_PORT:-default}"; mkdir -p "$d/padi-state" && chmod 700 "$d"; cd packages/kolu-cli && KOLU_KAVAL_SOCKET="$d/pty-host.sock" KOLU_PADI_STATE_DIR="$d/padi-state" pnpm dev ${KOLU_DEV_SERVER_PORT:+--port $KOLU_DEV_SERVER_PORT}'

# Assert the working-tree agent bake still reaches a child process — the
# regression guard for #2039. `ci::nix` proves `.#agent-flake-env` BUILDS; only
# this proves the handoff that consumes it works, so the original bug cannot
# return with every node green. Two halves, because either alone is green while
# the bug is back: the snippet must export, AND the entrypoints must still run
# it. Nothing here re-spells a variable name or the snippet — both are read back
# from what the bake actually did, which is the point of the whole change.
test-agent-bake:
    #!/usr/bin/env bash
    set -euo pipefail
    # What the bake newly EXPORTS or CHANGES, measured rather than parsed out of
    # the file, so this stays correct however `toShellVars` quotes a value and
    # however many pairs `agentBakedEnv` grows. NAME=value pairs, not just names:
    # this recipe can run in a shell that already exports SURFACE_AGENT_FLAKE_REF
    # from a parent, and a name-only diff would see no new name and wrongly
    # report "exported nothing" when the bake had in fact overwritten the value.
    #
    # `env`, not bash's `compgen -e`: compgen is unavailable in the shell CI's
    # darwin lane runs this under (`compgen: command not found`, run a793809#1),
    # and `env` is the more honest instrument anyway — it prints the environment
    # a child is handed, which is exactly the property under test. The filter
    # drops continuation lines of any multi-line value.
    snapshot() { env | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | sort; }
    before=$(snapshot)
    {{ agent_bake }}
    exported=$(comm -13 <(printf '%s\n' "$before") <(snapshot) | cut -d= -f1 | sort -u)
    [[ -n "$exported" ]] || { echo "agent-bake: the bake exported nothing" >&2; exit 1; }

    # Confirm each one reaches a CHILD — a child is what `_server-raw` and
    # `client` are, and it is the half `set -a` provides. (Checking in THIS
    # shell would pass on an unexported variable and miss `set -a` going away.)
    while read -r name; do
      value=$(bash -c 'printenv "$1"' _ "$name") \
        || { echo "agent-bake: $name never reached a child process" >&2; exit 1; }
      echo "agent-bake: $name → $value"
    done <<< "$exported"

    # A working snippet no entrypoint calls is still the bug. `--dry-run` expands
    # a recipe without running it; match the WHOLE expanded line against the
    # `agent_bake` variable itself, so a line that merely mentions the
    # derivation — a bare `nix build .#agent-flake-env` that sources nothing —
    # does not count. The expectation is never re-spelled here: it comes from the
    # same variable the entrypoints interpolate, so editing the snippet moves the
    # guard with it.
    expected={{ quote(agent_bake) }}
    check_bakes() {
      local recipe="$1" want="$2" out found
      # A dry-run that FAILS must not read as "zero bakes" — that is how an
      # unexpandable recipe would sail through the zero-bake assertion below.
      if ! out=$(just --dry-run "$recipe" 2>&1); then
        echo "agent-bake: \`just --dry-run $recipe\` failed:" >&2
        printf '%s\n' "$out" >&2
        return 1
      fi
      # `|| true` here covers ONLY grep's no-match exit, which is a real count of 0.
      found=$(printf '%s\n' "$out" | grep -Fxc -- "$expected" || true)
      [[ "$found" == "$want" ]] || {
        echo "agent-bake: \`just $recipe\` expands to $found bake line(s), want $want" >&2
        return 1
      }
    }
    check_bakes dev 1
    check_bakes server 1
    check_bakes _dev-parallel 0
    echo "agent-bake: dev + server bake once each; _dev-parallel does not bake"

# Run client with Vite dev server (HMR)
client:
    cd packages/client && {{ nix_shell }} pnpm dev

# Run unit tests (vitest) — FORK-FREE by default and bounded to one workspace
# package at a time. The daemon-forking suites are gated OFF (`describeDaemon`
# keys on KOLU_DAEMON_TESTS); this is the safe reach a workstation can run beside
# a live kolu. Use `test-daemon` for the gated suites.
test-unit: install
    {{ nix_shell }} pnpm -r {{ pnpm_vendored_filter }} --workspace-concurrency=1 test:unit

# Enforce the append-only E2E scenario inventory and coverage ledger. This is
# deliberately separate from test-unit: it reads every committed inventory
# reachable from HEAD to prove old records were not edited or removed later.
test-e2e-governance: install
    cd packages/tests && {{ nix_shell }} pnpm test:governance

# CI/pu-ONLY: the daemon-forking unit suites (KOLU_DAEMON_TESTS=1). These fork real
# kaval/padi daemons + PTYs; a bare run on a workstation OOM-reaped the production
# kaval (juspay/kolu#1375). NEVER run this on a machine hosting a live kolu — it
# belongs on CI or a `pu` box. Leash (Q4 — reuse the shipped run-bind, no new
# rlimit): KOLU_DAEMON_BIND_PID binds every spawned daemon's lifetime to THIS run so
# none can leak past it (the 182-leaked-dirs state becomes unrepresentable), and
# `--workspace-concurrency=1` runs one package's suite at a time so a fork storm
# can't pile up across packages. `test-unit` stays the fork-free default.
test-daemon: install
    KOLU_DAEMON_TESTS=1 KOLU_DAEMON_BIND_PID=$$ {{ nix_shell }} pnpm -r {{ pnpm_vendored_filter }} --workspace-concurrency=1 test:unit

# W3.1 ssh-leg e2e — bind padiSurface over a REAL ssh hop, round-trip a terminal,
# bench typing-echo latency, and prove drain->converge. TURNKEY on a `pu` box: with no
# arg it auto-picks the box's own non-loopback 10.x IPv4 (a real ssh hop to its OWN
# sshd — NOT loopback, which the test refuses as a false green); pass an explicit host
# to override. This is the ONLY enforced run of `remotePadiSsh.test.ts` — CI has NO ssh
# lane (no sshd in the build sandbox), so the ssh leg is exercised HERE, on a box, and
# its transcript is W3.1's recorded evidence. See the test header for the full contract.
# DESTRUCTIVE: it killAll's + drains the padi on the target host — its terminals die. The
# test REFUSES without KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 (a conscious "this host is disposable"
# so a mistyped host can't murder a workstation).
#   KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 just e2e-ssh                 # auto-detect this box's IP
#   KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 just e2e-ssh 10.47.48.150    # explicit ssh host/alias
e2e-ssh host='': install
    #!/usr/bin/env bash
    set -euo pipefail
    host="{{ host }}"
    if [ -z "$host" ]; then
        host=$(ip -4 -o addr show scope global 2>/dev/null | grep -oE 'inet 10\.[0-9.]+' | awk '{print $2}' | head -1)
        [ -n "$host" ] || { echo "e2e-ssh: no non-loopback 10.x IPv4 found — pass one explicitly: just e2e-ssh <host>" >&2; exit 1; }
    fi
    system=$(nix eval --impure --raw --expr builtins.currentSystem)
    drv=$(nix eval --raw --accept-flake-config ".#packages.$system.padi.drvPath")
    echo "e2e-ssh: host=$host system=$system padi-drv=$drv"
    cd packages/server && KOLU_E2E_SSH_HOST="$host" KOLU_E2E_PADI_DRV="$drv" \
        KOLU_STATE_DIR="${TMPDIR:-/tmp}/kolu-e2e-ssh-$$/state" \
        {{ nix_shell }} pnpm exec vitest run --fileParallelism=false src/padi/remotePadiSsh.test.ts

# W3.1 ssh-leg e2e — TWO-BOX arm. `e2e-ssh` self-ssh's to the box's OWN padi (a real hop,
# but the "remote" host == this machine). This second recipe binds to a GENUINELY-DIFFERENT
# host (removing the self-ssh confound), and adds the FINDING-1 coverage the padi-only ssh
# lane can't reach: it stands up a FULL kolu-server bound to <boxB> and asserts the
# koluSurface `daemonInventory` publishes `boundHost=<boxB>` + a populated `boundPadi`
# (the bound padi's honest hello identity) — the enforced twin of the manual two-box repro
# (the dialog labels this-machine's scan "not the bound host" and reads the padi identity
# from `boundPadi`, not the local `active` row). Run on a `pu` box that can ssh to <boxB>.
# DESTRUCTIVE (killAll's + drains <boxB>'s padi) — requires KOLU_E2E_SSH_DESTRUCTIVE_ACK=1.
#   KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 just e2e-ssh-2box nix@boxB   # <boxB> = a different ssh host
e2e-ssh-2box boxB port='7099': install
    #!/usr/bin/env bash
    set -euo pipefail
    boxB="{{ boxB }}"; port="{{ port }}"
    [ "${KOLU_E2E_SSH_DESTRUCTIVE_ACK:-}" = "1" ] || { echo "e2e-ssh-2box: REFUSING — DESTRUCTIVE against '$boxB': it will killAll + DRAIN (persist+exit, build-swap) that host's padi, KILLING its live terminals. Set KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 ONLY if '$boxB' is a disposable test host, never a workstation." >&2; exit 1; }
    # 1) the ssh-transport lane (round-trip · latency · drain-converge) against the
    #    genuinely-different host — self-ssh confound removed. KOLU_E2E_SSH_TWO_BOX=1 skips
    #    the self-ssh-ONLY agent-state test (its local /proc + $HOME fixtures can't match a
    #    padi on the OTHER host; that test runs under `just e2e-ssh` self-ssh).
    KOLU_E2E_SSH_TWO_BOX=1 just e2e-ssh "$boxB"
    # 2) FINDING 1 over ssh: a full kolu-server bound to <boxB> must publish boundHost + boundPadi.
    sr="${TMPDIR:-/tmp}/kolu-2box-$$/state"; log="${TMPDIR:-/tmp}/kolu-2box-$$.log"
    echo "e2e-ssh-2box: standing up kolu-server (KOLU_PADI_HOST=$boxB) on :$port"
    # Isolate the LOCAL padi state root so this full-boot server's P0 supervisor gate
    # never collides with any other kolu on the box. NOT KOLU_REMOTE_PADI_STATE_DIR:
    # this recipe DELIBERATELY binds (and drains) <boxB>'s REAL padi — isolating the
    # remote would spawn a fresh padi there instead of exercising the live one.
    KOLU_STATE_DIR="$sr" KOLU_PADI_STATE_DIR="$sr/padi" KOLU_PADI_HOST="$boxB" {{ nix_shell }} nix run .#koluBin -- web --port "$port" >"$log" 2>&1 &
    srv=$!; trap 'kill $srv 2>/dev/null || true' EXIT
    # Readiness gate = the daemonInventory read itself (a subscription; grep -m1 = first
    # frame), NON-destructive, polled until the ssh binding has warmed enough to publish
    # the bound padi's identity. (A killAll probe would be destructive AND its input schema
    # is `void` — an object payload 400s, so it never gates.)
    # Parse the frame with python (robust — no JSON-key-order assumption, no unescaped-$boxB
    # regex brittleness): boundPadi.surfaceVersion populated = the ssh binding warmed.
    frame=""
    for i in $(seq 1 120); do
        frame=$(timeout 12 curl -s -N --max-time 10 -X POST "http://127.0.0.1:$port/rpc/surface/kolu/daemonInventory/get" \
            -H 'content-type: application/json' -d '{"json":{}}' 2>/dev/null | grep -m1 '^data:' | sed 's/^data: //' || true)
        python3 -c "import json,sys; p=(json.loads(sys.argv[1] or '{}').get('json',{}).get('boundPadi') or {}); sys.exit(0 if p.get('surfaceVersion') else 1)" "$frame" && break
        sleep 1
    done
    echo "daemonInventory (bound to $boxB): $frame"
    # Single-line python (avoids heredoc-dedent issues in a just recipe): assert boundHost and
    # boundPadi.surfaceVersion off the PARSED JSON, not a key-order-fragile / unescaped-regex grep.
    python3 -c 'import json,sys; d=json.loads(sys.argv[2] or "{}").get("json",{}); p=d.get("boundPadi") or {}; (print("e2e-ssh-2box: PASS — boundHost="+str(d.get("boundHost"))+", boundPadi.surfaceVersion="+str(p.get("surfaceVersion"))+" over the genuinely-remote binding") if d.get("boundHost")==sys.argv[1] and p.get("surfaceVersion") else sys.exit("FAIL: boundHost="+repr(d.get("boundHost"))+" (expected "+repr(sys.argv[1])+"), boundPadi.surfaceVersion="+repr(p.get("surfaceVersion"))))' "$boxB" "$frame"

# F4 (juspay/kolu#2101) — the REMOTE upgrade-window e2e. Leaves a REAL previous-release
# padi resident on <host>, then dials that host with the CURRENT build through the real
# `sshConnector`/`makeSession` stack and asserts the acceptance criterion that inverts the
# incident: ONE takeover and ONE clean converge, NOT a loop. The pre-fix behaviour was a
# 10s-per-attempt retry-forever, so the suite asserts the negative (no terminal verdict,
# one campaign, bounded wall clock) as loudly as the positive.
#
# Resolves the latest vX.Y.Z release tag the same way `ci::upgrade-window` does
# (`git ls-remote --tags` on the configured remotes, then the known GitHub URL), builds
# that tag's `#padi` AND the current `#padi`, REFUSES an identical pair (a same-version
# collapse would green-wash the window), and nix-copies the previous closure to <host>.
#
# The copy is `--no-check-sigs`, so the ssh user must be in the REMOTE nix daemon's
# `trusted-users` (root is, on a stock pu box) — verify with
# `ssh <host> nix show-config | grep trusted-users` before blaming the code.
#
# CI has NO ssh lane (no sshd in the build sandbox), so THIS recipe is the only enforced
# run of the remote upgrade window — deliberately, and stated here and in the suite header
# so the coverage cap is never silent.
#
# DESTRUCTIVE: it spawns and reaps padi daemons on <host>. It works in a run-unique
# state root (so it cannot touch a production padi's rendezvous), but the ack is still
# required so a mistyped host can't have daemons spawned on it.
#   KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 just e2e-ssh-upgrade root@kolu-f4-upgrade
e2e-ssh-upgrade host: install
    #!/usr/bin/env bash
    set -euo pipefail
    host="{{ host }}"
    [ "${KOLU_E2E_SSH_DESTRUCTIVE_ACK:-}" = "1" ] || { echo "e2e-ssh-upgrade: REFUSING — DESTRUCTIVE against '$host': it spawns and REAPS padi daemons there. Set KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 ONLY if '$host' is a disposable test host (a pu box), never a workstation." >&2; exit 1; }
    # Latest vX.Y.Z across configured remotes, then the known GitHub URL — the same
    # resolution `ci::upgrade-window` uses, for the same reason: a CI checkout is
    # SHA-only and often has no local tags, and the old "last padi-touching rev"
    # fallback built a padi IDENTICAL to current, collapsing the window.
    latest_version_tag() {
      git ls-remote --tags --refs "$1" 2>/dev/null \
        | awk '{print $2}' | sed 's|refs/tags/||' \
        | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true
    }
    candidates=()
    while IFS= read -r r; do
      [ -n "$r" ] || continue
      u="$(git remote get-url "$r" 2>/dev/null || true)"
      [ -n "$u" ] && candidates+=("$u")
    done < <(git remote 2>/dev/null || true)
    candidates+=("https://github.com/juspay/kolu" "https://github.com/juspay/kolu.git")
    ref=""
    for url in "${candidates[@]}"; do
      echo "e2e-ssh-upgrade: probing tags at ${url}"
      t="$(latest_version_tag "$url")"
      if [[ "${t}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then ref="$t"; break; fi
    done
    [[ "${ref}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "e2e-ssh-upgrade: REFUSING — no version tag (vX.Y.Z) via ls-remote; there is no previous release to open a window against" >&2; exit 1; }
    echo "e2e-ssh-upgrade: previous ref=${ref}"
    # `github:` (not `git+file://${PWD}?ref=`) so the build works from a SHALLOW clone
    # and from a git worktree, neither of which nix's local-git fetcher accepts.
    prev_store="$(nix build --no-link --print-out-paths --accept-flake-config "github:juspay/kolu/${ref}#padi")"
    curr_store="$(nix build --no-link --print-out-paths --accept-flake-config ".#padi")"
    echo "e2e-ssh-upgrade: previous padi store=${prev_store}"
    echo "e2e-ssh-upgrade: current  padi store=${curr_store}"
    if [ "${prev_store}" = "${curr_store}" ]; then
      echo "e2e-ssh-upgrade: REFUSING — previous padi store path equals current (${prev_store}); the mixed-version window collapsed to a same-version recycle" >&2
      exit 1
    fi
    echo "e2e-ssh-upgrade: store paths differ — the window is real"
    # The PREVIOUS closure is planted by this recipe (the test only starts it). The
    # CURRENT one is provisioned by the connector itself, over the real dial, which is
    # part of what the suite exercises.
    echo "e2e-ssh-upgrade: copying the previous closure to ${host} (--no-check-sigs; needs the ssh user in the remote trusted-users)"
    nix copy --to "ssh://${host}" --no-check-sigs "${prev_store}"
    system=$(nix eval --impure --raw --expr builtins.currentSystem)
    drv=$(nix eval --raw --accept-flake-config ".#packages.$system.padi.drvPath")
    # `--reporter=verbose --disableConsoleIntercept`: this suite's narration (the
    # front's own convergence lines — classification, SIGTERM, fresh spawn, the
    # phase walk) IS the evidence a human runs this for, and the default reporter
    # swallows console output for a PASSING test. A green tick that prints nothing
    # cannot be pasted into a disposition, so the run always speaks.
    cd packages/server && KOLU_E2E_SSH_HOST="$host" KOLU_E2E_PADI_DRV="$drv" \
        KOLU_E2E_PREVIOUS_PADI_STORE="$prev_store" \
        KOLU_E2E_PREVIOUS_PADI_REF="$ref" \
        KOLU_E2E_CURRENT_PADI_STORE="$curr_store" \
        KOLU_STATE_DIR="${TMPDIR:-/tmp}/kolu-e2e-ssh-upgrade-$$/state" \
        {{ nix_shell }} pnpm exec vitest run --fileParallelism=false \
        --reporter=verbose --disableConsoleIntercept \
        src/padi/remotePadiSshUpgradeWindow.test.ts

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
    # The "no Cucumber verdict" on linux was odu log truncation (pretty
    # formatter), not a killed suite — 1 worker finished 514 scenarios in
    # 38m. 4 is back now that daemon no longer overlaps and CI logs are
    # progress-only.
    cap=4; [ "$(uname)" = Darwin ] && cap=4
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
    # The odu venue pool leases each CI host exclusively, so external load is
    # not an input to capacity. Size deterministically from hardware: roughly
    # one browser+server+padi+kaval world per three online cores, rounding up
    # so a dedicated 10-core venue uses four workers instead of leaving the
    # remainder idle. Clamp by the measured platform cap above and a minimum of
    # one. In particular, never sample the one-minute load average here: it
    # trails the Nix build that runs before Cucumber and made an idle 10-core
    # venue start just one worker.
    par=$(( (cores + 2) / 3 ))
    if (( par < 1 )); then par=1; fi
    if (( par > cap )); then par=$cap; fi
    echo "e2e: workers=$par (cores=$cores cap=$cap)"
    # No `pnpm install` here: the `install` dep (and, in CI, the ci::install
    # node) already installed the whole workspace, packages/tests included. A
    # second `pnpm install` re-links the shared workspace `node_modules/.bin`,
    # and running concurrently with the `unit` lane's `vitest` it transiently
    # makes `.bin/vitest` non-executable → "Permission denied" (exit 126) — the
    # very "two recipes shelling out to pnpm install race and corrupt each
    # other's node_modules" hazard ci/mod.just documents. CI invokes this recipe
    # with `just --no-deps test` so even the `install` dep can't race the unit lane.
    set +e
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL="$par" {{ nix_shell_e2e }} pnpm test
    status=$?
    set -e
    # odu's linux log capture can drop the node process's last write.
    # Re-print the compact verdict from the on-disk timing file AFTER
    # pnpm returns, so the fail list is in the captured recipe output.
    if [ -f reports/e2e-timing.json ]; then
        {{ nix_shell_e2e }} node --import tsx -e '
          import { readFileSync } from "node:fs";
          import { formatE2eVerdict } from "./governance/timing.ts";
          const report = JSON.parse(readFileSync("reports/e2e-timing.json", "utf8"));
          process.stdout.write(`${formatE2eVerdict(report)}\n`);
        '
    fi
    exit "$status"

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
    # Without nix build there's no `kolu` binary, so the checked-in source
    # wrapper (shared with `record`) stands in: it sets KOLU_CLIENT_DIST and
    # execs tsx on the kolu-cli entry, what the nix-built binary does.
    wrapper="$PWD/scripts/kolu-source-wrapper.sh"
    cd packages/tests
    {{ nix_shell_e2e }} pnpm install
    KOLU_SERVER="$wrapper" CUCUMBER_PARALLEL={{ cucumber_parallel }} \
        {{ nix_shell_e2e }} pnpm test {{ args }}

# Dev-mode smoke: boot `just dev` on random ports, load Kolu in a real browser,
# fail on any console error. The ONLY check that exercises the DEV module graph
# — `just test` and `just test-quick` both run a production bundle, which is
# tree-shaken, and tree-shaking is exactly what hid kolu#2042 (a `node:fs`
# import reached through a package barrel: `nix build` green, dev server dead).
# See packages/tests/devSmoke.ts.
test-dev: install
    #!/usr/bin/env bash
    set -euo pipefail
    cd packages/tests
    {{ nix_shell_e2e }} pnpm test:dev-smoke

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
    # The checked-in source wrapper (shared with `test-quick`) stands in for
    # the nix-built `kolu` binary.
    wrapper="$PWD/scripts/kolu-source-wrapper.sh"
    name_filter=""
    [ -n "{{ name }}" ] && name_filter="--name {{ name }}"
    cd packages/tests
    {{ nix_shell_e2e }} pnpm install
    KOLU_SERVER="$wrapper" KOLU_X11CAP=1 CUCUMBER_PARALLEL=1 \
        {{ nix_shell_e2e }} nix-shell screencast/shell.nix --run \
        "node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber-js --profile ui features/recordings.feature $name_filter"

# Boot the packaged Kolu and verify /api/health — production-like runtime smoke
smoke:
    {{ nix_shell }} bash .apm/skills/ci/smoke.sh

# Typing-echo latency baseline (padi W1 / #1652). Boots a private nix-built
# kolu, measures keystroke→echo p50/p95/p99 over kolu-server's /rpc/ws, tears
# down. W2.2 re-runs this to prove < 5ms added p99. See the Atlas note
# `padi-latency-baseline`. Env: KOLU_BENCH_* (SAMPLES, TERMINALS, OUT, ...).
bench-typing-echo: install
    {{ nix_shell }} bash packages/server/bench/run.sh

# Remove all gitignored files (node_modules, build artifacts, etc.)
clean:
    git clean -fdX

# Format all files in-place
fmt: install
    {{ nix_shell }} sh -c 'biome format --write . && nixpkgs-fmt {{ nix_format_paths }}'

# Check formatting without modifying files (used by CI)
fmt-check: install _fmt-check

# Shared private formatting check used by the public `fmt-check` recipe.
[private]
_fmt-check:
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check {{ nix_format_paths }}'

# Nix build (server + client) — prints store path, no ./result symlink
build:
    nix build --no-link --print-out-paths

# Run the combined server+client binary
run:
    nix run
