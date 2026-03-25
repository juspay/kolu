# Reusable CI library — pure just + gh + ssh.
# Expects the importer to define: sha, repo, system, local_system

# Post GitHub commit status
@_signoff name status:
    gh api "repos/{{ repo }}/statuses/{{ sha }}" \
      -f state="{{ status }}" -f context="ci/{{ name }}" --silent

# Assert worktree is clean and HEAD matches expected sha
@_guard:
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
@_host:
    #!/usr/bin/env bash
    set -euo pipefail
    config=".ci.json"
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
        {{ cmd }} 2>&1 | grep -v $'\033\\]' | sed "s|^|[${prefix}${padding}] |"
    else
        host=$(just ci::_host)
        echo "▶ ${prefix} ($host)"
        tmp=$(ssh "$host" mktemp -d)
        trap 'ssh "$host" "rm -rf '"$tmp"'"; just ci::_signoff "{{ name }}@{{ system }}" failure' ERR
        # Clone full repo (not git archive) so remote has .git — needed for nix builds that read git revision
        git bundle create - --all | ssh "$host" "cat > $tmp/repo.bundle && git clone $tmp/repo.bundle $tmp/src && cd $tmp/src && git checkout {{ sha }}"
        ssh "$host" "cd $tmp/src && {{ cmd }}" 2>&1 | grep -v $'\033\\]' | sed "s|^|[${prefix}${padding}] |"
        ssh "$host" "rm -rf $tmp"
    fi
    just ci::_signoff "{{ name }}@{{ system }}" success

# Build all flake outputs via devour-flake. Sub-flakes (path != ".") get --override-input flake/kolu .
_devour-flake name path:
    #!/usr/bin/env bash
    set -euo pipefail
    args="--override-input flake {{ path }}"
    if [[ "{{ path }}" != "." ]]; then
        args="$args --override-input flake/kolu ."
    fi
    just ci::_run "{{ name }}" nix build github:srid/devour-flake -L --no-link --print-out-paths $args
