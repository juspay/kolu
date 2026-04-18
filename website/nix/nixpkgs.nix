# Pinned nixpkgs — matches the root repo's npins/sources.json nixpkgs entry.
#
# Kept in sync manually (both files update together). Using fetchTarball with
# an explicit hash keeps this flake at zero inputs, mirroring the root.
let
  nixpkgs = builtins.fetchTarball {
    url = "https://github.com/nixos/nixpkgs/archive/f8573b9c935cfaa162dd62cc9e75ae2db86f85df.tar.gz";
    sha256 = "sha256-hpXH0z3K9xv0fHaje136KY872VT2T5uwxtezlAskQgY=";
  };
in
args: import nixpkgs args
