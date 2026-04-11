# localci — forge-agnostic reusable CI library.
#
# How it works:
#   1. Consumer's mod.just declares leaf recipes with [group("system:...")]
#      attributes. Each leaf is a regular justfile recipe with a real body.
#   2. `default` (this file) acquires a single-instance lock via perl flock,
#      then execs `_scheduler`.
#   3. `_scheduler` runs `_plan` (python) to read the justfile metadata
#      and emit a per-system topologically-sorted execution plan, then
#      fans lanes out in parallel. Each step goes through `_step` which
#      wraps it with the CI lifecycle (events, signoff, transport, log
#      capture) and invokes the leaf via `just <module>::<name>`.
#   4. `_summary` reads events.ndjson and renders the two-column table.
#
# Required variables (defined by importer — or leave as default for top-level use):
#   module_name   — the just module name under which this lib is mounted, or
#                   empty string if lib is imported directly into the top-level
#                   justfile. Defaults to "" (top-level).
#
# Required forge recipes (defined by a forges/<name>.just file that the importer also imports):
#   _signoff context state description    — post a commit status (or no-op)
#   _list-statuses                         — return JSON object {context: state}
#
# Required forge variable:
#   repo          — normalized forge repository identifier (may be empty for forges/none.just)

# ─── Boilerplate defaults (importer need not redefine) ───────────────────────

# Default to top-level use (no module prefix). Importers that mount the
# library under a module should override with `module_name := "ci"` or similar.
module_name := ""

# `<module_name>::` prefix for dispatching sibling recipes. Empty when
# lib is imported directly into a top-level justfile.
dispatch := if module_name == "" { "" } else { module_name + "::" }

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

# Acquire single-instance lock via perl Fcntl::flock, then exec into
# `_scheduler`. Kernel releases the lock on any exit (clean, crash, SIGKILL).
# The lock file contents persist as the current-or-last run sha — agents
# read it unconditionally to locate the live event stream.
#
# perl is portable (ships on every Linux + macOS) and gives us kernel-backed
# advisory locking without needing flock(1) (which is absent on Darwin).
# `$^F = 10` prevents FD_CLOEXEC from being set on newly-opened fds, so the
# lock fd survives the exec into `just <module>::_scheduler` and stays held
# for the full duration of the run, not just perl's lifetime.
#
# The consumer's mod.just re-exports this via `default: _default` so it
# wins just's "first-defined" rule for default-recipe selection.
_default:
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
    ' just {{ dispatch }}_scheduler

# ─── Scheduler ────────────────────────────────────────────────────────────────

# Guard + plan + parallel lane fanout + summary.
#
# The plan is a list of "<system>:<step1> <step2> ..." lines, one per system,
# produced by scheduler.py from the module's [group("system:...")] metadata.
# Each lane runs in a background subshell; within a lane, steps run
# sequentially so that intra-lane just dependencies (e.g. `e2e: nix`) are
# respected. `_step` always exits 0 — per-step failures are recorded in
# events.ndjson and surfaced by `_summary`, so a failed step never aborts
# its sibling lanes or subsequent steps in the same lane.
_scheduler:
    #!/usr/bin/env bash
    set -euo pipefail

    # Preflight guards
    just {{ dispatch }}_guard

    # Fetch execution plan
    plan=$(just {{ dispatch }}_plan)

    # Resolve SSH hosts for every non-local system up front so prompts
    # happen before the run starts, not mid-fanout.
    while IFS=: read -r sys _; do
        [[ -z "$sys" ]] && continue
        if [[ "$sys" != "local" && "$sys" != "{{ local_system }}" ]]; then
            CI_SYSTEM="$sys" just {{ dispatch }}_host > /dev/null
        fi
    done <<< "$plan"

    # Emit run_start event
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    just {{ dispatch }}_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"run_start\",\"sha\":\"{{ sha }}\"}"

    # Fork one subshell per lane; run steps sequentially inside each.
    pids=()
    while IFS=: read -r sys steps; do
        [[ -z "$sys" || -z "$steps" ]] && continue
        (
            for step in $steps; do
                if [[ "$sys" == "local" ]]; then
                    just {{ dispatch }}_step "$step"
                else
                    CI_SYSTEM="$sys" just {{ dispatch }}_step "$step"
                fi
            done
        ) &
        pids+=($!)
    done <<< "$plan"

    # Wait for every lane; `|| true` absorbs any non-zero exits (should
    # never happen since _step always returns 0, but defensive).
    for p in "${pids[@]}"; do wait "$p" || true; done

    # Render the two-column summary
    just {{ dispatch }}_summary

