# Reusable CI library — pure just + gh + ssh.
# Expects the importer to define: sha, repo, system, local_system, root, systems (space-separated)

# Preflight: guard checks + resolve SSH hosts before running steps
_preflight:
    #!/usr/bin/env bash
    set -euo pipefail
    just ci::_guard
    for sys in {{ systems }}; do
        if [[ "$sys" != "{{ local_system }}" ]]; then
            CI_SYSTEM="$sys" just ci::_host > /dev/null
        fi
    done

# Post GitHub commit status.
#
# NOTE: .apm/instructions/workflow.instructions.md contains a Monitor
# filter that greps `just ci` stdout for the literal pattern
# `context="ci/X" -f description="..."` emitted by this command. If you change
# the gh api invocation here (flags, ordering, wrap in a function, etc.),
# update the filter regex in workflow.instructions.md too — otherwise Claude's
# Monitor will silently emit zero events on `just ci` runs.
_signoff name status description="":
    gh api "repos/{{ repo }}/statuses/{{ sha }}" \
      -f state="{{ status }}" -f context="ci/{{ name }}" \
      -f description="{{ description }}" --silent

# Assert worktree is clean and HEAD matches expected sha
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

# Look up SSH host for current system, prompting on first use. Saved to .ci.json.
_host:
    #!/usr/bin/env bash
    set -euo pipefail
    config="${XDG_CONFIG_HOME:-$HOME/.config}/ci-hosts.json"
    if [[ ! -f "$config" ]]; then
        echo '{"hosts":{}}' > "$config"
    fi
    host=$(jq -r ".hosts.\"{{ system }}\" // empty" "$config")
    if [[ -z "$host" ]]; then
        read -p "Enter SSH hostname for {{ system }}: " host
        jq ".hosts.\"{{ system }}\" = \"$host\"" "$config" > "$config.tmp" && mv "$config.tmp" "$config"
        echo "Saved to $config" >&2
    fi
    echo "$host"

