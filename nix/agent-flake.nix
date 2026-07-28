# Flake with the minimal output surface needed to resolve remote daemons.
#
# default.nix assembles this file with the canonical workspace source, the
# shared Nix/npins tree, and the parent build's derived commit hash. It exposes
# exactly the agents Kolu composes—no app, website, examples, checks, or dev
# shells. The inventory is application policy in nix/agent-packages.json;
# @kolu/surface-remote owns only the generic provisioning mechanism.
{
  # Same cache the root flake declares — and the SOURCE OF TRUTH for the
  # provisioning prefetch: mkProvenAgentSource derives `binary-cache.json`
  # from this block (failing eval if it is absent), and @kolu/surface-remote
  # prefetches the agent closure from these caches into the binder's local
  # store before realising on a target host. That local seat is the only one
  # where a flake-declared cache can act — with `--store ssh-ng://…`, missing
  # outputs are substituted by the REMOTE daemon per the remote's own
  # nix.conf (a provisioning run against an unconfigured host queried only
  # that host's substituters and rebuilt a padi that sat in this cache), so
  # the prefetch-and-ship path is what lets remote hosts inherit the cache
  # without any nix.conf of their own. --accept-flake-config on the local nix
  # invocations accepts this same block for eval-time use.
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
