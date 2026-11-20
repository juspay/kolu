{ pkgs, src, seeds, pinnedSources ? { } }:

let
  closure = builtins.fromJSON (builtins.readFile ./consumer-closure.json);

  members = closure.members;

  memberOf = name:
    if builtins.hasAttr name members then builtins.getAttr name members
    else
      throw ''
        kolu/nix/consumer.nix: '${name}' is not a kolu workspace package.
        Seeds are package NAMES as their manifests spell them. Known names:
        ${builtins.concatStringsSep ", " (builtins.attrNames members)}
      '';

  walked = builtins.genericClosure {
    startSet = map (name: { key = name; }) seeds;
    operator = { key, ... }: map (dep: { key = dep; }) (memberOf key).workspace;
  };

  names = builtins.sort (a: b: a < b) (map ({ key, ... }: key) walked);

  slugOf = name:
    let stripped = pkgs.lib.removePrefix "@kolu/" name;
    in if stripped == name then name else "kolu-${stripped}";

  requirePinnedSource = name: member:
    if builtins.hasAttr name pinnedSources then
      (builtins.getAttr name pinnedSources).src
    else
      throw ''
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
      '';

  sourceFor = name:
    let member = memberOf name; in
    if member ? pin then requirePinnedSource name member
    else "${src}/${member.dir}";

  pinnedInClosure = builtins.filter (name: (memberOf name) ? pin) names;

  pinnedProblems = builtins.concatMap
    (name:
      let given = builtins.getAttr name pinnedSources; in
      if !(builtins.elem name pinnedInClosure) then [
        ''
          '${name}' — the closure for your seeds does not pin it. Either it left your
          closure or this kolu no longer grafts it: drop the entry, and if it was your
          only reason for a second pin, drop the pin and the guard you wrote to hold
          the two in step.
        ''
      ]
      else if !(builtins.isAttrs given && given ? src && given ? revision) then [
        ''
          '${name}' — must be `{ src = <store path>; revision = <string>; }`. A bare
          store path carries no revision, and the revision is the half this file checks.
        ''
      ]
      else if given.revision != (memberOf name).pin.revision then
        let pin = (memberOf name).pin; in [
          ''
            '${name}' — kolu pins `${pin.name}` at
            ${pin.revision}, and you pass ${toString given.revision}.
            This member is not in kolu's archive: kolu grafts it from that pin and you
            graft it from yours, and then your `tsc` compiles the two against each
            other. Move yours to kolu's — that is what re-pinning kolu always owes.
          ''
        ]
      else [ ])
    (builtins.attrNames pinnedSources);

  assertPinnedRevisionsMatch =
    if pinnedProblems == [ ] then true
    else
      throw ''
        kolu/nix/consumer.nix: this consumer's pinned sources do not match kolu's.

          ${builtins.concatStringsSep "\n        " pinnedProblems}
      '';

  catalogOffenders = builtins.concatMap
    (name:
      let m = memberOf name; in
      map (dep: "${name} → ${dep}")
        (builtins.filter (dep: m.external.${dep} == "catalog:")
          (builtins.attrNames m.external)))
    names;

  _catalogOk =
    if catalogOffenders == [ ] then true
    else
      throw ''
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

  unvendoredSeeds = builtins.filter (name: !((memberOf name).vendored or false)) seeds;

  _vendoredOk =
    if unvendoredSeeds == [ ] then true
    else
      throw ''
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
assert assertPinnedRevisionsMatch;
assert _catalogOk; {
  inherit names;

  pins = builtins.listToAttrs
    (map (name: { inherit name; value = (memberOf name).pin; }) pinnedInClosure);

  dirs = builtins.listToAttrs
    (map (name: { inherit name; value = (memberOf name).dir; }) names);

  externals = builtins.foldl'
    (acc: name: acc // (memberOf name).external)
    { }
    names;

  packages = builtins.listToAttrs
    (map (name: { name = slugOf name; value = drvFor name; }) names);

  overlay = _final: _prev: builtins.listToAttrs
    (map (name: { name = slugOf name; value = drvFor name; }) names);

  hydrateArgs = builtins.concatStringsSep " "
    (builtins.concatMap (name: [ "${drvFor name}" name ]) names);

  hydrateScript = "${src}/scripts/hydrate-kolu-packages.sh";
}
