{ pkgs, src, pnpmDeps }:
let
  docsiteClient = pkgs.stdenv.mkDerivation {
    pname = "solid-browser-example-docsite";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm-build pkgs.pnpmConfigHook ];
    inherit pnpmDeps;
    dontFixup = true;
    buildPhase = ''
      runHook preBuild
      pnpm --filter @kolu/solid-browser-example-docsite build:client
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -r packages/solid-browser/example/docsite/dist $out
      runHook postInstall
    '';
  };
in
{
  solid-browser-example-docsite = docsiteClient;
}
