# Run `pnpm typecheck` as a content-addressed Nix gate over a workspace src.
#
# Why this exists: Kolu's Nix builds transpile without typechecking — the
# client/website are bundled by Vite/Astro (per-file) and the server runs
# under tsx — so type errors are invisible to `nix build` and shipped green
# once (juspay/kolu#1049, regression in #1034). This turns `pnpm typecheck`
# into a derivation that fails on a type error; CI's `nix`/devour-flake node
# realizes it, and the result is content-addressed so it only re-runs when a
# typechecked source changes. No node-gyp — `tsc`/`astro check` read the
# .d.ts files, not node-pty's compiled .node.
#
# Callers: default.nix (workspace `tsc --noEmit`) and website/default.nix
# (`astro check`). Each documents why its own scope needs gating.
{ pkgs, pname, src, pnpmDeps }:
pkgs.stdenv.mkDerivation {
  inherit pname src pnpmDeps;
  version = "0.1.0";

  nativeBuildInputs = [
    pkgs.nodejs
    pkgs.pnpm
    pkgs.pnpmConfigHook
  ];

  dontFixup = true;

  buildPhase = ''
    runHook preBuild
    pnpm typecheck
    runHook postBuild
  '';

  # Success is the artifact — the derivation proves the source typechecks.
  installPhase = ''
    runHook preInstall
    touch $out
    runHook postInstall
  '';
}
