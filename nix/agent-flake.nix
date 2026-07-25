# Flake with the minimal output surface needed to resolve remote daemons.
#
# default.nix assembles this file with the canonical workspace source, the
# shared Nix/npins tree, and the parent build's derived commit hash. It exposes
# exactly the agents Kolu composes—no app, website, examples, checks, or dev
# shells. The inventory is application policy in nix/agent-packages.json;
# @kolu/surface-remote owns only the generic provisioning mechanism.
{
  outputs = { ... }:
    let
      platform = import ./nix/each-system.nix;
      commitHash = builtins.readFile ./commit-hash;
      agentPackages =
        builtins.fromJSON (builtins.readFile ./nix/agent-packages.json);
    in
    {
      packages = platform.withPkgs (pkgs:
        let kolu = import ./default.nix { inherit pkgs commitHash; };
        in
        builtins.listToAttrs (map
          (name: {
            inherit name;
            value = kolu.${name};
          })
          agentPackages));
    };
}
