# CI steps — pure just + gh, no external CI tool needed.

sha := `git rev-parse HEAD`
repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`

default: nix nix-home-example e2e

# Post GitHub commit status
_signoff name status:
    gh api "repos/{{ repo }}/statuses/{{ sha }}" \
      -f state="{{ status }}" -f context="ci/{{ name }}" --silent

# Run command with GitHub status lifecycle (pending → success/failure)
_run name +cmd:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'just ci::_signoff "{{ name }}" failure' ERR
    just ci::_signoff "{{ name }}" pending
    {{ cmd }}
    just ci::_signoff "{{ name }}" success

nix:
    just ci::_run nix nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .

nix-home-example: nix
    just ci::_run nix/home nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake ./nix/home/example --override-input flake/kolu .

e2e: nix
    just ci::_run e2e just test