# Generate the execution plan by piping `just --dump` through scheduler.py.
# Uses python3 if on PATH, otherwise falls back to `nix run nixpkgs#python3`
# so the library works on any machine with nix installed — no need for
# python to be in the caller's devshell.
_plan:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v python3 >/dev/null 2>&1; then
        py=(python3)
    else
        py=(nix run --quiet nixpkgs#python3 --)
    fi
    just --dump --dump-format json | "${py[@]}" "{{ root }}/vendor/localci/scheduler.py" "{{ module_name }}"

# ─── Guards / host resolution ────────────────────────────────────────────────

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

# ─── Step orchestrator ────────────────────────────────────────────────────────

# Run a CI step with lifecycle wrapping: emit events, post forge signoff,
# dispatch `just <module>::<name>` locally or via ssh. Always exits 0 so
# sibling steps and lanes keep running even if this one fails — the failure
# is recorded in events.ndjson via the ERR trap and surfaced by `_summary`.
#
# Context naming: if CI_SYSTEM is set, the context is `name@system`
# (multi-system step); otherwise it's bare `name` (local-only step).
_step step-name:
    #!/usr/bin/env bash
    set -euo pipefail
    user=$(whoami)
    full_sha="{{ sha }}"
    short_sha="${full_sha:0:7}"
    logdir="{{ root }}/.localci/logs/${short_sha}"
    mkdir -p "$logdir"
    if [[ -n "${CI_SYSTEM:-}" ]]; then
        context="{{ step-name }}@{{ system }}"
    else
        context="{{ step-name }}"
    fi
    logfile="$logdir/${context}.log"
    logrel=".localci/logs/${short_sha}/${context}.log"
    start=$SECONDS

    # Build colored prefix label
    esc=$'\033'
    name_color=$((31 + $(printf '%s' '{{ step-name }}' | cksum | cut -d' ' -f1) % 6))
    sys_color=$((31 + $(printf '%s' '{{ system }}' | cksum | cut -d' ' -f1) % 6))
    if [[ "$sys_color" == "$name_color" ]]; then
        sys_color=$(( (sys_color - 31 + 3) % 6 + 31 ))
    fi
    if [[ "{{ system }}" == "{{ local_system }}" ]]; then
        icon="~"
    else
        icon=">"
    fi
    max_len=$(just {{ dispatch }}_contexts | awk '{ if (length > m) m = length } END { print m + 2 }')
    label="{{ step-name }}@${icon} {{ system }}"
    pad_len=$(( max_len - ${#label} ))
    trailing=$(printf "%${pad_len}s" "" 2>/dev/null || echo "")
    colored="${esc}[${name_color}m{{ step-name }}${esc}[0m@${esc}[${sys_color}m${icon} {{ system }}${esc}[0m${trailing}"

    # Failure handler: emit failure event + forge signoff, return 0 so the
    # scheduler keeps going. Per-step failures are visible in events.ndjson
    # and surfaced by _summary; the process exit code is redundant with
    # the event stream and actively harmful (would abort sibling steps).
    on_fail() {
        local ec=$?
        local elapsed=$(( SECONDS - start ))
        local ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        just {{ dispatch }}_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"step_end\",\"step\":\"{{ step-name }}\",\"system\":\"{{ system }}\",\"context\":\"$context\",\"state\":\"failure\",\"duration_s\":$elapsed,\"log\":\"$logrel\"}" || true
        just {{ dispatch }}_signoff "$context" failure "${user} · failed after ${elapsed}s · ${logrel}" || true
        exit 0
    }
    trap on_fail ERR

    # Emit step_start + forge signoff pending
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    just {{ dispatch }}_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"step_start\",\"step\":\"{{ step-name }}\",\"system\":\"{{ system }}\",\"context\":\"$context\"}"
    just {{ dispatch }}_signoff "$context" pending "${user} · running"

    # Dispatch: run `just <module>::<name>` locally, or via ssh + git bundle
    # to a remote builder if the target system isn't native.
    if [[ "{{ system }}" == "{{ local_system }}" ]]; then
        echo "▶ ${colored}"
        (cd "{{ root }}" && just {{ dispatch }}{{ step-name }}) 2>&1 | tee "$logfile" | sed "s|^|[${colored}] |"
    else
        host=$(just {{ dispatch }}_host)
        echo "▶ ${colored} ($host)"
        tmp=$(ssh "$host" mktemp -d)
        # Clone full repo (git bundle, not git archive) so remote has .git —
        # nix builds often read the git revision from there.
        git bundle create - --all 2>/dev/null | ssh "$host" "cat > $tmp/repo.bundle && git clone --quiet $tmp/repo.bundle $tmp/src && cd $tmp/src && git -c advice.detachedHead=false checkout --quiet {{ sha }}"
        ssh "$host" "cd $tmp/src && just {{ dispatch }}{{ step-name }}" 2>&1 | tee "$logfile" | sed "s|^|[${colored}] |"
        ssh "$host" "rm -rf $tmp" 2>/dev/null || true
    fi

    # Success: emit step_end + forge signoff
    elapsed=$(( SECONDS - start ))
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    just {{ dispatch }}_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"step_end\",\"step\":\"{{ step-name }}\",\"system\":\"{{ system }}\",\"context\":\"$context\",\"state\":\"success\",\"duration_s\":$elapsed,\"log\":\"$logrel\"}"
    just {{ dispatch }}_signoff "$context" success "${user} · ${elapsed}s · ${logrel}"

# ─── Contexts ─────────────────────────────────────────────────────────────────

# List all CI contexts (step names, with @system suffix for non-local lanes).
# Derived from the same plan the scheduler uses, so contexts always reflect
# the actual execution surface. Consumed by `_signoff`, `_summary`, `protect`.
_contexts:
    #!/usr/bin/env bash
    set -euo pipefail
    just {{ dispatch }}_plan | while IFS=: read -r sys steps; do
        [[ -z "$sys" || -z "$steps" ]] && continue
        for step in $steps; do
            if [[ "$sys" == "local" ]]; then
                echo "$step"
            else
                echo "${step}@${sys}"
            fi
        done
    done

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
    signoff_statuses=$(just {{ dispatch }}_list-statuses 2>/dev/null || echo "{}")
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
    done <<< "$(just {{ dispatch }}_contexts)"

    # Emit run_end event (captures final state in the event stream)
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    final_state="success"
    if [[ "$failed" -eq 1 ]]; then final_state="failure"; fi
    just {{ dispatch }}_emit-event "{\"v\":1,\"ts\":\"$ts\",\"event\":\"run_end\",\"state\":\"$final_state\"}" || true

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
