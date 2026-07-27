# mkAgentSourceTree — the ONE place that knows what a baked agent source tree
# LOOKS like: a copy of a source tree, made writable, with `flake.nix` at the
# root, the derived binary-cache sidecar beside it, and whatever extra root
# files the caller bakes on top (kolu's agents add `commit-hash`).
#
# Split out of `agent-source.nix` because it has two producers, not one:
# `mkProvenAgentSource` (prove ∘ assemble, for a binder shipping real agents)
# and the `@kolu/surface` example flake (assemble only, from its own source).
# Before the split, "copy a tree and drop the sidecar on it" was written twice
# and a layout change — a second sidecar, a version marker — meant editing both.
# `mkProvenAgentSource` is now literally prove-then-this, so the two cannot
# disagree about the layout.
{ lib }:
{ pkgs
, name ? "agent-flake-source" # derivation name
, src # the tree to copy in (a store path / pure source)
, flakeNix # path of the agent flake, copied to $out/flake.nix
, label # caller name, for the binary-cache eval-time error
, extraFiles ? { } # basename → contents, written on top of the copy
}:
let
  binaryCache = import ./binary-cache.nix { inherit lib; } {
    inherit flakeNix label;
  };
  writeExtra = lib.concatStringsSep "\n" (lib.mapAttrsToList
    (file: text: ''printf '%s' ${lib.escapeShellArg text} > "$out/${file}"'')
    extraFiles);
in
# Store sources are mode-readonly — chmod before writing anything on top.
pkgs.runCommand name { } ''
  mkdir -p "$out"
  cp -a ${src}/. "$out/"
  chmod -R u+w "$out"
  cp ${flakeNix} "$out/flake.nix"
  ${binaryCache.installToOut}
  ${writeExtra}
''
