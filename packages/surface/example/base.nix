# Shared base for @kolu/surface examples whose agents/runners run under
# `tsx`: the workspace tree with pnpm deps installed, skipping kolu's
# vite-bundle + node-gyp (neither is used by a surface example's stdio
# agent). Both remote-process-monitor and mini-ci wrap `tsx <entrypoint>`
# against this tree, so the install lives in one place.
#
# Inputs come from the root composer (`default.nix`):
#   pkgs     — the per-system nixpkgs.
#   src      — the workspace source fileset.
#   pnpmDeps — the workspace pnpm fetch (~395 MB; one source of truth).
{ pkgs, src, pnpmDeps }:
pkgs.stdenv.mkDerivation {
  pname = "surface-example-base";
  version = "0.1.0";
  inherit src;
  nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm pkgs.pnpmConfigHook ];
  inherit pnpmDeps;
  dontBuild = true;
  dontFixup = true;
  installPhase = ''
    runHook preInstall
    cp -r . $out
    runHook postInstall
  '';
}
