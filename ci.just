# CI steps — pure just + gh + ssh, no external CI tool needed.

sha := `git rev-parse HEAD`
repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`
system := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
local_system := `nix eval --raw --impure --expr builtins.currentSystem`

default:
    #!/usr/bin/env bash
    set -euo pipefail
    CI_SYSTEM=x86_64-linux just ci::nix-toplevel ci::nix-home ci::e2e
    CI_SYSTEM=aarch64-darwin just ci::nix-toplevel ci::e2e

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
# Routes to local exec or remote (git archive + ssh) based on system.
_run name +cmd:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'just ci::_signoff "{{ name }}@{{ system }}" failure' ERR
    just ci::_guard
    just ci::_signoff "{{ name }}@{{ system }}" pending
    esc=$'\033'
    color=$((31 + $(printf '%s' '{{ name }}' | cksum | cut -d' ' -f1) % 6))
    prefix=$(printf "%-24s" "{{ name }}@{{ system }}")
    if [[ "{{ system }}" == "{{ local_system }}" ]]; then
        echo "${esc}[${color}m▶ {{ name }}@{{ system }} (local)${esc}[0m"
        {{ cmd }} 2>&1 | sed "s|^|${esc}[${color}m[${prefix}]${esc}[0m |"
    else
        host=$(just ci::_host)
        echo "${esc}[${color}m▶ {{ name }}@{{ system }} (ssh: $host)${esc}[0m"
        tmp=$(ssh "$host" mktemp -d)
        trap 'ssh "$host" "rm -rf '"$tmp"'"; just ci::_signoff "{{ name }}@{{ system }}" failure' ERR
        # Bundle full repo (not git archive) so remote has .git — needed for nix builds that read git revision
        git bundle create - {{ sha }} | ssh "$host" "cd $tmp && git clone --single-branch /dev/stdin . && git checkout {{ sha }}"
        ssh "$host" "cd $tmp && {{ cmd }}" 2>&1 | sed "s|^|${esc}[${color}m[${prefix}]${esc}[0m |"
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

nix-toplevel:
    just ci::_devour-flake nix .

nix-home: nix-toplevel
    just ci::_devour-flake nix/home ./nix/home/example

e2e: nix-toplevel
    just ci::_run e2e just test
