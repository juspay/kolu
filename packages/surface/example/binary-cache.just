# The dev-path binary-cache sidecar, shared by every @kolu/surface example.
#
# A Nix-built example binder gets the sidecar baked into its agent-source; a
# `just run` / `just dev` from the WORKING TREE points the agent ref at
# `packages/surface/example` instead, so the file has to exist there too.
#
# `import`ed by the example justfiles rather than shelled out to, so `just` owns
# the ordering: the recipe is a real prerequisite of the recipes that dial
# (`run: install binary-cache`), visible to `just --dry-run` and impossible for
# a new dev entry point to forget by not copying a line.

# Write the sidecar every agent dial reads, DERIVED from the example flake's own
# nixConfig (the single source of truth — see surface-daemon/nix/binary-cache.nix,
# which owns the serialization too). Generated, hence gitignored — never hand-edited.
[no-cd]
binary-cache:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ source_directory() }}
    nix eval --impure --raw --expr \
      "(import ../../surface-daemon/nix/binary-cache.nix \
         { lib = (import ../../../nix/nixpkgs.nix {}).lib; } \
         { flakeNix = ./flake.nix; label = \"surface examples\"; }).json" \
      > binary-cache.json
