#!/usr/bin/env bash
# Boot the packaged Kolu (production wrapper, .#default) and verify the three
# runtime contracts a green `nix build` can still break:
#
#   1. It serves /api/health — catches packaging regressions where the build
#      succeeds but the binary crashes at startup (the missing-workspace-dep
#      crash that motivated #761).
#   2. It HONORS an inherited KOLU_STATE_DIR — #531 made default.nix export it
#      unconditionally, silently forcing state under $HOME/.config/kolu so a
#      second production instance couldn't relocate its state (juspay/kolu#1414).
#   3. A hosted terminal can run node, npm, npx, and corepack. The wrapper PATH
#      is the terminal's base PATH, so using nodejs-slim there silently removes
#      the package-management commands even though the daemons still boot.
#
# The first two contracts share the same boot-and-read-log mechanism; the third
# drives the real padi socket to prove what a hosted shell actually inherits.

set -euo pipefail

readonly POLL_INTERVAL_SEC=0.1
readonly HEALTH_TIMEOUT_MS=5000
readonly STARTUP_TIMEOUT_SEC=120
readonly TEARDOWN_TIMEOUT_SEC=10
readonly TEARDOWN_QUIET_SEC=2

KOLU=$(nix build .#default --no-link --print-out-paths)/bin/kolu
PADI_TUI=$(nix build .#padi-tui --no-link --print-out-paths)/bin/padi-tui

# Anchor the isolated tree at /tmp rather than $TMPDIR. macOS hands every
# process a per-user TMPDIR ~49 characters deep (/var/folders/xx/<30 chars>/T/),
# and the daemons put their unix sockets under XDG_RUNTIME_DIR below it:
# $TMPDIR/tmp.XXXXXXXXXX/runtime/kaval-<16 hex>/pty-host.sock is 108 bytes,
# past macOS's 104-byte sun_path cap. kaval then cannot bind, exits, and padi
# is left with no PTY host — so every hosted terminal silently fails to spawn.
# Production never nests XDG_RUNTIME_DIR that deep, so this would be the
# harness testing an OS path limit instead of the packaged binary.
tmp=$(TMPDIR=/tmp mktemp -d)
log="$tmp/kolu.log"
runtime="$tmp/runtime"
mkdir -m 700 "$runtime"
state_tmp=""
pid=""
state_pid=""

dump_gate_holders() {
    local gate holder
    while IFS= read -r gate; do
        holder=$(tr -d '[:space:]' <"$gate" 2>/dev/null || true)
        echo "  $gate -> ${holder:-<unreadable>}" >&2
    done < <(find "$runtime" -name '*.pid' -type f -print)
}

wait_for_daemons_down() {
    local logfile=$1 deadline=$((SECONDS + TEARDOWN_TIMEOUT_SEC))
    local gate holder found quiet_since=-1
    while true; do
        found=false
        while IFS= read -r gate; do
            [[ -e "$gate" ]] || continue
            holder=$(tr -d '[:space:]' <"$gate" 2>/dev/null || true)
            if [[ "$holder" =~ ^[1-9][0-9]*$ ]] && kill -0 "$holder" 2>/dev/null; then
                found=true
            else
                # The gate protocol treats a dead/malformed holder as stale.
                rm -f -- "$gate"
            fi
        done < <(find "$runtime" -name '*.pid' -type f -print)
        if [[ "$found" == false ]] &&
            ! find "$runtime" -name '*.pid' -type f -print -quit | grep -q .; then
            if (( quiet_since < 0 )); then quiet_since=$SECONDS; fi
            if (( SECONDS - quiet_since >= TEARDOWN_QUIET_SEC )); then
                return 0
            fi
        else
            quiet_since=-1
        fi
        if (( SECONDS >= deadline )); then
            echo "daemons did not release their gates within ${TEARDOWN_TIMEOUT_SEC}s:" >&2
            dump_gate_holders
            cat "$logfile" >&2
            return 1
        fi
        sleep "$POLL_INTERVAL_SEC"
    done
}

# The server starts padi asynchronously. Wait until padi is actually serving
# before terminating its parent; otherwise teardown can observe an empty runtime
# and remove it while the still-booting grandchild is about to claim its gate.
wait_for_padi_ready() {
    local logfile=$1 proc=$2 deadline=$((SECONDS + STARTUP_TIMEOUT_SEC))
    while kill -0 "$proc" 2>/dev/null; do
        find "$runtime" -name padi.sock -type s -print -quit | grep -q . &&
            return 0
        if (( SECONDS >= deadline )); then
            echo "padi did not start serving within ${STARTUP_TIMEOUT_SEC}s" >&2
            cat "$logfile" >&2
            kill -TERM "$proc" 2>/dev/null || true
            return 1
        fi
        sleep "$POLL_INTERVAL_SEC"
    done
    echo "kolu exited before padi started serving" >&2
    cat "$logfile" >&2
    return 1
}

probe_terminal_node_tools() {
    local logfile=$1 proc=$2
    local socket spawned="$tmp/terminal-spawned" output="$tmp/terminal-node-tools"
    socket=$(find "$runtime" -name padi.sock -type s -print -quit)
    # Two markers, not one. `spawned` is written before anything can fail, so it
    # separates the two ways this probe can time out: padi accepting `create`
    # but never spawning a PTY, versus a PTY that runs but has lost the Node
    # toolset. Collapsing them into one "could not run the packaged Node
    # toolset" message sent an investigation after a PATH bug when the real
    # regression was #1988 pruning node-pty's darwin spawn-helper.
    # `--toplevel` because placement is REQUIRED and has no default: this probe
    # wants one terminal of its own, and saying so is the whole rule.
    "$PADI_TUI" create --toplevel --socket "$socket" -- /bin/sh -c \
        'printf spawned >"$1"; for tool in node npm npx corepack; do command -v "$tool" || exit 1; done; printf ok >"$2"' \
        _ "$spawned" "$output" >/dev/null

    local deadline=$((SECONDS + STARTUP_TIMEOUT_SEC))
    while kill -0 "$proc" 2>/dev/null; do
        if [[ -s "$output" ]]; then
            echo "hosted terminal retains node, npm, npx, and corepack"
            return 0
        fi
        if (( SECONDS >= deadline )); then
            if [[ -s "$spawned" ]]; then
                echo "hosted terminal ran, but node, npm, npx, or corepack is missing from its PATH" >&2
            else
                echo "hosted terminal never spawned: padi accepted the create but no PTY ran /bin/sh — check node-pty's build/Release artifacts for this platform" >&2
            fi
            # kaval owns the PTYs, and when it dies its reason lands ONLY in its
            # own log — the server just reports a generic socket timeout. Print
            # it here so the failing lane carries the cause, not just the symptom.
            while IFS= read -r kavalLog; do
                echo "--- $kavalLog ---" >&2
                cat "$kavalLog" >&2
            done < <(find "$runtime" -name 'kaval*.log' -type f -print)
            cat "$logfile" >&2
            return 1
        fi
        sleep "$POLL_INTERVAL_SEC"
    done
    echo "kolu exited before the hosted-terminal Node tool probe completed" >&2
    cat "$logfile" >&2
    return 1
}

cleanup() {
    # Best-effort teardown on EXIT — `|| true` because the trap can race with
    # the process's own exit, and we don't want a stale-PID kill to mask the
    # real error that triggered the trap.
    for p in "$pid" "$state_pid"; do
        if [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; then
            kill -TERM "$p" 2>/dev/null || true
            wait "$p" 2>/dev/null || true
        fi
    done
    wait_for_daemons_down "$log" || true
    rm -rf "$tmp" ${state_tmp:+"$state_tmp"}
}
trap cleanup EXIT

# Block until $proc logs $marker or dies; death is a smoke failure (dump the
# log, abort). The generous watchdog keeps a wedged process from consuming the
# whole CI deadline while leaving normal loaded starts ample room. The marker is
# the message TEXT — the
# semantic anchor, stable across pino transports (pino-pretty and JSON alike).
wait_for_marker() {
    local marker=$1 logfile=$2 proc=$3
    local deadline=$((SECONDS + STARTUP_TIMEOUT_SEC))
    while kill -0 "$proc" 2>/dev/null; do
        grep -q "$marker" "$logfile" 2>/dev/null && return 0
        if (( SECONDS >= deadline )); then
            echo "kolu did not log within ${STARTUP_TIMEOUT_SEC}s: $marker" >&2
            cat "$logfile" >&2
            kill -TERM "$proc" 2>/dev/null || true
            return 1
        fi
        sleep "$POLL_INTERVAL_SEC"
    done
    echo "kolu exited before logging: $marker" >&2
    cat "$logfile" >&2
    return 1
}

# Value of the JSON string field "<name>":"<value>" on the line carrying $marker
# ("" if none). Scoping to the marker line — the same anchor the probe already
# waited on — keeps this honest: the field is read off the line whose presence we
# proved, not the first match anywhere (which would silently capture an unrelated
# earlier "<name>":"..." if a future log line emitted one).
# NAME is a fixed prefix (grep -F + literal ${match#...} strip), not a regex, so
# it carries no pattern sensitivity; both callers pass static literals regardless.
# The values read here (a URL, a path) never contain a quote, so the next " ends
# the field exactly.
json_field() {
    local name=$1 file=$2 marker=$3 match
    match=$(grep -F "$marker" "$file" | grep -oE "\"$name\":\"[^\"]*\"" | head -1 || true)
    match=${match#\"$name\":\"}
    printf '%s' "${match%\"}"
}

# --- Contract 1: the binary boots and serves /api/health. ---
# Sanitize env so we mirror production: clear IN_NIX_SHELL and devshell
# pollution. HOME→tmp so the wrapper's default KOLU_STATE_DIR lands there
# instead of the runner's real ~/.config.
# Bind padi + kaval to this server process. The subshell's BASHPID becomes the
# exec'd server's pid, so both daemons self-reap after SIGTERM and release their
# gates before cleanup removes the isolated runtime/state tree.
# Use plain sh for the probe terminal: unlike bash/zsh, it has no Kolu rc replay
# that can replace the inherited base PATH with the runner's /etc/profile PATH.
(
    exec env -i HOME="$tmp" SHELL=/bin/sh XDG_RUNTIME_DIR="$runtime" \
        KOLU_DAEMON_BIND_PID="$BASHPID" \
        "$KOLU" web --bind 127.0.0.1 --port 0
) >"$log" 2>&1 &
pid=$!

# The address is logged from the listen callback (packages/server/src/index.ts).
wait_for_marker "kolu listening" "$log" "$pid"
addr=$(json_field address "$log" "kolu listening")
if [[ -z "$addr" ]]; then
    echo "kolu logged 'listening' but no address could be parsed from the line" >&2
    cat "$log" >&2
    exit 1
fi
echo "kolu listening at $addr (pid=$pid)"

# Health check via Node's built-in fetch (no curl in dev shell). Asserts only
# HTTP 200 — the response body is an implementation detail of index.ts:143
# that the smoke shouldn't couple to.
if ! node -e '
  const [url, timeoutMs] = [process.argv[1] + "/api/health", Number(process.argv[2])];
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
    .catch(e => { console.error(e.message || e); process.exit(1); });
' "$addr" "$HEALTH_TIMEOUT_MS"; then
    echo "/api/health request failed" >&2
    cat "$log" >&2
    exit 1
fi
echo "/api/health returned 200"

# Graceful shutdown: SIGTERM, expect exit 0.
wait_for_padi_ready "$log" "$pid"
probe_terminal_node_tools "$log" "$pid"
kill -TERM "$pid"
ec=0
wait "$pid" || ec=$?
pid=""  # disarm cleanup trap — we've already waited
wait_for_daemons_down "$log"
if [[ $ec -ne 0 ]]; then
    echo "kolu exited with code $ec after SIGTERM" >&2
    cat "$log" >&2
    exit 1
fi
echo "shutdown clean"

# --- Contract 2: the production wrapper HONORS an inherited KOLU_STATE_DIR. ---
# Boot with KOLU_STATE_DIR pointed at a dir OUTSIDE $HOME and assert the server
# resolves that exact directory (state.ts logs it at startup). This guard lives
# on .#default deliberately: .#koluBin has no fallback and crashes if the var is
# unset — that's what tests build, so they never traverse this wrapper, and #530
# /#531's test-isolation guarantee is untouched.
state_tmp=$(TMPDIR=/tmp mktemp -d)  # short base, same sun_path reason as above
# Resolve symlinks up front: the server echoes back the KOLU_STATE_DIR we pass
# verbatim, so we compare against the canonical form to stay robust on the darwin
# lane (macOS $TMPDIR / `/tmp` resolve under /private) — and against a future
# change that logs the resolved path rather than the raw env value.
custom_state="$(realpath "$state_tmp")/relocated"
state_log="$state_tmp/kolu.log"
(
    exec env -i HOME="$state_tmp/home" XDG_RUNTIME_DIR="$runtime" \
        KOLU_STATE_DIR="$custom_state" KOLU_DAEMON_BIND_PID="$BASHPID" \
        "$KOLU" web --bind 127.0.0.1 --port 0
) >"$state_log" 2>&1 &
state_pid=$!

wait_for_marker "state directory" "$state_log" "$state_pid"
logged=$(json_field path "$state_log" "state directory")
wait_for_padi_ready "$state_log" "$state_pid"
# Best-effort teardown (same rationale as cleanup()): a stale-PID kill can race
# the process's own exit, and that error must not mask a real failure.
kill -TERM "$state_pid" 2>/dev/null || true
wait "$state_pid" 2>/dev/null || true
state_pid=""  # disarm cleanup trap — we've already waited
wait_for_daemons_down "$state_log"

if [[ "$logged" != "$custom_state" ]]; then
    echo "production wrapper ignored KOLU_STATE_DIR (juspay/kolu#1414):" >&2
    echo "  set:    KOLU_STATE_DIR=$custom_state" >&2
    echo "  logged: state directory = ${logged:-<none>}" >&2
    cat "$state_log" >&2
    exit 1
fi
echo "KOLU_STATE_DIR honored: $logged"
