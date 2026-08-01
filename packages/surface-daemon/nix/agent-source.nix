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
# **What `agents` may NOT name.** The prove re-imports the assembled tree's own
# `default.nix`, so an attr that transitively references *this helper's* own
# `flakeSrc` re-enters the prove and stack-overflows. A consumer with such an
# attr (kolu's `padi-agent` — a closure whose members bake the flake ref) exposes
# it from the agent flake WITHOUT proving it, and proves the daemon graph that
# closure is composed out of instead. The rule is a property of this mechanism,
# not of any consumer's manifest, so it is stated here — where the next consumer
# meets it before rediscovering it as a stack overflow.
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
#
# The binary-cache sidecar is the third baked file, and it is NOT optional: the
# provisioning stack (`@kolu/surface-remote`) prefetches the agent closure into
# the binder's local store from the caches named here before realising on a
# target, so a host whose own nix.conf has never heard of the cache still
# receives binaries instead of compiling. The declaration is DERIVED from the
# agent flake's own `nixConfig` (one source of truth — the same block a manual
# `nix build --accept-flake-config <flakeSrc>#…` would honor); a flakeNix
# declaring no substituters + trusted keys fails THIS eval, at the binder's
# `nix build`, so a consumer (kolu, drishti, odu) cannot assemble an agent
# source that leaves provisioning cache-blind. Both the derivation of that
# declaration (`binary-cache.nix`) and the assembly of the tree it lands in
# (`agent-source-tree.nix`) are shared recipes — see those files.
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

  # Deep prove: evaluate each agent's .drvPath from the assembled tree — the
  # same force surface-remote uses (`nix eval …#padi.drvPath`). Lazy let-bindings
  # inside the nested default.nix mean this forces only the agent graphs — not
  # a recursive re-prove of THIS helper (the nested `agentFlakeSrc` thunk is
  # never selected by `.padi` / `.kaval`). Force `.drvPath` strings, not a raw
  # `deepSeq` over the derivation attrsets: walking every drv attr can re-enter
  # the binder graph and stack-overflow once the missing-path errors are gone.
  nested = import "${tree}/default.nix" { inherit pkgs commitHash; };
  proven = lib.listToAttrs (map
    (name: {
      inherit name;
      value = nested.${name};
    })
    agents);
  provenDrvPaths = map (name: nested.${name}.drvPath) agents;

  # Force every proven agent before handing out any bake path.
  provenTree = builtins.seq (builtins.deepSeq provenDrvPaths null) tree;

  # Flake-shaped store path for SURFACE_AGENT_FLAKE_REF. Built from the already-
  # proven pure tree; never the place the prove happens. The LAYOUT (the copy,
  # the flake veneer, the derived binary-cache sidecar) belongs to the shared
  # `mkAgentSourceTree`, so this recipe is exactly prove-then-assemble and the
  # example flake's assemble-only bake cannot drift from it.
  flakeSrc = import ./agent-source-tree.nix { inherit lib; } {
    inherit pkgs flakeNix;
    src = provenTree;
    label = "mkProvenAgentSource";
    extraFiles = { "commit-hash" = commitHash; };
  };
in
{
  # Pure tree (proven). Useful for further pure imports / debugging.
  src = provenTree;
  # What binders bake onto wrappers — flake-shaped, proven-complete.
  inherit flakeSrc proven;
}
