# CI steps — pure just + gh, no external CI tool needed.

sha := `git rev-parse HEAD`
repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`

default: nix nix-home-example e2e

# Post GitHub commit status
_signoff name status:
    gh api "repos/{{ repo }}/statuses/{{ sha }}" \
      -f state="{{ status }}" -f context="ci/{{ name }}" --silent

# Run command with GitHub status lifecycle (pending → success/failure)
# Output is colored and prefixed with [name] for readability.
_run name +cmd:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'just ci::_signoff "{{ name }}" failure' ERR
    just ci::_signoff "{{ name }}" pending
    esc=$'\033'
    color=$((31 + $(printf '%s' '{{ name }}' | cksum | cut -d' ' -f1) % 6))
    prefix=$(printf "%-9s" "{{ name }}")
    {{ cmd }} 2>&1 | sed "s|^|${esc}[${color}m[${prefix}]${esc}[0m |"
    just ci::_signoff "{{ name }}" success

nix:
    just ci::_run nix nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .

nix-home-example: nix
    just ci::_run nix/home nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake ./nix/home/example --override-input flake/kolu .

e2e: nix
    just ci::_run e2e just test
