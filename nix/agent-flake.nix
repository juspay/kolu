# Flake with the minimal output surface needed to resolve remote daemons.
#
# default.nix assembles this file with the canonical workspace source, the
# shared Nix/npins tree, and the parent build's derived commit hash. It exposes
# exactly the agents @kolu/surface-remote may provision—no app, website,
# examples, checks, or dev shells.
{
  outputs = { ... }:
    let
      platform = import ./nix/each-system.nix;
      commitHash = builtins.readFile ./commit-hash;
    in
    {
      packages = platform.withPkgs (pkgs:
        let kolu = import ./default.nix { inherit pkgs commitHash; };
        in {
          inherit (kolu) kaval padi;
        });
    };
}
