# Flake with the minimal output surface needed to resolve remote daemons.
#
# default.nix assembles this file with the canonical workspace source, the
# shared Nix/npins tree, and the parent build's derived commit hash. It exposes
# exactly the agents Kolu composes—no app, website, examples, checks, or dev
# shells. The inventory is application policy in nix/agent-packages.json;
# @kolu/surface-remote owns only the generic provisioning mechanism.
{
  # Same cache the root flake declares. @kolu/surface-remote's nix invocations
  # pass --accept-flake-config (agentDrv.ts eval, nixCopy.ts build); without
  # this block that flag had nothing to accept. It reaches exactly the LOCAL
  # side: the eval and the localhost-provisioning build. It does NOT reach a
  # remote host's realisation — with `--store ssh-ng://…`, missing outputs are
  # substituted by the REMOTE daemon per the remote's own nix.conf; a
  # provisioning run against a host without the cache configured queried only
  # that host's substituters and rebuilt a padi that sat in this cache. The
  # remote-side fix is the cache in the host's nix.conf (see the Quickstart's
  # binary-cache section).
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
