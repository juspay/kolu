# Use git+file:// (default) instead of path: — path: disables the eval cache
# and re-copies/re-evaluates on every invocation (~4200ms vs ~130ms hot).
# Caveat: new .nix files must be `git add`ed before nix develop sees them.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop ' + justfile_directory() + ' --accept-flake-config -c' }
nix_format_paths := '*.nix nix/**/*.nix packages/*/nix/*.nix packages/*/adapter/*.nix website/*.nix ci/flake.nix packages/surface/example/flake.nix packages/solid-browser/example/flake.nix'
nix_shell_with_browsers := if env('PLAYWRIGHT_BROWSERS_PATH', '') != '' { '' } else { 'nix develop ' + justfile_directory() + '#e2e --accept-flake-config -c' }

cucumber_parallel := env('CUCUMBER_PARALLEL', '4')

pnpm_vendored_filter := '--filter=!osfacts-client --filter=!@odu/* --filter=!@juspay/*'

agent_bake := 'set -a; . "$(nix build --no-link --print-out-paths --accept-flake-config .#agent-flake-env)"; set +a'

mod ci 'ci/mod.just'
mod website 'website/mod.just'
mod atlas 'docs/atlas/mod.just'

# List available recipes
default:
    @just --list

# Prepare repo for development — install deps and cache so future workflows run faster
prepare: install

# Install pnpm dependencies
install: _materialize-pinned-members
    {{ nix_shell }} pnpm install

