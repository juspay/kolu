# The CONSUMER ENTRY — what an out-of-repo repo needs to hydrate a set of kolu
# packages, derived from a SEED list.
#
# A consumer (olai, odu, drishti) does not `npm install` kolu: it copies package
# DIRECTORIES out of a content-addressed pin and resolves their imports from its
# own root `node_modules`. So it must copy the transitive closure of the
# manifests, not just the packages it imports. That closure is a fact this tree
# knows; consumers were re-deriving it BY HAND — one repo's list grew from 7 to
# 30 entries, one line at a time, each added by whoever hit the `TS2307` last.
#
# Here it is derived instead. You name the packages you actually IMPORT; this
# walks `consumer-closure.json` (emitted from every manifest in the tree, and
# gate-checked fresh by kolu's own governance run) and fills in the rest.
#
#   # nix/kolu.nix in a consumer
#   let koluSrc = (import ../npins).kolu;
#   in import "${koluSrc}/nix/consumer.nix" {
#     inherit pkgs;
#     src = koluSrc;
#     seeds = [ "@kolu/padi-client" "@kolu/solid-dockrow" "@kolu/surface-app" ];
#   }
#
# What comes back:
#
#   names        — every package in the closure, sorted. The list a consumer
#                  used to keep by hand.
#   dirs         — name → repo-relative source directory.
#   externals    — name → version range, for every NON-workspace dependency the
#                  closure declares. Cross-check against your own root manifest:
#                  a range you do not have installed is a resolution failure
#                  waiting to happen in your compiler, not in kolu's.
#   packages     — attrs `kolu-<slug>` → a realizable store path per member, so
#                  `nix build .#kolu-padi-client` gets you the exact tree the
#                  hydrate script copies.
#   overlay      — the same, as an overlay.
#   hydrateArgs  — the whole argv for `hydrateScript`, as one string. Both
#                  callers (the dev-shell `install` recipe and the build
#                  derivation) pass THIS, so neither re-lists the set.
#   hydrateScript— the canonical copier, from this same pin.
#
# `seeds` are package NAMES as their manifests spell them (`@kolu/padi-client`,
# `anyforge`, `kolu-common`) — not directory names. An unknown seed is an error,
# loudly: a typo that quietly hydrated nothing is a gate that passes vacuously.

{ pkgs, src, seeds, pinnedSources ? { } }:

let
  closure = builtins.fromJSON (builtins.readFile ./consumer-closure.json);

  members = closure.members;

  # The schema version is checked, not assumed: a consumer pinned to a kolu
  # whose artifact grew a different shape must fail here, where the message can
  # say so, rather than several `builtins.getAttr` calls later.
  _schemaOk =
    if closure.schemaVersion == 1 then true
    else throw ''
      kolu/nix/consumer.nix: consumer-closure.json is schemaVersion ${toString closure.schemaVersion},
      this reader understands 1. Update your kolu pin's consumer entry, or pin an older kolu.
    '';

  memberOf = name:
    if builtins.hasAttr name members then builtins.getAttr name members
    else throw ''
      kolu/nix/consumer.nix: '${name}' is not a kolu workspace package.
      Seeds are package NAMES as their manifests spell them. Known names:
      ${builtins.concatStringsSep ", " (builtins.attrNames members)}
    '';

  # Breadth-first over the workspace edges. `builtins.genericClosure` keys on the
  # package name, so a diamond (two seeds sharing a dependency) is visited once.
  walked = builtins.genericClosure {
    startSet = map (name: { key = name; }) seeds;
    operator = { key, ... }: map (dep: { key = dep; }) (memberOf key).workspace;
  };

  names = builtins.sort (a: b: a < b) (map ({ key, ... }: key) walked);

  # `@kolu/padi-client` → `kolu-padi-client`; `kolu-common` → `kolu-common`.
  # A flat, derivation-safe slug per member, stable across releases so a
  # consumer's `nix build .#kolu-<slug>` keeps working.
  slugOf = name:
    let stripped = pkgs.lib.removePrefix "@kolu/" name;
    in if stripped == name then name else "kolu-${stripped}";

  # PINNED members are not in `src` at all — see `pinned` in
  # consumer-closure.json. `osfacts-client` is the standing case: gitignored,
  # grafted from its own npins pin, and therefore absent from the archive a
  # consumer fetches. Emitting a copy out of `src` for it would build a
  # derivation that cannot build, from the very seed list this file documents.
  # So the consumer supplies it — exactly as `@kolu/padi-client`'s hydrate guard
  # already says it must — and a missing one is a NAMED throw at eval rather
  # than a `cp: cannot stat` several minutes into a build.
  sourceFor = name:
    let member = memberOf name; in
    if member.pinned or false then
      (if builtins.hasAttr name pinnedSources then
        builtins.getAttr name pinnedSources
      else throw ''
        kolu/nix/consumer.nix: '${name}' is a PINNED member — gitignored in kolu and
        absent from the source archive you fetched, so this entry point cannot copy it
        out of `src`. Graft it from its own pin and pass it in:

          pinnedSources = { "${name}" = yourGraftedSrc; };

        (drishti's nix/overlay.nix is the worked precedent for `osfacts-client`.)
      '')
    else "${src}/${member.dir}";

  drvFor = name:
    pkgs.runCommand (slugOf name)
      {
        meta = {
          description = "${name} source extracted from juspay/kolu";
          homepage = "https://github.com/juspay/kolu";
        };
      }
      "cp -r ${sourceFor name} $out";

in
assert _schemaOk; {
  inherit names;

  dirs = builtins.listToAttrs
    (map (name: { inherit name; value = (memberOf name).dir; }) names);

  # Merged across the closure. Two members declaring the same external at
  # different ranges is a fact about kolu's own tree, and kolu's Effect-pin gate
  # is what keeps that from happening for the pinned ones; this simply reports
  # the last writer rather than inventing a resolution policy a consumer's
  # package manager already owns.
  externals = builtins.foldl'
    (acc: name: acc // (memberOf name).external) { } names;

  packages = builtins.listToAttrs
    (map (name: { name = slugOf name; value = drvFor name; }) names);

  overlay = _final: _prev: builtins.listToAttrs
    (map (name: { name = slugOf name; value = drvFor name; }) names);

  hydrateArgs = builtins.concatStringsSep " "
    (builtins.concatMap (name: [ "${drvFor name}" name ]) names);

  hydrateScript = "${src}/scripts/hydrate-kolu-packages.sh";
}
