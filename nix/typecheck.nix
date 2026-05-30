# Workspace-wide `tsc --noEmit` as a cached, devour-flake-gated proof.
#
# Exists because `nix build .#default` does NOT typecheck: the client is
# bundled by Vite (per-file transpile, no project-wide tsc) and the server
# runs under tsx at runtime (also transpile-only), so type errors are
# invisible to the build. A broken server package shipped green once
# (juspay/kolu#1049, regression in #1034). This derivation closes the gap —
# CI's `nix` node realizes every flake output via devour-flake, so a type
# error now fails the pipeline. It is content-addressed by `src`, so it only
# re-runs when a typechecked source file changes, and the result is shared
# through the binary cache.
#
# Reuses default.nix's `src` + `pnpmDeps` rather than a fileset of its own:
# every package carrying a `typecheck` script is already in that fileset
# (packages/tests is the only workspace member outside it, and it has no
# typecheck script), so this checks exactly the set `pnpm typecheck`
# (`pnpm -r typecheck`) does. No node-gyp rebuild here — `tsc --noEmit` reads
# the .d.ts files, not node-pty's compiled .node.
{ pkgs, src, pnpmDeps }:
pkgs.stdenv.mkDerivation {
  pname = "kolu-typecheck";
  version = "0.1.0";
  inherit src pnpmDeps;

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

  # Success is the artifact — the derivation proves the workspace typechecks.
  installPhase = ''
    runHook preInstall
    touch $out
    runHook postInstall
  '';
}
