{ pkgs, src, pnpmDeps }:
pkgs.stdenv.mkDerivation {
  pname = "kolu-workspace-tree";
  version = "0.1.0";
  inherit src;
  nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm-build pkgs.pnpmConfigHook ];
  inherit pnpmDeps;
  dontBuild = true;
  dontFixup = true;
  installPhase = ''
    runHook preInstall
    cp -r . $out
    runHook postInstall
  '';
}
