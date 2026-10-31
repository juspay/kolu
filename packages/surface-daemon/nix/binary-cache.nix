# The binary-cache declaration an agent source carries — derived from a flake's
# OWN `nixConfig`, so the caches provisioning fetches from are exactly the ones
# a manual `nix build --accept-flake-config <src>#…` would honor. One
# implementation, two callers: `mkProvenAgentSource` (the full proven agent
# tree) and any consumer that bakes a flake-shaped source directly (the
# `@kolu/surface` examples).
#
# `@kolu/surface-remote` reads the emitted sidecar on every dial and REFUSES a
# source without it, so absence must fail at the binder's eval — not at dial
# time on a user's machine. That is why `require` throws rather than
# defaulting: a cache-blind agent source is unspellable, per the repo's
# fail-fast rule (no fallbacks, no knobs).
#
# The result carries the EMIT as well as the value (`fileName` / `json` /
# `installToOut`), so every writer goes through one expression instead of
# re-spelling `builtins.toJSON` + `escapeShellArg` + the file's name. The name
# itself comes from `agent-env.json`, the same cross-language registry the
# `SURFACE_AGENT_FLAKE_REF` env var rides — Nix writes the file, TypeScript
# reads it, and neither spells the literal.
#
# The sidecar also carries where the source's builds are PUBLISHED, content-
# addressed: `closureIndex = { repo, branch }` (a GitHub branch the
# `publish-closure` action writes `<rev>/<system>/<attr>.json` to), or `null`
# for a source that publishes none. REQUIRED, with no default — explicit
# absence, never a guessed index. `rawBase` is derived here, once, so nothing in
# TypeScript spells an index URL; `@kolu/surface-remote`'s `provisionAgent`
# reads it to let a host pull a published build itself, with no trust.
#
# HOW that first substituter is pushed is `pusher`, OPTIONAL and null by
# default: `{ kind = "attic"; }` (or null, which emits nothing — every
# declaration baked before the field existed) means the publisher derives an
# attic cache from the URL it always did; `{ kind = "odu"; bucket = "…"; }` names
# an odu cache bucket. The field is emitted ONLY when given, so a binder that
# does not set it bakes the byte-identical declaration it baked yesterday.
# Malformed values fail the binder's eval, like `closureIndex`.
#
# Both flake spellings normalize on BOTH axes: `nixConfig` values may be a
# space-separated string (the common form) or a list, and nix honors
# `substituters` / `extra-substituters` (and the `trusted-public-keys` pair)
# alike. A flake that REPLACES rather than appends the default cache list
# writes the non-`extra-` spelling, and it is just as valid a declaration.
{ lib }:
{ flakeNix # path of the flake whose nixConfig declares the caches
, label # caller name, for the eval-time error
, closureIndex # { repo, branch } the closures are published on, or null
, pusher ? null # { kind = "attic"; } | { kind = "odu"; bucket = "…"; } | null
}:
let
  cfg = (import flakeNix).nixConfig or null;
  # Trim as part of normalizing, so the baked value is exactly what nix is
  # handed later — a list entry written with stray whitespace would otherwise
  # survive into `binary-cache.json` and fail at `nix copy` looking like a miss.
  asList = v:
    let raw = if builtins.isList v then v else lib.splitString " " v;
    in builtins.filter (s: s != "") (map (s: lib.trim s) raw);
  # Union both live spellings of one setting; a flake may use either (or both).
  require = names:
    let
      value = lib.concatMap
        (name: if cfg == null || !(cfg ? ${name}) then [ ] else asList cfg.${name})
        names;
    in
    if value == [ ]
    then
      throw
        ("${label}: ${toString flakeNix} must declare a non-empty "
          + "${lib.concatMapStringsSep " or " (n: "nixConfig.${n}") names} "
          + "— @kolu/surface-remote provisioning fetches the agent closure from "
          + "the caches baked into ${fileName} and refuses an agent source "
          + "without them")
    else lib.unique value;

  fileName = (lib.importJSON ../../surface-remote/agent-env.json).binaryCacheFile;

  index =
    if closureIndex == null then null
    else
      assert lib.assertMsg
        (builtins.isAttrs closureIndex
          && builtins.isString (closureIndex.repo or null)
          && builtins.match "[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" closureIndex.repo != null
          && builtins.isString (closureIndex.branch or null)
          && closureIndex.branch != "")
        "${label}: closureIndex must be null or { repo = \"owner/name\"; branch = \"…\"; }";
      {
        inherit (closureIndex) repo branch;
        rawBase = "https://raw.githubusercontent.com/${closureIndex.repo}/${closureIndex.branch}";
      };

  # HOW the first substituter is pushed, or null for "nothing said" — which
  # emits no field at all, so a binder that never sets `pusher` bakes exactly
  # the declaration it baked before this option existed. Strict about the
  # shape: a misspelt key would otherwise be silently dropped and the publish
  # would go to a different cache than the one declared here.
  pusherValue =
    if pusher == null then null
    else
      assert lib.assertMsg
        (builtins.isAttrs pusher && builtins.elem (pusher.kind or null) [ "attic" "odu" ])
        "${label}: pusher must be null, { kind = \"attic\"; } or { kind = \"odu\"; bucket = \"…\"; }";
      if pusher.kind == "attic" then
        assert lib.assertMsg
          (builtins.attrNames pusher == [ "kind" ])
          "${label}: an attic pusher takes only its kind — { kind = \"attic\"; }";
        { kind = "attic"; }
      else
        assert lib.assertMsg
          (builtins.isString (pusher.bucket or null)
            && pusher.bucket != ""
            && builtins.attrNames pusher == [ "bucket" "kind" ])
          "${label}: an odu pusher needs exactly { kind = \"odu\"; bucket = \"…\"; }";
        { kind = "odu"; inherit (pusher) bucket; };
in
rec {
  substituters = require [ "extra-substituters" "substituters" ];
  trustedPublicKeys = require [ "extra-trusted-public-keys" "trusted-public-keys" ];

  # The wire form: a NAME and its CONTENTS, nothing about how they get written.
  # Both writers — `mkAgentSourceTree`'s derivation and the examples' dev-path
  # justfile — take these two values and use their own mechanism, so this stays
  # a pure value module with no `$out`-in-scope shell convention baked in.
  inherit fileName index;
  json = builtins.toJSON ({ inherit substituters trustedPublicKeys index; }
    // lib.optionalAttrs (pusherValue != null) { pusher = pusherValue; });
}