[private]
_materialize-pinned-members:
    #!/usr/bin/env bash
    set -euo pipefail
    rows=($({{ nix_shell }} jq -r '.members | to_entries[] | select(.value.pin) | "\(.key):\(.value.dir):\(.value.pin.name):\(.value.pin.subdir)"' nix/consumer-closure.json))
    for row in "${rows[@]}"; do
      IFS=: read -r member dest pin subdir <<<"$row"
      src="$(nix eval --impure --raw --expr "toString ((import ./npins).${pin} + \"/${subdir}\")")"
      rm -rf "$dest"
      mkdir -p "$(dirname "$dest")"
      cp -r "$src" "$dest"
      chmod -R u+w "$dest"
      got="$(sed -n 's/^ *"name": *"\([^"]*\)".*/\1/p' "$dest/package.json" | head -n 1)"
      if [ "$got" != "$member" ]; then
        echo "_materialize-pinned-members: $dest declares name '$got', expected '$member'" >&2
        exit 1
      fi
      echo "$member ← $src"
    done

# Run server + client in parallel — bare `just dev` keeps 7681/5173; pass ports for a second instance
dev SERVER_PORT="" CLIENT_PORT="":
    #!/usr/bin/env bash
    set -euo pipefail
    export KOLU_DEV_SERVER_PORT="{{ SERVER_PORT }}"
    export KOLU_DEV_CLIENT_PORT="{{ CLIENT_PORT }}"
    {{ agent_bake }}
    echo "→ server http://localhost:${KOLU_DEV_SERVER_PORT:-7681}"
    echo "→ client http://localhost:${KOLU_DEV_CLIENT_PORT:-5173}"
    echo "→ agent source baked (restart to pick up an agent-tree edit)"
    {{ nix_shell }} just _dev

# For agents / a second worktree that must not collide with a primary instance.
dev-auto:
    #!/usr/bin/env bash
    set -euo pipefail
    read -r SERVER_PORT CLIENT_PORT < <(nix shell nixpkgs#python3 --command python3 -c 'import socket; a=socket.socket(); a.bind(("",0)); b=socket.socket(); b.bind(("",0)); print(a.getsockname()[1], b.getsockname()[1]); a.close(); b.close()')
    # Positional args — `just dev NAME=VALUE` would bind the literal "NAME=VALUE"
    # to the param, not the value.
    exec just dev "$SERVER_PORT" "$CLIENT_PORT"

# Kill padi/kaval for a `just dev` slot and wipe its state dir.
dev-clean SERVER_PORT="":
    #!/usr/bin/env bash
    set -euo pipefail
    runtime="${XDG_RUNTIME_DIR:-/tmp}"
    slot="${KOLU_DEV_SERVER_PORT:-{{ SERVER_PORT }}}"
    slot="${slot:-default}"
    dev_dir="$runtime/kolu-dev-$slot"
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

# Run TypeScript type checking + Biome lint across all packages
check: install
    {{ nix_shell }} pnpm typecheck
    just --no-deps ci::biome

# Biome lint only — delegates to ci::biome, the single source of truth for the gate
lint: install
    just --no-deps ci::biome

# Run the server alone, with the agent source baked — pair it with `just client`
server:
    #!/usr/bin/env bash
    set -euo pipefail
    {{ agent_bake }}
    just --no-deps _server-raw

[private]
_server-raw:
    {{ nix_shell }} bash -c 'd="${XDG_RUNTIME_DIR:-/tmp}/kolu-dev-${KOLU_DEV_SERVER_PORT:-default}"; mkdir -p "$d/padi-state" && chmod 700 "$d"; cd packages/kolu-cli && KOLU_KAVAL_SOCKET="$d/pty-host.sock" KOLU_PADI_STATE_DIR="$d/padi-state" pnpm dev ${KOLU_DEV_SERVER_PORT:+--port $KOLU_DEV_SERVER_PORT}'

# Assert the working-tree agent bake still reaches a child process
test-agent-bake:
    #!/usr/bin/env bash
    set -euo pipefail
    # `env`, not bash's `compgen -e`: compgen is unavailable in the shell CI's
    # darwin lane runs this under (`compgen: command not found`, run a793809#1).
    # The filter drops continuation lines of any multi-line value.
    snapshot() { env | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | sort; }
    before=$(snapshot)
    {{ agent_bake }}
    exported=$(comm -13 <(printf '%s\n' "$before") <(snapshot) | cut -d= -f1 | sort -u)
    [[ -n "$exported" ]] || { echo "agent-bake: the bake exported nothing" >&2; exit 1; }

    while read -r name; do
      value=$(bash -c 'printenv "$1"' _ "$name") \
        || { echo "agent-bake: $name never reached a child process" >&2; exit 1; }
      echo "agent-bake: $name → $value"
    done <<< "$exported"

    expected={{ quote(agent_bake) }}
    check_bakes() {
      local recipe="$1" want="$2" out found
      if ! out=$(just --dry-run "$recipe" 2>&1); then
        echo "agent-bake: \`just --dry-run $recipe\` failed:" >&2
        printf '%s\n' "$out" >&2
        return 1
      fi
      found=$(printf '%s\n' "$out" | grep -Fxc -- "$expected" || true)
      [[ "$found" == "$want" ]] || {
        echo "agent-bake: \`just $recipe\` expands to $found bake line(s), want $want" >&2
        return 1
      }
    }
    check_bakes dev 1
    check_bakes server 1
    check_bakes test-dev 1
    check_bakes _dev-parallel 0
    echo "agent-bake: dev + server + test-dev bake once each; _dev-parallel does not bake"

# Run client with Vite dev server (HMR)
client:
    cd packages/client && {{ nix_shell }} pnpm dev

# Run the fork-free half of the workspace (vitest), one package at a time
test-unit: install
    {{ nix_shell }} pnpm -r {{ pnpm_vendored_filter }} --workspace-concurrency=1 test:unit
    {{ nix_shell }} python3 .github/actions/publish-closure/test-publish-closure.py

# Regenerate `nix/consumer-closure.json` from every manifest in the tree
emit-consumer-closure: install
    cd packages/tests && {{ nix_shell }} npx tsx ../../scripts/emit-consumer-closure.ts

# Enforce the append-only E2E scenario inventory and coverage ledger
test-e2e-governance: install
    cd packages/tests && {{ nix_shell }} pnpm test:governance

# End-of-run janitor — this run's CI-owned runtime roots and leftover ci daemons
_reap-ci-run:
    {{ nix_shell }} env KOLU_CI_REAP_ROOT="${KOLU_CI_REAP_ROOT:-${TMPDIR:-/tmp}}" node --experimental-strip-types {{ justfile_directory() }}/packages/daemon-test-gate/src/ciReap.cli.ts

# CI/pu-ONLY: the daemon-forking packages' suites (KOLU_DAEMON_TESTS=1) — forks real kaval/padi daemons
test-daemon: install
    #!/usr/bin/env bash
    set -euo pipefail
    # `pnpm -r … test:daemon --shard=…` — NOT `… test:daemon -- --shard=…`.
    # pnpm forwards a literal `--` into the script line, and vitest reads
    # everything after a bare `--` as a file filter, so the shard would be
    # silently ignored and every package would run whole (measured).
    shard_args=()
    if [[ -n "${ODU_SHARD_INDEX:-}" || -n "${ODU_SHARD_TOTAL:-}" ]]; then
        if [[ ! "${ODU_SHARD_INDEX:-}" =~ ^(0|[1-9][0-9]*)$ ]] \
            || [[ ! "${ODU_SHARD_TOTAL:-}" =~ ^[1-9][0-9]*$ ]] \
            || ((ODU_SHARD_INDEX >= ODU_SHARD_TOTAL)); then
            echo "test-daemon: invalid shard pair ODU_SHARD_INDEX='${ODU_SHARD_INDEX:-}' ODU_SHARD_TOTAL='${ODU_SHARD_TOTAL:-}'" >&2
            exit 2
        fi
        echo "test-daemon: shard=$((ODU_SHARD_INDEX + 1))/$ODU_SHARD_TOTAL (odu index=$ODU_SHARD_INDEX of $ODU_SHARD_TOTAL)"
        # vitest `--shard` is 1-based; odu's index is 0-based.
        shard_args=("--shard=$((ODU_SHARD_INDEX + 1))/$ODU_SHARD_TOTAL")
        if ((ODU_SHARD_TOTAL > 1)); then
            shard_args+=("--passWithNoTests")
        fi
    fi
    export KOLU_CI_REAP_BIND_PID=$$
    cleanup() {
        local st=$?
        if ! just _reap-ci-run; then
            if [ "$st" -eq 0 ]; then st=1; fi
        fi
        exit "$st"
    }
    trap cleanup EXIT
    KOLU_DAEMON_TESTS=1 KOLU_DAEMON_BIND_PID=$$ {{ nix_shell }} pnpm -r {{ pnpm_vendored_filter }} --workspace-concurrency=1 test:daemon "${shard_args[@]}"

# Ask the two real agent packages for their models — this tree's floor vs the pre-models upstream
test-agent-models: install
    #!/usr/bin/env bash
    set -euo pipefail
    floor="$(nix build .#agent-distro-bundle --no-link --print-out-paths --accept-flake-config)"
    old="$(nix build -f default.nix agent-distro-pre-models --argstr commitHash "$(git rev-parse HEAD)" --no-link --print-out-paths)"
    echo "agent-models: floor bundle=$floor"
    echo "agent-models: pre-models package=$old"
    KOLU_AGENT_FLOOR_BUNDLE="$floor" KOLU_AGENT_PRE_MODELS_PACKAGE="$old" \
      {{ nix_shell }} pnpm --filter @kolu/padi exec vitest run src/agentDistro/realPackages.e2e.test.ts

# Ask upstream's published agent package what this kolu calls, once per kind of host
test-agent-published: install
    #!/usr/bin/env bash
    set -euo pipefail
    delivery="$(nix build -f default.nix agent-distro-delivery --argstr commitHash "$(git rev-parse HEAD)" --no-link --print-out-paths)"
    nixes="$(nix build -f default.nix agent-published-nix --argstr commitHash "$(git rev-parse HEAD)" --no-link --print-out-paths)"
    echo "agent-published: delivery=$delivery"
    echo "agent-published: hosts' Nix=$nixes"
    KOLU_AGENT_DISTRO_DELIVERY="$delivery" KOLU_AGENT_PUBLISHED_NIX="$nixes" \
      {{ nix_shell }} pnpm --filter kolu-server exec tsx src/agentDelivery/publishedAnswers.ts

# W3.1 ssh-leg e2e over a REAL ssh hop — DESTRUCTIVE: drains the target's padi, needs KOLU_E2E_SSH_DESTRUCTIVE_ACK=1
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

# W3.1 ssh-leg e2e, TWO-BOX arm (<boxB> is a different host) — DESTRUCTIVE: needs KOLU_E2E_SSH_DESTRUCTIVE_ACK=1
e2e-ssh-2box boxB port='7099': install
    #!/usr/bin/env bash
    set -euo pipefail
    boxB="{{ boxB }}"; port="{{ port }}"
    [ "${KOLU_E2E_SSH_DESTRUCTIVE_ACK:-}" = "1" ] || { echo "e2e-ssh-2box: REFUSING — DESTRUCTIVE against '$boxB': it will killAll + DRAIN (persist+exit, build-swap) that host's padi, KILLING its live terminals. Set KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 ONLY if '$boxB' is a disposable test host, never a workstation." >&2; exit 1; }
    KOLU_E2E_SSH_TWO_BOX=1 just e2e-ssh "$boxB"
    sr="${TMPDIR:-/tmp}/kolu-2box-$$/state"; log="${TMPDIR:-/tmp}/kolu-2box-$$.log"
    echo "e2e-ssh-2box: standing up kolu-server (KOLU_PADI_HOST=$boxB) on :$port"
    KOLU_STATE_DIR="$sr" KOLU_PADI_STATE_DIR="$sr/padi" KOLU_PADI_HOST="$boxB" {{ nix_shell }} nix run .#koluBin -- web --port "$port" >"$log" 2>&1 &
    srv=$!; trap 'kill $srv 2>/dev/null || true' EXIT
    frame=""
    for i in $(seq 1 120); do
        frame=$(timeout 12 curl -s -N --max-time 10 -X POST "http://127.0.0.1:$port/rpc/surface/kolu/daemonInventory/get" \
            -H 'content-type: application/json' -d '{"json":{}}' 2>/dev/null | grep -m1 '^data:' | sed 's/^data: //' || true)
        python3 -c "import json,sys; p=(json.loads(sys.argv[1] or '{}').get('json',{}).get('boundPadi') or {}); sys.exit(0 if p.get('surfaceVersion') else 1)" "$frame" && break
        sleep 1
    done
    echo "daemonInventory (bound to $boxB): $frame"
    python3 -c 'import json,sys; d=json.loads(sys.argv[2] or "{}").get("json",{}); p=d.get("boundPadi") or {}; (print("e2e-ssh-2box: PASS — boundHost="+str(d.get("boundHost"))+", boundPadi.surfaceVersion="+str(p.get("surfaceVersion"))+" over the genuinely-remote binding") if d.get("boundHost")==sys.argv[1] and p.get("surfaceVersion") else sys.exit("FAIL: boundHost="+repr(d.get("boundHost"))+" (expected "+repr(sys.argv[1])+"), boundPadi.surfaceVersion="+repr(p.get("surfaceVersion"))))' "$boxB" "$frame"

# Mixed-version upgrade window against the previous release tag — DESTRUCTIVE: needs KOLU_E2E_SSH_DESTRUCTIVE_ACK=1
e2e-ssh-upgrade host: install
    #!/usr/bin/env bash
    set -euo pipefail
    host="{{ host }}"
    [ "${KOLU_E2E_SSH_DESTRUCTIVE_ACK:-}" = "1" ] || { echo "e2e-ssh-upgrade: REFUSING — DESTRUCTIVE against '$host': it spawns and REAPS padi daemons there. Set KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 ONLY if '$host' is a disposable test host (a pu box), never a workstation." >&2; exit 1; }
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
    echo "e2e-ssh-upgrade: copying the previous closure to ${host} (--no-check-sigs; needs the ssh user in the remote trusted-users)"
    nix copy --to "ssh://${host}" --no-check-sigs "${prev_store}"
    system=$(nix eval --impure --raw --expr builtins.currentSystem)
    drv=$(nix eval --raw --accept-flake-config ".#packages.$system.padi.drvPath")
    # `--reporter=verbose --disableConsoleIntercept`: vitest's default reporter
    # swallows console output for a PASSING test, and this suite's own
    # convergence narration is the evidence the run exists to produce.
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
    lock=""
    export KOLU_CI_REAP_BIND_PID=$$
    cleanup() {
        local st=$?
        if ! just _reap-ci-run; then
            if [ "$st" -eq 0 ]; then st=1; fi
        fi
        if [ -n "$lock" ]; then
            rm -rf "$lock" || true
        fi
        exit "$st"
    }
    trap cleanup EXIT
    # Raise the fd soft limit before spawning workers/servers. macOS defaults
    # to 256, which a kolu server under parallel load can exhaust on accept()
    # (silent EMFILE — no crash, just refused connections). Hard limit is
    # unlimited; this is free insurance on every platform.
    ulimit -n 65536 2>/dev/null || true
    cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
    cap=8; [ "$(uname)" = Darwin ] && cap=6
    KOLU_SERVER="${KOLU_SERVER:-$(nix build .#koluBin --no-link --print-out-paths)/bin/kolu}"
    cd packages/tests
    if [ "${KOLU_E2E_LOCK:-1}" != 0 ]; then
        candidate=/tmp/kolu-e2e-suite.lock
        deadline=$(( $(date +%s) + 3600 ))
        while true; do
            if mkdir "$candidate" 2>/dev/null; then
                lock=$candidate
                echo "$$" > "$lock/pid"
                break
            fi
            owner="$(cat "$candidate/pid" 2>/dev/null || true)"
            if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
                echo "e2e-lock: stealing lock from dead pid $owner"
                rm -rf "$candidate"
                continue
            fi
            if [ "$(date +%s)" -ge "$deadline" ]; then
                echo "e2e-lock: waited 60m on pid ${owner:-?}; proceeding unlocked"
                break
            fi
            echo "e2e-lock: another suite holds $candidate (pid ${owner:-?}); waiting..."
            sleep 15
        done
    fi
    par=$(( (cores + 2) / 3 ))
    if (( par < 1 )); then par=1; fi
    if (( par > cap )); then par=$cap; fi
    echo "e2e: workers=$par (cores=$cores cap=$cap)"
    KOLU_SERVER="$KOLU_SERVER" CUCUMBER_PARALLEL="$par" {{ nix_shell_with_browsers }} pnpm test

# Run part of the Cucumber e2e suite against a source wrapper — args go to cucumber
test-quick *args: install
    #!/usr/bin/env bash
    set -euo pipefail
    cleanup() {
        local st=$?
        if ! just _reap-ci-run; then
            if [ "$st" -eq 0 ]; then st=1; fi
        fi
        exit "$st"
    }
    trap cleanup EXIT
    {{ nix_shell_with_browsers }} pnpm --filter kolu-client build
    wrapper="$PWD/scripts/kolu-source-wrapper.sh"
    cd packages/tests
    {{ nix_shell_with_browsers }} pnpm install
    KOLU_SERVER="$wrapper" CUCUMBER_PARALLEL={{ cucumber_parallel }} \
        {{ nix_shell_with_browsers }} pnpm test {{ args }}

# Dev-mode smoke test of the running stack (see packages/tests/devSmoke.ts)
test-dev: install
    #!/usr/bin/env bash
    set -euo pipefail
    {{ agent_bake }}
    cd packages/tests
    {{ nix_shell_with_browsers }} pnpm test:dev-smoke

# Record the e2e demo screencasts — pass a name for a single recording
record name="": install
    #!/usr/bin/env bash
    set -euo pipefail
    {{ nix_shell_with_browsers }} pnpm --filter kolu-client build
    wrapper="$PWD/scripts/kolu-source-wrapper.sh"
    name_filter=""
    [ -n "{{ name }}" ] && name_filter="--name {{ name }}"
    {{ agent_bake }}
    cd packages/tests
    {{ nix_shell_with_browsers }} pnpm install
    KOLU_SERVER="$wrapper" KOLU_X11CAP=1 CUCUMBER_PARALLEL=1 \
        KOLU_E2E_PADI_HOST_SEED="localhost,kolu-bot" \
        KOLU_REMOTE_PADI_STATE_DIR="/home/toor/.local/state/kolu-hero-demo-padi" \
        {{ nix_shell_with_browsers }} nix-shell screencast/shell.nix --run \
        "node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber-js --profile ui features/recordings.feature $name_filter"

# Boot the packaged Kolu and verify /api/health — production-like runtime smoke
smoke:
    {{ nix_shell }} bash dev/skills/ci/smoke.sh

# Benchmark collection-delta application in @kolu/surface — read the RATIO, not the absolute number
bench-collection-deltas: install
    cd packages/surface && {{ nix_shell }} pnpm exec vitest bench --run src/solid/collectionDeltas.bench.ts

# Benchmark typing-echo latency against the packaged server (env: KOLU_BENCH_*)
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

[private]
_fmt-check:
    {{ nix_shell }} sh -c 'biome format . && nixpkgs-fmt --check {{ nix_format_paths }}'

# Nix build (server + client) — prints store path, no ./result symlink
build:
    nix build --no-link --print-out-paths

# Run the combined server+client binary
run:
    nix run
