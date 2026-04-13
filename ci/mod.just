# Kolu CI steps
#
# These recipes run on the current system only. Multi-system routing and
# parallelism are handled by GitHub Actions (.github/workflows/ci.yaml).
# Run `just ci` locally to debug a failing GHA job.

root := `git rev-parse --show-toplevel`

[parallel]
default: fmt typecheck unit apm-sync nix

nix:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake "{{ root }}"

home-manager: nix
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake "{{ root }}/nix/home/example" --override-input flake/kolu "{{ root }}"

typecheck:
    cd "{{ root }}" && just check

e2e: nix
    cd "{{ root }}" && just test

# Run vitest unit tests (server + client)
unit:
    cd "{{ root }}" && just test-unit

# Verify vendored .claude/ matches .apm/ sources + security audit
apm-sync:
    cd "{{ root }}" && just ai::apm-sync

fmt:
    cd "{{ root }}" && just fmt-check
