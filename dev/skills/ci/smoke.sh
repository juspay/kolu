#!/usr/bin/env bash

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

# The values read here (a URL, a path) never contain a quote, so the next " ends
# the field exactly.
json_field() {
    local name=$1 file=$2 marker=$3 match
    match=$(grep -F "$marker" "$file" | grep -oE "\"$name\":\"[^\"]*\"" | head -1 || true)
    match=${match#\"$name\":\"}
    printf '%s' "${match%\"}"
}

(
    exec env -i HOME="$tmp" SHELL=/bin/sh XDG_RUNTIME_DIR="$runtime" \
        KOLU_DAEMON_BIND_PID="$BASHPID" \
        "$KOLU" web --bind 127.0.0.1 --port 0
) >"$log" 2>&1 &
pid=$!

wait_for_marker "kolu listening" "$log" "$pid"
addr=$(json_field address "$log" "kolu listening")
if [[ -z "$addr" ]]; then
    echo "kolu logged 'listening' but no address could be parsed from the line" >&2
    cat "$log" >&2
    exit 1
fi
echo "kolu listening at $addr (pid=$pid)"

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

wait_for_padi_ready "$log" "$pid"
probe_terminal_node_tools "$log" "$pid"
kill -TERM "$pid"
ec=0
wait "$pid" || ec=$?
pid=""
wait_for_daemons_down "$log"
if [[ $ec -ne 0 ]]; then
    echo "kolu exited with code $ec after SIGTERM" >&2
    cat "$log" >&2
    exit 1
fi
echo "shutdown clean"

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
kill -TERM "$state_pid" 2>/dev/null || true
wait "$state_pid" 2>/dev/null || true
state_pid=""
wait_for_daemons_down "$state_log"

if [[ "$logged" != "$custom_state" ]]; then
    echo "production wrapper ignored KOLU_STATE_DIR (juspay/kolu#1414):" >&2
    echo "  set:    KOLU_STATE_DIR=$custom_state" >&2
    echo "  logged: state directory = ${logged:-<none>}" >&2
    cat "$state_log" >&2
    exit 1
fi
echo "KOLU_STATE_DIR honored: $logged"
