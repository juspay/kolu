{
  # A flake-declared cache acts only on the local seat: with
  # `--store ssh-ng://…`, missing outputs are substituted by the REMOTE daemon
  # per the remote's own nix.conf (a provisioning run against an unconfigured
  # host queried only that host's substituters and rebuilt a padi that sat in
  # this cache). `--accept-flake-config` on the local nix invocations accepts
  # this same block for eval-time use.
  nixConfig = {
    extra-substituters = "https://cache.kolu.dev/kolu-r2";
    extra-trusted-public-keys = "kolu-r2-1:7KmFrK05rVrnxkyZi9hJGnJJmRCpg87u6MUQIk7nokQ=";
  };

  outputs = { ... }:
    let
      platform = import ./nix/each-system.nix;
      commitHash = builtins.readFile ./commit-hash;
      agentPackages =
        (builtins.fromJSON
          (builtins.readFile ./nix/agent-packages.json)).expose;
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
