# Root composer for kolu Nix packages.
# Each package lives under nix/packages/. This file imports only what it
# needs by name and wires them together.
#
# Used by flake.nix (thin wrapper), shell.nix, and nix-build directly.
{ pkgs ? import ./nix/nixpkgs.nix { }
, commitHash ? "dev"
}:
let
  ghosttyThemes = pkgs.callPackage ./nix/packages/ghostty-themes { };
  fonts = pkgs.callPackage ./nix/packages/fonts.nix { };
  worktreeWords = pkgs.callPackage ./nix/packages/worktree-words.nix { };
  clipboard-shims = pkgs.callPackage ./nix/packages/clipboard-shims.nix { };

  koluEnv = import ./nix/packages/env.nix {
    inherit ghosttyThemes fonts worktreeWords clipboard-shims;
  };

  inherit (pkgs.callPackage ./nix/packages/kolu.nix { inherit koluEnv commitHash; })
    koluStamped;

  default = pkgs.callPackage ./nix/packages/kolu-wrapper.nix {
    inherit koluStamped koluEnv;
  };
in
{
  inherit default koluEnv;
}
