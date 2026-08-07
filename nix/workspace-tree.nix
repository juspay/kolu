# The workspace tree with pnpm deps installed, ready to run under `tsx`.
#
# kolu's own build (default.nix) additionally bundles the client with vite and
# rebuilds node-pty with node-gyp. Everything else that just needs to RUN a
# TypeScript entrypoint out of the workspace — the @kolu/surface examples —
# wants only this: install, copy, done. Skipping the bundle and the native
# rebuild is the difference between a minute and several.
#
# Inputs come from whichever composer is building — the independent
# Surface-example flake — and are the canonical ones from nix/workspace.nix
# either way:
#   pkgs     — the per-system nixpkgs.
#   src      — the workspace source fileset.
#   pnpmDeps — the workspace pnpm fetch (~395 MB; one source of truth).
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
