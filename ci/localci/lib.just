# localci — forge-agnostic reusable CI library.
#
# Required variables (defined by importer):
#   module_name   — the just module name under which this lib is mounted (e.g. "ci")
#   systems       — space-separated list of all target systems
#
# Required forge recipes (defined by a forges/<name>.just file that the importer also imports):
#   _signoff context state description    — post a commit status (or no-op)
#   _list-statuses                         — return JSON object {context: state}
#
# Required forge variable:
#   repo          — normalized forge repository identifier (may be empty for forges/none.just)

# ─── Boilerplate defaults (importer need not redefine) ───────────────────────

# Current git HEAD sha under test.
sha          := `git rev-parse HEAD`
# Nix system for the current step — overridable via CI_SYSTEM env var so a
# single justfile process can dispatch steps to multiple target systems.
system       := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
# The machine's native nix system (never overridden — used to decide
# whether a step runs locally or via ssh to a remote builder).
local_system := `nix eval --raw --impure --expr builtins.currentSystem`
# Git repo root — all .localci/ paths are resolved against this so recipes
# work correctly when invoked from a submodule cwd.
root         := `git rev-parse --show-toplevel`

# ─── Top-level entrypoint ────────────────────────────────────────────────────

# Acquire single-instance lock via perl Fcntl::flock, then exec into `_inner`
# (which the importer defines as its preflight + run-all + summary dep chain).
# Kernel releases the lock on any exit (clean, crash, SIGKILL). The lock file
# contents persist as the current-or-last run sha — agents read it
# unconditionally to locate the live event stream.
#
# perl is portable (ships on every Linux + macOS) and gives us kernel-backed
# advisory locking without needing flock(1) (which is absent on Darwin).
# `$^F = 10` prevents FD_CLOEXEC from being set on newly-opened fds, so the
# lock fd survives the exec into `just <module>::_inner` and stays held for
# the full duration of the run, not just perl's lifetime.
default:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{ root }}/.localci"
    cd "{{ root }}"
    exec perl -MFcntl=:flock -e '
        BEGIN { $^F = 10 }
        open(my $f, "+>>", ".localci/current") or die "open: $!\n";
        flock($f, LOCK_EX | LOCK_NB) or do {
            seek $f, 0, 0;
            my $prev = <$f> // "?";
            chomp $prev;
            die "localci already running (sha=$prev)\n";
        };
        truncate($f, 0); seek $f, 0, 0;
        print $f "{{ sha }}\n";
        $f->flush;
        exec @ARGV or die "exec: $!\n";
    ' just {{ module_name }}::_inner

# ─── Preflight / guards ───────────────────────────────────────────────────────

# Preflight: guard checks + resolve SSH hosts before running steps.
_preflight:
    #!/usr/bin/env bash
    set -euo pipefail
    just {{ module_name }}::_guard
    for sys in {{ systems }}; do
        if [[ "$sys" != "{{ local_system }}" ]]; then
            CI_SYSTEM="$sys" just {{ module_name }}::_host > /dev/null
        fi
    done
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    just {{ module_name }}::_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"run_start\",\"sha\":\"{{ sha }}\"}"

# Assert worktree is clean and HEAD matches expected sha and is pushed to remote.
_guard:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "ERROR: worktree is dirty — commit or stash before running CI" >&2
        exit 1
    fi
    if [[ "$(git rev-parse HEAD)" != "{{ sha }}" ]]; then
        echo "ERROR: HEAD has moved since CI started (expected {{ sha }})" >&2
        exit 1
    fi
    if ! git branch -r --contains {{ sha }} 2>/dev/null | grep -q .; then
        echo "ERROR: {{ sha }} not pushed to remote — push first" >&2
        exit 1
    fi

# Look up SSH host for current system, prompting on first use. Saved to ci-hosts.json.
_host:
    #!/usr/bin/env bash
    set -euo pipefail
    config="${XDG_CONFIG_HOME:-$HOME/.config}/ci-hosts.json"
    if [[ ! -f "$config" ]]; then
        mkdir -p "$(dirname "$config")"
        echo '{"hosts":{}}' > "$config"
    fi
    host=$(jq -r ".hosts.\"{{ system }}\" // empty" "$config")
    if [[ -z "$host" ]]; then
        read -p "Enter SSH hostname for {{ system }}: " host
        jq ".hosts.\"{{ system }}\" = \"$host\"" "$config" > "$config.tmp" && mv "$config.tmp" "$config"
        echo "Saved to $config" >&2
    fi
    echo "$host"

# ─── Event stream ─────────────────────────────────────────────────────────────

# Append an NDJSON event to .localci/logs/<short-sha>/events.ndjson under flock.
# Uses perl for portable file locking (works on Linux + macOS with no external deps).
_emit-event json:
    #!/usr/bin/env bash
    set -euo pipefail
    full_sha="{{ sha }}"
    short_sha="${full_sha:0:7}"
    evdir="{{ root }}/.localci/logs/${short_sha}"
    mkdir -p "$evdir"
    perl -MFcntl=:flock -e '
        open(my $f, ">>", $ARGV[0]) or die "open: $!\n";
        flock($f, LOCK_EX) or die "flock: $!\n";
        print $f $ARGV[1], "\n";
    ' "$evdir/events.ndjson" '{{ json }}'