# Run command with GitHub status lifecycle (pending → success/failure)
# Routes to local exec or remote (git bundle + ssh) based on system.
# If CI_SYSTEM is set, context = name@system (multi-system step).
# If CI_SYSTEM is unset, context = name (local-only step).
_run name +cmd:
    #!/usr/bin/env bash
    set -euo pipefail
    # Re-check guard per step: user may have dirtied the repo mid-run
    just ci::_guard
    user=$(whoami)
    full_sha="{{ sha }}"
    short_sha="${full_sha:0:7}"
    logdir="{{ root }}/.logs/${short_sha}"
    mkdir -p "$logdir"
    # Local-only steps (no CI_SYSTEM) get bare context; multi-system steps get @system
    if [[ -n "${CI_SYSTEM:-}" ]]; then
        context="{{ name }}@{{ system }}"
    else
        context="{{ name }}"
    fi
    logfile="$logdir/${context}.log"
    logrel=".logs/${short_sha}/${context}.log"
    start=$SECONDS
    trap 'elapsed=$(( SECONDS - start )); just ci::_signoff "$context" failure "${user} · failed after ${elapsed}s · ${logrel}"' ERR
    just ci::_signoff "$context" pending "${user} · running"
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
    # Compute max width from all contexts (+2 for icon+space)
    max_len=$(just ci::_contexts | awk '{ if (length > m) m = length } END { print m + 2 }')
    # Build plain label, pad it, then colorize
    label="{{ name }}@${icon} {{ system }}"
    pad_len=$(( max_len - ${#label} ))
    trailing=$(printf "%${pad_len}s" "" 2>/dev/null || echo "")
    colored="${esc}[${name_color}m{{ name }}${esc}[0m@${esc}[${sys_color}m${icon} {{ system }}${esc}[0m${trailing}"
    if [[ "{{ system }}" == "{{ local_system }}" ]]; then
        echo "▶ ${colored}"
        (cd "{{ root }}" && {{ cmd }}) 2>&1 | tee "$logfile" | sed "s|^|[${colored}] |"
    else
        host=$(just ci::_host)
        echo "▶ ${colored} ($host)"
        tmp=$(ssh "$host" mktemp -d)
        trap 'ssh "$host" "rm -rf '"$tmp"'"; elapsed=$(( SECONDS - start )); just ci::_signoff "$context" failure "${user} · failed after ${elapsed}s · ${logrel}"' ERR
        # Clone full repo (not git archive) so remote has .git — needed for nix builds that read git revision
        git bundle create - --all 2>/dev/null | ssh "$host" "cat > $tmp/repo.bundle && git clone --quiet $tmp/repo.bundle $tmp/src && cd $tmp/src && git -c advice.detachedHead=false checkout --quiet {{ sha }}"
        ssh "$host" "cd $tmp/src && {{ cmd }}" 2>&1 | tee "$logfile" | sed "s|^|[${colored}] |"
        ssh "$host" "rm -rf $tmp"
    fi
    elapsed=$(( SECONDS - start ))
    just ci::_signoff "$context" success "${user} · ${elapsed}s · ${logrel}"

# Auto-extract step@system contexts from justfile structure.
# Auto-extract CI contexts from justfile structure.
# Multi-system steps: parsed from "CI_SYSTEM=<sys> just ci::<step> ..." lines → step@system
# Local-only steps: parsed from "just ci::<step>" lines (no CI_SYSTEM) → step (no @system suffix)
_contexts:
    #!/usr/bin/env bash
    set -euo pipefail
    just --dump --dump-format json | jq -r '
      .modules.ci.recipes as $r
      # Expand a recipe name to its externally-visible step names.
      # Underscore-prefixed recipes (e.g. _linux-fanout) are internal helpers,
      # not CI contexts — replace them with their dependencies, recursively.
      | def expand:
          if startswith("_") then
            [ $r[.].dependencies[]?.recipe | expand ] | add // []
          else [.] end;
      $r | to_entries[]
      | select(.key | startswith("_"))
      | .value.body[0][0] // "" as $first
      # Multi-system: CI_SYSTEM=<sys> just ci::<step> ...
      | if ($first | test("^CI_SYSTEM=")) then
          $first
          | capture("CI_SYSTEM=(?<system>[^ ]+) just (?<steps>.+?)( \\|\\| true)?$")
          | .system as $sys
          | ([ .steps | split(" ")[] | ltrimstr("ci::") | expand ] | add // [])[]
          | . + "@" + $sys
        # Local-only: just ci::<step> ... (exclude internal _helpers)
        elif ($first | test("^just ci::[a-z]")) then
          $first
          | capture("just (?<steps>.+?)( \\|\\| true)?$")
          | ([ .steps | split(" ")[] | ltrimstr("ci::") | expand ] | add // [])[]
        else empty end'

# Print summary table of all CI statuses for the current sha
_summary:
    #!/usr/bin/env bash
    set -euo pipefail
    esc=$'\033'
    echo ""
    echo "━━━ CI Summary ({{ sha }}) ━━━"
    # Fetch all statuses once
    all_statuses=$(gh api "repos/{{ repo }}/statuses/{{ sha }}" --jq '
      [.[] | select(.context | startswith("ci/"))]
      | group_by(.context)
      | map(max_by(.updated_at))
      | .[] | {(.context): .state}' 2>/dev/null | jq -s 'add // {}')
    failed=0
    while IFS= read -r ctx; do
        context="ci/$ctx"
        state=$(echo "$all_statuses" | jq -r ".\"$context\" // \"not run\"")
        case "$state" in
            success) symbol="${esc}[32m✓${esc}[0m" ;;
            failure) symbol="${esc}[31m✗${esc}[0m"; failed=1 ;;
            pending) symbol="${esc}[33m●${esc}[0m" ;;
            *)       symbol="${esc}[90m-${esc}[0m"; failed=1 ;;
        esac
        printf "  %b  %-30s %s\n" "$symbol" "$ctx" "$state"
    done <<< "$(just ci::_contexts)"
    echo ""
    if [[ "$failed" -eq 1 ]]; then
        echo "${esc}[31mCI FAILED${esc}[0m"
        exit 1
    else
        echo "${esc}[32mCI PASSED${esc}[0m"
    fi

# Build all flake outputs via devour-flake
_devour-flake name +args:
    just ci::_run "{{ name }}" nix build github:srid/devour-flake -L --no-link --print-out-paths {{ args }}

# Set up branch protection requiring all CI status checks.
# Contexts are auto-derived from justfile — no prior CI run needed.
protect branch=`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`:
    #!/usr/bin/env bash
    set -euo pipefail
    contexts=$(just ci::_contexts)
    echo "Setting required status checks on {{ branch }}:"
    args=()
    while IFS= read -r ctx; do
        full="ci/$ctx"
        echo "  - $full"
        args+=(-f "required_status_checks[checks][][context]=$full")
    done <<< "$contexts"
    gh api "repos/{{ repo }}/branches/{{ branch }}/protection" -X PUT \
      -F "required_status_checks[strict]=true" \
      "${args[@]}" \
      -F "enforce_admins=false" \
      -F "restrictions=null" \
      -F "required_pull_request_reviews=null" \
      --silent
    echo "Done — {{ branch }} now requires CI to pass."
