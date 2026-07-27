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
#
# `binary-cache.json` is the third baked file, and it is NOT optional: the
# provisioning stack (`@kolu/surface-remote`) prefetches the agent closure into
# the binder's local store from the caches named here before realising on a
# target, so a host whose own nix.conf has never heard of the cache still
# receives binaries instead of compiling. The declaration is DERIVED from the
# agent flake's own `nixConfig` (one source of truth — the same block a manual
# `nix build --accept-flake-config <flakeSrc>#…` would honor); a flakeNix
# without `nixConfig.extra-substituters` + `extra-trusted-public-keys` fails
# THIS eval, at the binder's `nix build`, so a consumer (kolu, drishti, odu)
# cannot assemble an agent source that leaves provisioning cache-blind.
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
  proven = lib.listToAttrs (map (name: {
    inherit name;
    value = nested.${name};
  }) agents);
  provenDrvPaths = map (name: nested.${name}.drvPath) agents;

  # Force every proven agent before handing out any bake path.
  provenTree = builtins.seq (builtins.deepSeq provenDrvPaths null) tree;

  # The binary-cache declaration, derived from the agent flake's own nixConfig
  # (see the header). Values may be a space-separated string (the common flake
  # spelling) or a list; both normalize to a non-empty list here. Absence is an
  # eval-time error — never a silently cache-blind agent source.
  binaryCache =
    let
      cfg = (import flakeNix).nixConfig or null;
      asList = v:
        if builtins.isList v
        then v
        else builtins.filter (s: s != "") (lib.splitString " " v);
      require = name:
        if cfg == null || !(cfg ? ${name}) || asList cfg.${name} == [ ]
        then
          throw
            ("mkProvenAgentSource: ${toString flakeNix} must declare a non-empty "
              + "nixConfig.${name} — @kolu/surface-remote provisioning prefetches the "
              + "agent closure from the caches baked into binary-cache.json and refuses "
              + "an agent source without them")
        else asList cfg.${name};
    in
    {
      substituters = require "extra-substituters";
      trustedPublicKeys = require "extra-trusted-public-keys";
    };

  # Flake-shaped store path for SURFACE_AGENT_FLAKE_REF. Built from the already-
  # proven pure tree; never the place the prove happens. Store sources are
  # mode-readonly — chmod before writing flake.nix / commit-hash on top.
  flakeSrc = pkgs.runCommand "agent-flake-source" { } ''
    mkdir -p "$out"
    cp -a ${provenTree}/. "$out/"
    chmod -R u+w "$out"
    cp ${flakeNix} "$out/flake.nix"
    printf '%s' ${lib.escapeShellArg commitHash} > "$out/commit-hash"
    printf '%s' ${lib.escapeShellArg (builtins.toJSON binaryCache)} > "$out/binary-cache.json"
  '';
in
{
  # Pure tree (proven). Useful for further pure imports / debugging.
  src = provenTree;
  # What binders bake onto wrappers — flake-shaped, proven-complete.
  inherit flakeSrc proven;
}
