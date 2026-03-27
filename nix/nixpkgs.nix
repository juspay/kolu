# Pinned nixpkgs import — single source of truth for the nixpkgs rev.
# Used by flake.nix (via fetchTarball to avoid flake inputs) and shell.nix.
# To update: change rev and sha256.
import (fetchTarball {
  url = "https://github.com/NixOS/nixpkgs/archive/f8573b9c935cfaa162dd62cc9e75ae2db86f85df.tar.gz";
  sha256 = "sha256-hpXH0z3K9xv0fHaje136KY872VT2T5uwxtezlAskQgY=";
})