# ─── Step execution (single-concern helpers) ─────────────────────────────────

# Run cmd locally (in repo root), tee output to logfile with colored prefix.
_exec-local cmd logfile prefix:
    #!/usr/bin/env bash
    set -euo pipefail
    (cd "{{ root }}" && {{ cmd }}) 2>&1 | tee "{{ logfile }}" | sed "s|^|[{{ prefix }}] |"

# Run cmd on remote host via ssh + git bundle, tee output to logfile with colored prefix.
_exec-remote host cmd logfile prefix:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp=$(ssh "{{ host }}" mktemp -d)
    trap 'ssh "{{ host }}" "rm -rf $tmp"' EXIT
    git bundle create - --all 2>/dev/null | ssh "{{ host }}" "cat > $tmp/repo.bundle && git clone --quiet $tmp/repo.bundle $tmp/src && cd $tmp/src && git -c advice.detachedHead=false checkout --quiet {{ sha }}"
    ssh "{{ host }}" "cd $tmp/src && {{ cmd }}" 2>&1 | tee "{{ logfile }}" | sed "s|^|[{{ prefix }}] |"

# ─── Step orchestrator ────────────────────────────────────────────────────────

# Run a CI step: emit events, post forge signoff, dispatch local-or-remote.
# If CI_SYSTEM is set, context = name@system (multi-system step).
# Otherwise, context = name (local-only step).
_run name +cmd:
    #!/usr/bin/env bash
    set -euo pipefail
    just {{ module_name }}::_guard
    user=$(whoami)
    full_sha="{{ sha }}"
    short_sha="${full_sha:0:7}"
    logdir="{{ root }}/.localci/logs/${short_sha}"
    mkdir -p "$logdir"
    if [[ -n "${CI_SYSTEM:-}" ]]; then
        context="{{ name }}@{{ system }}"
    else
        context="{{ name }}"
    fi
    logfile="$logdir/${context}.log"
    logrel=".localci/logs/${short_sha}/${context}.log"
    start=$SECONDS

    # Build colored prefix label
    esc=$'\033'
    name_color=$((31 + $(printf '%s' '{{ name }}' | cksum | cut -d' ' -f1) % 6))
    sys_color=$((31 + $(printf '%s' '{{ system }}' | cksum | cut -d' ' -f1) % 6))
    if [[ "$sys_color" == "$name_color" ]]; then
        sys_color=$(( (sys_color - 31 + 3) % 6 + 31 ))
    fi
    if [[ "{{ system }}" == "{{ local_system }}" ]]; then
        icon="~"
    else
        icon=">"
    fi
    max_len=$(just {{ module_name }}::_contexts | awk '{ if (length > m) m = length } END { print m + 2 }')
    label="{{ name }}@${icon} {{ system }}"
    pad_len=$(( max_len - ${#label} ))
    trailing=$(printf "%${pad_len}s" "" 2>/dev/null || echo "")
    colored="${esc}[${name_color}m{{ name }}${esc}[0m@${esc}[${sys_color}m${icon} {{ system }}${esc}[0m${trailing}"

    # Failure handler: emit step_end(failure) + forge signoff(failure)
    on_fail() {
        local ec=$?
        local elapsed=$(( SECONDS - start ))
        local ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        just {{ module_name }}::_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"step_end\",\"step\":\"{{ name }}\",\"system\":\"{{ system }}\",\"context\":\"$context\",\"state\":\"failure\",\"duration_s\":$elapsed,\"log\":\"$logrel\"}" || true
        just {{ module_name }}::_signoff "$context" failure "${user} · failed after ${elapsed}s · ${logrel}" || true
        exit $ec
    }
    trap on_fail ERR

    # Emit step_start + forge signoff pending
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    just {{ module_name }}::_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"step_start\",\"step\":\"{{ name }}\",\"system\":\"{{ system }}\",\"context\":\"$context\"}"
    just {{ module_name }}::_signoff "$context" pending "${user} · running"

    # Dispatch to local or remote transport
    if [[ "{{ system }}" == "{{ local_system }}" ]]; then
        echo "▶ ${colored}"
        just {{ module_name }}::_exec-local "{{ cmd }}" "$logfile" "$colored"
    else
        host=$(just {{ module_name }}::_host)
        echo "▶ ${colored} ($host)"
        just {{ module_name }}::_exec-remote "$host" "{{ cmd }}" "$logfile" "$colored"
    fi

    # Success: emit step_end + forge signoff
    elapsed=$(( SECONDS - start ))
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    just {{ module_name }}::_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"step_end\",\"step\":\"{{ name }}\",\"system\":\"{{ system }}\",\"context\":\"$context\",\"state\":\"success\",\"duration_s\":$elapsed,\"log\":\"$logrel\"}"
    just {{ module_name }}::_signoff "$context" success "${user} · ${elapsed}s · ${logrel}"

# ─── Devour-flake helper ──────────────────────────────────────────────────────

# Build all flake outputs via devour-flake (nix build wrapper).
# Passes the full nix build command through `_run` as a dep — no subprocess
# hop. The devour-flake boilerplate is interpolated as literal tokens;
# `args` carries whatever the caller passed variadically.
_devour-flake step +args: (_run step "nix build github:srid/devour-flake -L --no-link --print-out-paths" args)

# ─── Context auto-extraction ─────────────────────────────────────────────────

# Auto-extract CI contexts from justfile structure by parsing recipe bodies.
# Multi-system steps: "CI_SYSTEM=<sys> just <module>::<step> ..." → step@system
# Local-only steps:   "just <module>::<step> ..." → step (no @system suffix)
_contexts:
    #!/usr/bin/env bash
    set -euo pipefail
    just --dump --dump-format json | jq -r --arg m "{{ module_name }}" '
      .modules[$m].recipes as $r
      | def expand:
          if startswith("_") then
            [ $r[.].dependencies[]?.recipe | expand ] | add // []
          else [.] end;
      $r | to_entries[]
      | select(.key | startswith("_"))
      | .value.body[0][0] // "" as $first
      | if ($first | test("^CI_SYSTEM=")) then
          $first
          | capture("CI_SYSTEM=(?<system>[^ ]+) just (?<steps>.+?)( \\|\\| true)?$")
          | .system as $sys
          | ([ .steps | split(" ")[] | ltrimstr("\($m)::") | expand ] | add // [])[]
          | . + "@" + $sys
        elif ($first | test("^just \($m)::[a-z]")) then
          $first
          | capture("just (?<steps>.+?)( \\|\\| true)?$")
          | ([ .steps | split(" ")[] | ltrimstr("\($m)::") | expand ] | add // [])[]
        else empty end'

# ─── Summary ──────────────────────────────────────────────────────────────────

# Render a two-column summary table from events.ndjson (local) + forge statuses (signoff).
# Local column drives row symbol and exit code; signoff divergence is a warning.
# Emits a run_end event before the pass/fail decision.
_summary:
    #!/usr/bin/env bash
    set -euo pipefail
    esc=$'\033'
    full_sha="{{ sha }}"
    short_sha="${full_sha:0:7}"
    evfile="{{ root }}/.localci/logs/${short_sha}/events.ndjson"

    # Read local state from events.ndjson (last step_end per context wins).
    # Tolerate a missing or malformed file — summary should still render
    # whatever signoff data is available, with "-" for missing local state.
    if [[ -f "$evfile" ]]; then
        local_statuses=$(jq -cs '
            map(select(.event == "step_end"))
            | group_by(.context)
            | map(max_by(.ts))
            | map({(.context): .state}) | add // {}' "$evfile" 2>/dev/null || echo "{}")
    else
        local_statuses="{}"
    fi

    # Read signoff state from forge (may fail gracefully)
    signoff_statuses=$(just {{ module_name }}::_list-statuses 2>/dev/null || echo "{}")
    if [[ -z "$signoff_statuses" || "$signoff_statuses" == "null" ]]; then
        signoff_statuses="{}"
    fi
    if [[ "$signoff_statuses" == "{}" ]]; then
        has_signoff="no"
    else
        has_signoff="yes"
    fi

    echo ""
    echo "━━━ CI Summary ({{ sha }}) ━━━"
    failed=0
    divergence=0
    while IFS= read -r ctx; do
        loc=$(echo "$local_statuses" | jq -r --arg c "$ctx" '.[$c] // "not run"')
        sig=$(echo "$signoff_statuses" | jq -r --arg c "$ctx" '.[$c] // "—"')
        case "$loc" in
            success) symbol="${esc}[32m✓${esc}[0m" ;;
            failure) symbol="${esc}[31m✗${esc}[0m"; failed=1 ;;
            pending) symbol="${esc}[33m●${esc}[0m"; failed=1 ;;
            *)       symbol="${esc}[90m-${esc}[0m"; failed=1 ;;
        esac
        warn="  "
        if [[ "$has_signoff" == "yes" && "$loc" != "$sig" && "$loc" != "not run" ]]; then
            warn="${esc}[33m⚠${esc}[0m "
            divergence=$((divergence + 1))
        fi
        if [[ "$has_signoff" == "yes" ]]; then
            printf "  %b %b %-30s %-10s %s\n" "$symbol" "$warn" "$ctx" "$loc" "$sig"
        else
            printf "  %b  %-30s %s\n" "$symbol" "$ctx" "$loc"
        fi
    done <<< "$(just {{ module_name }}::_contexts)"

    # Emit run_end event (captures final state in the event stream)
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    final_state="success"
    if [[ "$failed" -eq 1 ]]; then final_state="failure"; fi
    just {{ module_name }}::_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"run_end\",\"state\":\"$final_state\"}" || true

    echo ""
    if [[ "$failed" -eq 1 ]]; then
        echo "${esc}[31mCI FAILED${esc}[0m"
        exit 1
    fi
    if [[ "$divergence" -gt 0 ]]; then
        echo "${esc}[32mCI PASSED${esc}[0m (local) · ${divergence} signoff divergence"
    else
        echo "${esc}[32mCI PASSED${esc}[0m"
    fi
