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
    description = "An ACP adapter, built from its own npm shim";
    platforms = lib.platforms.unix;
  };
}
