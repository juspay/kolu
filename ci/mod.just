# Kolu CI steps
#
# These recipes run on the current system only. Multi-system routing and
# parallelism are handled by GitHub Actions (.github/workflows/ci.yaml).
# Run `just ci` locally to debug a failing GHA job.

root := `git rev-parse --show-toplevel`
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop path:' + root + ' -c' }

[parallel]
default: fmt typecheck unit apm-sync nix

nix:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake "{{ root }}"

home-manager: nix
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake "{{ root }}/nix/home/example" --override-input flake/kolu "{{ root }}"

typecheck:
    cd "{{ root }}" && just check

# On headless Linux (NixOS CI runners), Playwright's Chromium needs a
# virtual framebuffer. xvfb-run wraps the test command with one.
e2e: nix
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{ root }}"
    if [[ "$(uname)" == "Linux" && -z "${DISPLAY:-}" ]]; then
        exec {{ nix_shell }} xvfb-run --auto-servernum just test
    else
        just test
    fi

# Run vitest unit tests (server + client)
unit:
    cd "{{ root }}" && just test-unit

# Verify vendored .claude/ matches .apm/ sources + security audit
apm-sync:
    cd "{{ root }}" && {{ nix_shell }} just ai::apm-sync

fmt:
    cd "{{ root }}" && just fmt-check
