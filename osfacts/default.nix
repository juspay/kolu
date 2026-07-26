# The osfacts binary: one definition, two entry points.
#
#   nix run ./osfacts              # this directory's flake
#   nix run .#osfacts              # the same derivation, from the root flake
#
# Both import this file, so they can never build two osfacts. Toolchain and
# nixpkgs come from the repo's npins pin (via nix/nixpkgs.nix) — no flake
# inputs, no second rustc.
{ pkgs }:
pkgs.rustPlatform.buildRustPackage {
  pname = "osfacts";
  version = "0.1.0";

  src = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./Cargo.toml
      ./Cargo.lock
      ./src
      ./tests
    ];
  };

  cargoLock.lockFile = ./Cargo.lock;

  meta = {
    description = "Scoped, honest OS process and socket facts";
    mainProgram = "osfacts";
  };
}
