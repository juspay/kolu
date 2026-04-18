{ pkgs ? import ./nix/nixpkgs.nix { } }:
pkgs.mkShell {
  name = "kolu-website-shell";
  packages = [
    pkgs.nodejs
    pkgs.pnpm
    pkgs.just
  ];
}
