{ pkgs ? import <nixpkgs> { } }:
let
  nodejs = pkgs.nodejs;
  pnpm = pkgs.pnpm;

  src = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./package.json
      ./pnpm-lock.yaml
      ./tsconfig.json
      ./src
    ];
  };

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "workflow-mcp";
    version = "0.1.0";
    inherit src;
    hash = "sha256-KGheMJeQMnyrwAVHvzqPEArBUSMPi/zUiLUwkhKvypw=";
    fetcherVersion = 3;
  };
in
pkgs.stdenv.mkDerivation {
  pname = "workflow-mcp";
  version = "0.1.0";
  inherit src;

  nativeBuildInputs = [
    nodejs
    pnpm
    pkgs.pnpmConfigHook
  ];

  inherit pnpmDeps;

  # No build step needed — tsx runs TypeScript directly.
  # We just need pnpm install to resolve deps, then copy everything.
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    cp -r . $out
    runHook postInstall
  '';
}
