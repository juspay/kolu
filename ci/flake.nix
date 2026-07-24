# CI-only Nix outputs kept outside the runnable Kolu flake: the npins-pinned
# Odu coordinator and the exact remote-agent source used by its contract gate.
{
  outputs = { self, ... }:
    let
      platform = import ../nix/each-system.nix;
      commitHash = import ../nix/commit-hash.nix self;
    in
    {
      packages = platform.withPkgs (pkgs:
        let
          sources = import ../npins;
          kolu = import ../default.nix { inherit pkgs commitHash; };
          upstream = import sources.odu {
            pkgs = import (sources.odu + "/nix/nixpkgs.nix") {
              system = pkgs.stdenv.hostPlatform.system;
            };
            selfFlake = sources.odu;
          };
        in
        {
          agent-flake-source = kolu.agentFlakeSrc;
          default = upstream.odu;
          odu = upstream.odu;
        });
    };
}
