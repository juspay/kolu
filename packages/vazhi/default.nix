# The vazhi TUI as a runnable binary: `nix run .#vazhi`.
#
# A `tsx` wrapper over the shared workspace tree — no vite bundle, no node-gyp,
# because vazhi imports one dependency-free library and node builtins. It needs
# openssh on PATH (that is the forward mechanism) and nodejs to run.
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
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/vazhi \
      --add-flags "${tree}/packages/vazhi/src/main.ts" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.openssh ]}
  '';
}
