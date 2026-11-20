{ pkgs, pname, src, pnpmDeps, version }:
pkgs.stdenv.mkDerivation {
  inherit pname src pnpmDeps version;

  nativeBuildInputs = [
    pkgs.nodejs
    pkgs.pnpm-build
    pkgs.pnpmConfigHook
  ];

  dontFixup = true;

  buildPhase = ''
    runHook preBuild
    pnpm typecheck
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    touch $out
    runHook postInstall
  '';
}
