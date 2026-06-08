# Nix derivation for the @kolu/solid-browser docsite example.
#
# A client-only Vite+Solid app — the vite-built static bundle for the demo, so
# `nix build .#solid-browser-example-docsite` (and CI's `ci::nix`) keeps the
# second consumer of `createBrowser` building. There's no server or agent here
# (the docs are static), so unlike the surface examples this needs no tsx
# runner base — just the workspace tree + a vite build.
#
# Inputs come from the root composer (`default.nix`) so this reuses the
# workspace's pnpm fetch (one source of truth) and the same `src` fileset the
# kolu build uses:
#   pkgs     — the per-system nixpkgs.
#   src      — the workspace source fileset.
#   pnpmDeps — the workspace pnpm fetch.
{ pkgs, src, pnpmDeps }:
let
  docsiteClient = pkgs.stdenv.mkDerivation {
    pname = "solid-browser-example-docsite";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm pkgs.pnpmConfigHook ];
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
