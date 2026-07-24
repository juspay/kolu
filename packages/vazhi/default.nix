# The vazhi TUI as a runnable binary: `nix run .#vazhi`.
#
# A tsx-loader wrapper over the shared workspace tree — no vite bundle, no
# node-gyp, because vazhi imports one small library, Ink, and node builtins. It
# needs openssh on PATH (that is the forward mechanism) and nodejs to run.
#
# `node --import <tsx loader>`, NOT `tsx <entry>` — the same launcher shape
# kaval and padi use, for the same reason: tsx's CLI forks a child and does not
# relay SIGTERM/SIGHUP to it, so an externally stopped vazhi would never run its
# quit path (its forwards would go down with the process, but the teardown it
# means to run would not).
#
# TSX_TSCONFIG_PATH is baked because tsx — CLI *and* loader — looks for a
# tsconfig from the WORKING DIRECTORY, and this binary runs from wherever the
# user happens to be. Without it `main.tsx`'s JSX compiles to the classic
# `React.createElement` form instead of the automatic runtime the package's
# tsconfig asks for, and the app dies at startup with "React is not defined"
# (measured, twice — from a shell in another directory, and from the CI box).
# `--set`, not `--set-default`: it is a baked build fact naming this closure's
# own tsconfig, never a knob for the caller to redirect.
#
# Inputs come from whichever composer is building — Kolu's root `default.nix`
# or vazhi's own flake — and are the canonical ones from nix/workspace.nix
# either way, so the pnpm fetch is cached once across every consumer:
#   pkgs     — the per-system nixpkgs.
#   src      — the workspace source fileset.
#   pnpmDeps — the workspace pnpm fetch.
{ pkgs, src, pnpmDeps }:
let
  tree = import ../../nix/workspace-tree.nix { inherit pkgs src pnpmDeps; };
in
{
  vazhi = pkgs.runCommand "vazhi"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta = {
        description = "A standalone TUI for ssh port forwards";
        mainProgram = "vazhi";
      };
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.nodejs}/bin/node $out/bin/vazhi \
      --add-flags "--import ${pkgs.tsx}/lib/tsx/dist/loader.mjs" \
      --add-flags "${tree}/packages/vazhi/src/main.tsx" \
      --set TSX_TSCONFIG_PATH "${tree}/packages/vazhi/tsconfig.json" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.openssh ]}
  '';
}
