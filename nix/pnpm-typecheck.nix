# Run `pnpm typecheck` as a content-addressed Nix gate over a workspace src.
#
# Why this exists: Kolu's client/website are bundled by Vite/Astro (per-file
# transpile) and the daemons run under tsx — neither path typechecks. Type
# errors once shipped green (juspay/kolu#1049, regression in #1034). This
# turns `pnpm typecheck` into a derivation that fails on a type/module-graph
# error. Root `default.nix` makes the main `kolu` package depend on it, so
# `nix build .#default` / `.#padi` cannot hand out a store path that `tsc`
# rejected; every CI lane that builds those packages inherits the gate. The
# result is content-addressed so it only re-runs when a typechecked source
# changes. No node-gyp — `tsc`/`astro check` read the .d.ts files, not
# node-pty's compiled .node.
#
# Callers: default.nix (workspace `tsc --noEmit`, required input of `kolu`)
# and website/default.nix (`astro check`).
{ pkgs, pname, src, pnpmDeps, version }:
pkgs.stdenv.mkDerivation {
  inherit pname src pnpmDeps version;

  nativeBuildInputs = [
    pkgs.nodejs
    pkgs.pnpm_10
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
