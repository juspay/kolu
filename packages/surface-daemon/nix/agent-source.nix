# mkProvenAgentSource — assemble a pure agent-source tree and refuse to hand it
# out unless an agent package evaluates from it.
#
# The Nix half of "bake only what you can resolve": a remote host
# (`@kolu/surface-remote` → `resolveAgentDrv`) evaluates
#   <baked-source>#packages.<system>.padi
# (and siblings) from the store path a binder wrapper bakes. A *shallow* bake —
# copy files into a runCommand and never import them — lets the binder ship a
# tree that is missing a path the agent graph needs (e.g. osfacts after a
# port-scan consumer lands). The failure then surfaces at dial time on a remote
# host, not at the binder's `nix build`.
#
# This recipe makes the shallow bake unspellable. It:
#   1. Assembles the agent tree as a PURE eval-time source (`fileset.toSource`)
#      — importable without IFD, unlike a `runCommand` copy.
#   2. Imports that tree's `default.nix` and forces each named agent attr.
#      A missing path fails HERE, at the binder's evaluation, exactly like a
#      missing `pkgs.gh` reference — `nix build .#kolu` is the gate; no CI
#      glue required (CI already builds the binder on every platform).
#
# Location is structure: this lives next to `daemon-identity.nix` inside
# `@kolu/surface-daemon`, so kolu today and drishti tomorrow cannot hand out an
# agent-source bundle the framework has not evaluated an agent from. The
# *contents* of the fileset (which packages, which root files) remain the
# consumer's policy; the assemble-and-prove *composition* is the electricity.
#
# `flakeNix` + `commitHash` are the thin flake veneer remote `nix eval <ref>#…`
# needs (`flake.nix` at the store-path root + the commit-hash file the agent
# flake reads). They are packaged as a derivation only AFTER the pure prove
# step; the prove itself never imports through that derivation (no IFD).
{ lib }:
{ root              # fileset.toSource root (common ancestor of `fileset`)
, fileset           # WHAT goes into the agent tree — the consumer's policy
, pkgs
, commitHash        # navigable git ref passed into the nested default.nix
, agents            # agent attr names to prove (e.g. [ "padi" "kaval" ])
, flakeNix          # path of the agent flake (copied to $out/flake.nix)
}:
let
  # Pure: store path changes iff any selected file changes; importable at eval.
  tree = lib.fileset.toSource { inherit root fileset; };

  # Deep prove: evaluate each agent from the assembled tree. Lazy let-bindings
  # inside the nested default.nix mean this forces only the agent graphs — not
  # a recursive re-prove of THIS helper (the nested `agentFlakeSrc` thunk is
  # never selected by `.padi` / `.kaval`).
  nested = import "${tree}/default.nix" { inherit pkgs commitHash; };
  proven = lib.genAttrs agents (name: nested.${name});

  # Force every proven agent before handing out any bake path. `deepSeq` walks
  # the attrset values; a missing path aborts evaluation here.
  provenTree = builtins.seq (builtins.deepSeq proven null) tree;

  # Flake-shaped store path for SURFACE_AGENT_FLAKE_REF. Built from the already-
  # proven pure tree; never the place the prove happens.
  flakeSrc = pkgs.runCommand "agent-flake-source" { } ''
    mkdir -p "$out"
    cp -a ${provenTree}/. "$out/"
    cp ${flakeNix} "$out/flake.nix"
    printf '%s' ${lib.escapeShellArg commitHash} > "$out/commit-hash"
  '';
in
{
  # Pure tree (proven). Useful for further pure imports / debugging.
  src = provenTree;
  # What binders bake onto wrappers — flake-shaped, proven-complete.
  inherit flakeSrc proven;
}
