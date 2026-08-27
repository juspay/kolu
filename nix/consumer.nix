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
#   pins         — the members kolu CANNOT ship you (gitignored pin grafts),
#                  each as { name; revision; subdir } — the pin to add, the
#                  revision to add it AT, and the subdirectory to copy. Pass each
#                  back as `pinnedSources.<name> = { src; revision; }`; a
#                  revision that disagrees with kolu's is refused at eval, which
#                  is what retires the per-consumer script that used to hold the
#                  two pins in step.
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

  # NO schemaVersion GATE, deliberately. This file and `consumer-closure.json`
  # ship in the SAME pin — a consumer imports "${koluSrc}/nix/consumer.nix",
  # which reads `./consumer-closure.json` from that same store path — so reader
  # and artifact can never come from different revisions and the comparison can
  # never be false. A guard that cannot fail is worse than no guard: it reads as
  # one, and its advice ("pin an older kolu") names a situation that cannot
  # arise. A mis-shaped artifact still fails loudly and by name, in `memberOf`
  # and in `sourceFor`. If a consumer ever VENDORS its own copy of this file,
  # reader and artifact come apart and the gate becomes real — add it back then,
  # naming that consumer.
  #
  # THE OTHER READER, since this file invites one: `dirs` and `pins` are exported
  # precisely so a consumer can build its own copier, and nix/README.md describes
  # the artifact in its own right — so a consumer parsing `consumer-closure.json`
  # directly is a reader that does not ship with this file. The same reasoning
  # still covers it: it reads the JSON out of the kolu pin it already fetched, so
  # its reader and its artifact are one revision too. What would break that is a
  # consumer COPYING the JSON into its own tree and reading it across a later
  # bump — the same vendoring case as above, and the same answer.

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

  # PINNED members are not in `src` at all — see `pin` in consumer-closure.json.
  # `osfacts-client` is the standing case: gitignored, grafted from kolu's own
  # npins `osfacts` pin, and therefore absent from the archive a consumer
  # fetches. Emitting a copy out of `src` for it would build a derivation that
  # cannot build, from the very seed list this file documents. So the consumer
  # supplies it, and a missing one is a NAMED throw at eval rather than a
  # `cp: cannot stat` several minutes into a build.
  #
  # It arrives as a RECORD — `{ src; revision; }` — and not as a bare path,
  # because a store path carries no revision and the revision is the half that
  # matters. The consumer grafts these bytes and then compiles them against
  # packages copied from KOLU: two revisions of one package in one `tsc`, which
  # typechecks right up until a field moves. Consumers were holding that pairing
  # by hand, one shell script per repo, each jq-ing kolu's INTERNAL
  # `npins/sources.json` — a file layout kolu never promised to keep. kolu knows
  # its own revision, so it says so, and disagreement is refused here.
  sourceFor = name:
    let member = memberOf name; in
    if member ? pin then
      (if builtins.hasAttr name pinnedSources then
        (builtins.getAttr name pinnedSources).src
      else throw ''
        kolu/nix/consumer.nix: '${name}' is a PINNED member — gitignored in kolu and
        absent from the source archive you fetched, so this entry point cannot copy it
        out of `src`. Graft it from `${member.pin.name}` at ${member.pin.revision}
        (subdirectory `${member.pin.subdir}`) and pass it in:

          pinnedSources."${name}" = {
            src = yourGraftedSrc;
            revision = (import ./npins).${member.pin.name}.revision;
          };

        The revision is checked against kolu's, so the pin you add and the pin kolu
        was built against cannot drift apart unnoticed.
      '')
    else "${src}/${member.dir}";

  pinnedInClosure = builtins.filter (name: (memberOf name) ? pin) names;

  # THE SPLIT: what you PASSED is checked eagerly; what you did NOT pass is
  # checked where it is needed.
  #
  # An entry that disagrees with kolu is wrong no matter which output you read,
  # so it is refused at the doorstep — asserted below rather than inside
  # `sourceFor`, because this file exports `dirs` and `pins` precisely so a
  # consumer can build its own copier and never take the `drvFor` path. A lazy
  # drift check would miss exactly that consumer, which is the one this replaces
  # a shell script for.
  #
  # A MISSING entry is the other way round and stays lazy, in `sourceFor`. Not
  # every caller is hydrating: nix/README.md's own closure-size diagnostic reads
  # `.names` for a seed list and copies nothing, and a reader asking "how big is
  # this closure" owes no pin for an answer that has no bytes in it. The first
  # draft asserted this half eagerly too and broke that documented one-liner —
  # while carrying a comment that said it did not. A comment describing a guard
  # is a guard's worst substitute; the split is the guard.
  pinnedProblems = builtins.concatMap
    (name:
      let given = builtins.getAttr name pinnedSources; in
      if !(builtins.elem name pinnedInClosure) then [ ''
        '${name}' — the closure for your seeds does not pin it. Either it left your
        closure or this kolu no longer grafts it: drop the entry, and if it was your
        only reason for a second pin, drop the pin and the guard you wrote to hold
        the two in step.
      '' ]
      else if !(builtins.isAttrs given && given ? src && given ? revision) then [ ''
        '${name}' — must be `{ src = <store path>; revision = <string>; }`. A bare
        store path carries no revision, and the revision is the half this file checks.
      '' ]
      else if given.revision != (memberOf name).pin.revision then [ ''
        '${name}' — kolu pins `${(memberOf name).pin.name}` at
        ${(memberOf name).pin.revision}, and you pass ${toString given.revision}.
        This member is not in kolu's archive: kolu grafts it from that pin and you
        graft it from yours, and then your `tsc` compiles the two against each
        other. Move yours to kolu's — that is what re-pinning kolu always owes.
      '' ]
      else [ ])
    (builtins.attrNames pinnedSources);

  _pinnedOk =
    if pinnedProblems == [ ] then true
    else throw ''
      kolu/nix/consumer.nix: this consumer's pinned sources do not match kolu's.

        ${builtins.concatStringsSep "\n        " pinnedProblems}
    '';

  # A `catalog:` external is unresolvable OUTSIDE kolu — it is pnpm's
  # workspace-catalog protocol, and the catalog lives in kolu's own
  # `pnpm-workspace.yaml`. Emitting one into `externals` would hand a consumer a
  # range its resolver cannot understand, and a dependency guard that compares
  # ranges literally fails on it with no clue which package is at fault. kolu's
  # `effectPin` gate requires literal versions across the VENDORED closure, so
  # this can only fire for a package that has not been brought across that
  # boundary yet — which is a real state (`@kolu/xterm-kit`, 2026-08) and worth
  # naming rather than propagating.
  catalogOffenders = builtins.concatMap
    (name:
      let m = memberOf name; in
      map (dep: "${name} → ${dep}")
        (builtins.filter (dep: m.external.${dep} == "catalog:")
          (builtins.attrNames m.external)))
    names;

  _catalogOk =
    if catalogOffenders == [ ] then true
    else throw ''
      kolu/nix/consumer.nix: the closure for these seeds reaches a package whose
      manifest declares a `catalog:` dependency, which resolves only inside kolu's
      own pnpm workspace:

        ${builtins.concatStringsSep "\n        " catalogOffenders}

      That package is not yet set up to be consumed outside kolu. Adopting it means
      adding it to packages/tests/governance/vendorEntries.ts and replacing
      `catalog:` with a literal version across its closure (kolu's effectPin gate
      then keeps it that way). See that package's README.
    '';

  drvFor = name:
    pkgs.runCommand (slugOf name)
      {
        meta = {
          description = "${name} source extracted from juspay/kolu";
          homepage = "https://github.com/juspay/kolu";
        };
      }
      "cp -r ${sourceFor name} $out";

  # An empty seed list walks to an empty closure, passes every assert, and emits
  # an empty `hydrateArgs` — so the copier dies at RUNTIME with a usage error
  # instead of here, where the mistake is. A consumer asking for nothing is
  # always a mistake; the honest answer is to say so at eval.
  # A SEED must be a package kolu supports being consumed from outside — i.e. a
  # declared `vendorEntries.ts` entry or something in its closure. Being in that
  # set is what puts a manifest under the literal-version gate; outside it,
  # `catalog:`-freeness is a coincidence, so a package that resolves today can
  # break at a pin bump the consumer did not make.
  #
  # Gating SEEDS, not the closure: reaching an unvendored member transitively is
  # kolu's business, but seeding one is a consumer saying "I import this", and
  # that is the claim kolu has to be able to honour. The `catalog:` refusal below
  # stays as the second net for the transitive case.
  unvendoredSeeds = builtins.filter (name: !((memberOf name).vendored or false)) seeds;

  _vendoredOk =
    if unvendoredSeeds == [ ] then true
    else throw ''
      kolu/nix/consumer.nix: these seeds are not packages kolu supports consuming
      from outside:

        ${builtins.concatStringsSep "\n        " unvendoredSeeds}

      Only the entries declared in packages/tests/governance/vendorEntries.ts and
      their closure are held to literal dependency versions by kolu's own gates.
      A package outside that set may resolve today and stop resolving at a pin
      bump you did not make. To adopt one, add it there — see nix/README.md.
    '';

  _seedsOk =
    if seeds != [ ] then true
    else throw "kolu/nix/consumer.nix: `seeds` is empty — name the packages you import.";

in
assert _seedsOk;
assert _vendoredOk;
assert _pinnedOk;
assert _catalogOk; {
  inherit names;

  # The members this entry point CANNOT copy out of `src` — gitignored grafts —
  # each with the pin, revision and subdirectory to graft it from. Exported
  # because a consumer that builds its own copier off `dirs` needs to know which
  # entries are not there, and because the revision is the fact its own npins pin
  # has to match. The `_pinnedOk` assert above already refuses a mismatch, so
  # this is for a consumer that wants to READ kolu's answer rather than be told
  # it was wrong — the shape `npins add --at <revision>` takes.
  pins = builtins.listToAttrs
    (map (name: { inherit name; value = (memberOf name).pin; }) pinnedInClosure);

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
