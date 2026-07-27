# Flake with the minimal output surface needed to resolve remote daemons.
#
# default.nix assembles this file with the canonical workspace source, the
# shared Nix/npins tree, and the parent build's derived commit hash. It exposes
# exactly the agents Kolu composes—no app, website, examples, checks, or dev
# shells. The inventory is application policy in nix/agent-packages.json;
# @kolu/surface-remote owns only the generic provisioning mechanism.
{
  # Same cache the root flake declares. This is the flake a remote host
  # actually builds (`nix build --accept-flake-config --store ssh-ng://…` in
  # @kolu/surface-remote's nixCopy.ts) — without this block that flag had
  # nothing to accept, so provisioning compiled the agent closure (including
  # the Rust osfacts) from source even though CI had pushed it. Nix still
  # honors it only when the building user is trusted by the target daemon;
  # untrusted setups need the cache in the host's own nix.conf (see the
  # Quickstart's binary-cache section).
  nixConfig = {
    extra-substituters = "https://cache.nixos.asia/oss";
    extra-trusted-public-keys = "oss:KO872wNJkCDgmGN3xy9dT89WAhvv13EiKncTtHDItVU=";
  };

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
