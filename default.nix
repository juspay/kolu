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

  # Shared env vars — used by the kolu build, the devShell, and the wrapper.
  # KOLU_COMMIT_HASH excluded — it busts the derivation cache on every commit.
  # The build uses a placeholder; koluStamped stamps the real hash afterwards.
  koluEnv = {
    KOLU_THEMES_JSON = "${ghosttyThemes}/themes.json";
    KOLU_FONTS_DIR = "${fonts}";
    KOLU_CLIPBOARD_SHIM_DIR = "${clipboard-shims}/bin";
    KOLU_RANDOM_WORDS = "${worktreeWords}";
  };

  inherit (pkgs.callPackage ./nix/packages/kolu.nix { inherit koluEnv commitHash; })
    kolu koluStamped;

  default = pkgs.callPackage ./nix/packages/kolu-wrapper.nix {
    inherit koluStamped koluEnv;
  };
in
{
  inherit kolu ghosttyThemes fonts clipboard-shims koluEnv default;
}
