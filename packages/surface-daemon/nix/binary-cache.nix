# The binary-cache declaration an agent source carries — derived from a flake's
# OWN `nixConfig`, so the caches provisioning fetches from are exactly the ones
# a manual `nix build --accept-flake-config <src>#…` would honor. One
# implementation, two callers: `mkProvenAgentSource` (the full proven agent
# tree) and any consumer that bakes a flake-shaped source directly (the
# `@kolu/surface` examples).
#
# `@kolu/surface-remote` reads the emitted `binary-cache.json` on every dial and
# REFUSES a source without it, so absence must fail at the binder's eval — not
# at dial time on a user's machine. That is why `require` throws rather than
# defaulting: a cache-blind agent source is unspellable, per the repo's
# fail-fast rule (no fallbacks, no knobs).
#
# Both flake spellings normalize: `nixConfig` values may be a space-separated
# string (the common form) or a list.
{ lib }:
{ flakeNix # path of the flake whose nixConfig declares the caches
, label ? "mkAgentBinaryCache" # caller name, for the eval-time error
}:
let
  cfg = (import flakeNix).nixConfig or null;
  asList = v:
    if builtins.isList v
    then builtins.filter (s: s != "") v
    else builtins.filter (s: s != "") (lib.splitString " " v);
  require = name:
    let value = if cfg == null || !(cfg ? ${name}) then [ ] else asList cfg.${name};
    in
    if value == [ ]
    then
      throw
        ("${label}: ${toString flakeNix} must declare a non-empty "
          + "nixConfig.${name} — @kolu/surface-remote provisioning fetches the "
          + "agent closure from the caches baked into binary-cache.json and refuses "
          + "an agent source without them")
    else value;
in
{
  substituters = require "extra-substituters";
  trustedPublicKeys = require "extra-trusted-public-keys";
}
