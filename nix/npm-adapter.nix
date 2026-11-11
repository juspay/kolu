# BUILD ONE ACP ADAPTER FROM AN NPM SHIM — the mechanism, said once.
#
# npm is the only channel any shipped ACP adapter comes through, so one gets
# the same treatment every other pin in kolu gets: a committed lockfile beside
# the integration that owns it, one fixed-output derivation for the tarballs,
# nothing fetched at build time and no `npx` at run time. A Nix-built padi
# therefore needs nothing ambient on the host it was copied to — no PATH
# lookup, no version that drifts between two machines, no network at all.
#
# This function carries what is SHARED by every adapter, and names none:
#   - `buildNpmPackage` over the shim's `package.json` and `package-lock.json`
#     (the only two files the build reads — kept out of the hash so a stray
#     third file in the shim dir does not move the store path);
#   - `dontNpmBuild` (a shim has nothing to compile),
#     `--ignore-scripts` (no package here runs an install step),
#     `dontStrip` and `dontPatchELF` (the Claude Agent SDK ships `claude` as a
#     bun-compiled executable; anything that moves its offsets breaks it —
#     only the interpreter may be touched);
#   - a `makeWrapper` over `nodejs` for the entry point;
#   - the SORTED `patchesFor` over a `patches/` directory, applied with
#     `patch -p1 -F0` (see below).
#
# The CALLER supplies the per-adapter facts: the shim directory, the npm hash,
# the package/entry/bin names, the wrapper's `env` lines, and a `postInstall`
# for anything beyond that (the patchelf of a bun binary — which wants a tool
# `extraNativeBuildInputs` adds).
#
# Patches are read from `patches/`, sorted by name, because the order patches
# apply in is a fact somebody depends on the moment two of them touch one file
# and `readDir` has no order worth relying on. The directory's own `README.md`
# says what each patch is and where it came from. An adapter that names a
# `patches` directory MUST get patches from it: a missing directory, or one
# with no `.patch` in it, FAILS THE EVAL rather than answering the empty list,
# because the failure it would otherwise hide is silent and behavioural — a
# rename that loses `background-tasks-visible.patch` builds green and every
# `run_in_background` task reads as finished the instant it launches. A patch
# is a store input, so editing one rebuilds its adapter.
#
# `patch -p1 -F0` is the audible promise the whole arrangement rests on: npm
# ships the adapter COMPILED, so what `patch -p1` reads is the bundle rather
# than the TypeScript it was built from, and a pin bump must FAIL rather than
# silently drop behaviour. `-F0` is the audible half — default fuzz would land
# a hunk up to two LINES from where its context said it belongs.
#
# To add a NEW adapter: a shim directory with its own lockfile (regenerate
# with `npm install --package-lock-only --ignore-scripts`), set the hash to
# `lib.fakeHash`, build, paste the hash it prints.
{ pkgs }:
let
  lib = pkgs.lib;
  buildNpmPackage = pkgs.buildNpmPackage;
  makeWrapper = pkgs.makeWrapper;
  nodejs = pkgs.nodejs;
in
{ name
, version
, shim
, npmDepsHash
, package
, entry
, bin
, patches ? null
, env ? [ ]
, extraNativeBuildInputs ? [ ]
, postInstall ? ""
  # The shim's own `package.json` name — npm installs by THIS, not by the
  # derivation's `name`: `$out/lib/node_modules/<shimName>/node_modules` is
  # where the entry and the SDK binary live after npmInstallHook. Defaults to
  # "acp" because `cleanSourceWith` already strips the shim down to
  # `package.json` + `package-lock.json` and names the result `acp`.
, shimName ? "acp"
}:
let
  # `shim` would also pull in whatever else lands in that directory; keep the
  # src (and its hash) to just the two files the build actually reads. Each
  # adapter's patches are read from a SIBLING directory, so each gets its own
  # store input and a patch edit never moves the shim hash.
  src = lib.cleanSourceWith {
    name = "acp";
    src = shim;
    filter = path: _type:
      baseNameOf path == "package.json" || baseNameOf path == "package-lock.json";
  };
in
buildNpmPackage {
  pname = name;
  inherit version src npmDepsHash;
  dontNpmBuild = true;
  npmFlags = [ "--ignore-scripts" ];
  dontStrip = true;
  dontPatchELF = true;
  nativeBuildInputs = [ makeWrapper ] ++ extraNativeBuildInputs;

  postInstall =
    let
      mods = "$out/lib/node_modules/${shimName}/node_modules";
      allPatches =
        let
          found =
            if patches == null then [ ]
            else if !builtins.pathExists patches then
              throw "npm-adapter: ${name} names a patches directory that is not there (${toString patches}); a renamed or deleted patch dir must not build green"
            else
              map (n: patches + "/${n}")
                (builtins.sort (a: b: a < b)
                  (builtins.attrNames
                    (lib.filterAttrs (n: kind: kind == "regular" && lib.hasSuffix ".patch" n)
                      (builtins.readDir patches))));
        in
        if patches != null && found == [ ] then
          throw "npm-adapter: ${name}'s patches directory (${toString patches}) holds no .patch file; the adapter would build with upstream behaviour (for claude-agent-acp: background tasks completing at launch) and say nothing"
        else
          found;
    in
    ''
      adapter="${mods}/${package}"
      entry="$adapter/${entry}"
      test -f "$entry"
      ${lib.concatMapStringsSep "\n" (patch: ''patch -p1 -F0 -d "$adapter" < ${patch}'') allPatches}
      makeWrapper ${nodejs}/bin/node "$out/bin/${bin}" \
        --add-flags "$entry" \
        ${lib.concatStringsSep " \\\n          " env}
      ${postInstall}
    '';

  meta = {
    description = "An ACP adapter kolu ships, built from its own npm shim";
    platforms = lib.platforms.unix;
  };
}
