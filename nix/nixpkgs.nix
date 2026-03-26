# Import nixpkgs pinned to the same revision as flake.lock.
# Used by shell.nix to avoid flake evaluation overhead while
# staying in sync with the flake's nixpkgs pin.
let
  lock = builtins.fromJSON (builtins.readFile ../flake.lock);
  nixpkgs-locked = lock.nodes.nixpkgs.locked;
in
import (fetchTarball {
  url = "https://github.com/NixOS/nixpkgs/archive/${nixpkgs-locked.rev}.tar.gz";
  sha256 = nixpkgs-locked.narHash;
})
