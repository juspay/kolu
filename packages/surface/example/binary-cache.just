# The dev-path binary-cache sidecar, shared by every @kolu/surface example.
#
# A Nix-built example binder gets the sidecar baked into its agent-source; a
# `just run` / `just dev` from the WORKING TREE points the agent ref at
# `packages/surface/example` instead, so the file has to exist there too.
#
# `import`ed by the example justfiles rather than shelled out to, so `just` owns
# the ordering: the recipe is a real prerequisite of the recipes that dial
# (`run: install binary-cache`), visible to `just --dry-run`.
#
# Both the NAME and the CONTENTS come out of the same expression the Nix-built
# path uses (surface-daemon/nix/binary-cache.nix, itself derived from the
# example flake's own nixConfig) — the recipe spells neither, so a rename in
# `agent-env.json` moves the Nix writer, the TS reader AND this one together.
# `lib` comes straight from the npins-pinned nixpkgs rather than an instantiated
# package set: this expression uses only string helpers, and instantiating
# nixpkgs (plus the repo overlay) would put seconds and an unrelated failure
# surface on every dev dial. Generated, hence gitignored — never hand-edited.

# The directory the dev path bakes as the agent source ref, and the one the
# sidecar is written into. `source_directory()` (this file's own directory, not
# the importer's) so every example agrees on one answer.
agent_source_dir := source_directory()

# Write the binary-cache sidecar every agent dial reads
[no-cd]
binary-cache:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ agent_source_dir }}
    # `<name>\n<json>` from one eval, so the two can never come from different
    # evaluations of a file that changed in between.
    out=$(nix eval --impure --raw --expr 'let d = import ../../surface-daemon/nix/binary-cache.nix
            { lib = import "${(import ../../../npins).nixpkgs}/lib"; }
            { flakeNix = ./flake.nix; label = "surface examples"; };
          in d.fileName + "\n" + d.json')
    printf '%s' "${out#*$'\n'}" > "${out%%$'\n'*}"
