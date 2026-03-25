# Reusable CI library — pure just + gh + ssh.
# Expects the importer to define: sha, repo, system, local_system, root, systems (space-separated)

# Resolve all SSH hosts before running steps (prompts user if unconfigured)
_preflight:
    #!/usr/bin/env bash
    set -euo pipefail
    for sys in {{ systems }}; do
        if [[ "$sys" != "{{ local_system }}" ]]; then
            CI_SYSTEM="$sys" just ci::_host > /dev/null
        fi
    done

# Post GitHub commit status
_signoff name status:
    gh api "repos/{{ repo }}/statuses/{{ sha }}" \
      -f state="{{ status }}" -f context="ci/{{ name }}" --silent

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
_run name +cmd:
    #!/usr/bin/env bash
    set -euo pipefail
    just ci::_guard
    trap 'just ci::_signoff "{{ name }}@{{ system }}" failure' ERR
    just ci::_signoff "{{ name }}@{{ system }}" pending
    esc=$'\033'
    name_color=$((31 + $(printf '%s' '{{ name }}' | cksum | cut -d' ' -f1) % 6))
    sys_color=$((31 + $(printf '%s' '{{ system }}' | cksum | cut -d' ' -f1) % 6))
    # Ensure system color differs from name color
    if [[ "$sys_color" == "$name_color" ]]; then
        sys_color=$(( (sys_color - 31 + 3) % 6 + 31 ))
    fi
    if [[ "{{ system }}" == "{{ local_system }}" ]]; then
        icon="⌂"
    else
        icon="⇄"
    fi
    prefix="${esc}[${name_color}m{{ name }}${esc}[0m@${esc}[${sys_color}m${icon} {{ system }}${esc}[0m"
    # Pad with spaces to align (visible length: name + @ + icon + space + system = +2 for icon+space)
    visible="{{ name }}@x {{ system }}"
    padding=$(printf "%-$((26 - ${#visible}))s" "")
    if [[ "{{ system }}" == "{{ local_system }}" ]]; then
        echo "▶ ${prefix}"
        (cd "{{ root }}" && {{ cmd }}) 2>&1 | sed "s|^|[${prefix}${padding}] |"
    else
        host=$(just ci::_host)
        echo "▶ ${prefix} ($host)"
        tmp=$(ssh "$host" mktemp -d)
        trap 'ssh "$host" "rm -rf '"$tmp"'"; just ci::_signoff "{{ name }}@{{ system }}" failure' ERR
        # Clone full repo (not git archive) so remote has .git — needed for nix builds that read git revision
        git bundle create - --all 2>/dev/null | ssh "$host" "cat > $tmp/repo.bundle && git clone --quiet $tmp/repo.bundle $tmp/src && cd $tmp/src && git -c advice.detachedHead=false checkout --quiet {{ sha }}"
        ssh "$host" "cd $tmp/src && {{ cmd }}" 2>&1 | sed "s|^|[${prefix}${padding}] |"
        ssh "$host" "rm -rf $tmp"
    fi
    just ci::_signoff "{{ name }}@{{ system }}" success

# Print summary table of all CI statuses for the current sha
_summary:
    #!/usr/bin/env bash
    set -euo pipefail
    esc=$'\033'
    echo ""
    echo "━━━ CI Summary ({{ sha }}) ━━━"
    statuses=$(gh api "repos/{{ repo }}/statuses/{{ sha }}" --jq '
      [.[] | select(.context | startswith("ci/"))]
      | group_by(.context)
      | map(max_by(.updated_at))
      | sort_by(.context)
      | .[] | [.context, .state] | @tsv')
    failed=0
    while IFS=$'\t' read -r context state; do
        case "$state" in
            success) symbol="${esc}[32m✓${esc}[0m" ;;
            failure) symbol="${esc}[31m✗${esc}[0m"; failed=1 ;;
            pending) symbol="${esc}[33m●${esc}[0m" ;;
            *)       symbol="?" ;;
        esac
        # Strip "ci/" prefix for display
        name="${context#ci/}"
        printf "  %b  %-30s %s\n" "$symbol" "$name" "$state"
    done <<< "$statuses"
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
