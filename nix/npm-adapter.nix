{ pkgs }:
let
  lib = pkgs.lib;
  buildNpmPackage = pkgs.buildNpmPackage;
  makeWrapper = pkgs.makeWrapper;
  nodejs = pkgs.nodejs;

  bunCompiledExecutablesStayByteIdentical = {
    dontStrip = true;
    dontPatchELF = true;
  };

  requiredSortedPatches = owner: dir:
    if dir == null then [ ]
    else if !builtins.pathExists dir then
      throw "npm-adapter: ${owner} names a patches directory that is not there (${toString dir}); a renamed or deleted patch dir must not build green"
    else
      let
        found = map (n: dir + "/${n}")
          (builtins.sort (a: b: a < b)
            (builtins.attrNames
              (lib.filterAttrs (n: kind: kind == "regular" && lib.hasSuffix ".patch" n)
                (builtins.readDir dir))));
      in
      if found == [ ] then
        throw "npm-adapter: ${owner}'s patches directory (${toString dir}) holds no .patch file; the adapter would build with upstream behaviour (for claude-agent-acp: background tasks completing at launch) and say nothing"
      else
        found;
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
, shimName ? "acp"
}:
let
  src = lib.cleanSourceWith {
    name = "acp";
    src = shim;
    filter = path: _type:
      baseNameOf path == "package.json" || baseNameOf path == "package-lock.json";
  };
in
buildNpmPackage (bunCompiledExecutablesStayByteIdentical // {
  pname = name;
  inherit version src npmDepsHash;
  dontNpmBuild = true;
  npmFlags = [ "--ignore-scripts" ];
  nativeBuildInputs = [ makeWrapper ] ++ extraNativeBuildInputs;

  postInstall =
    let
      mods = "$out/lib/node_modules/${shimName}/node_modules";
    in
    ''
      adapter="${mods}/${package}"
      entry="$adapter/${entry}"
      test -f "$entry"
      ${lib.concatMapStringsSep "\n" (patch: ''patch -p1 -F0 -d "$adapter" < ${patch}'') (requiredSortedPatches name patches)}
      makeWrapper ${nodejs}/bin/node "$out/bin/${bin}" \
        --add-flags "$entry" \
        ${lib.concatStringsSep " \\\n          " env}
      ${postInstall}
    '';

  meta = {
    description = "An ACP adapter, built from its own npm shim";
    platforms = lib.platforms.unix;
  };
})
