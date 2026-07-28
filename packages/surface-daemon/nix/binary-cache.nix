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
# Both flake spellings normalize on BOTH axes: `nixConfig` values may be a
# space-separated string (the common form) or a list, and nix honors
# `substituters` / `extra-substituters` (and the `trusted-public-keys` pair)
# alike. A flake that REPLACES rather than appends the default cache list
# writes the non-`extra-` spelling, and it is just as valid a declaration.
{ lib }:
{ flakeNix # path of the flake whose nixConfig declares the caches
, label # caller name, for the eval-time error
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
          + "nixConfig.${lib.concatStringsSep " (or nixConfig." names}) "
          + "— @kolu/surface-remote provisioning fetches the agent closure from "
          + "the caches baked into ${fileName} and refuses an agent source "
          + "without them")
    else lib.unique value;

  fileName = (lib.importJSON ../../surface-remote/agent-env.json).binaryCacheFile;
in
rec {
  substituters = require [ "extra-substituters" "substituters" ];
  trustedPublicKeys = require [ "extra-trusted-public-keys" "trusted-public-keys" ];

  # The wire form, and the ONE way to write it. `installToOut` is spliced into a
  # `runCommand` that has `$out` in scope; `json` is what a non-derivation
  # writer (the examples' dev-path justfile) evaluates.
  inherit fileName;
  json = builtins.toJSON { inherit substituters trustedPublicKeys; };
  installToOut = ''printf '%s' ${lib.escapeShellArg json} > "$out/${fileName}"'';
}
