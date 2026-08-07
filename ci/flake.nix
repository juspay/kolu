# CI-only Nix outputs kept outside the runnable Kolu flake: the npins-pinned
# Odu coordinator.
#
# odu's Bun build (juspay/odu#72) requires `b2n` from juspay/bun2nix — there is
# no fetchBunDeps in nixpkgs. That is the one flake input here (same exception
# odu itself documents); the odu *source* stays on npins so the pin is one line
# in sources.json, not a second flake input.
{
  inputs.bun2nix.url = "github:juspay/bun2nix/rawflake";

  outputs = { bun2nix, ... }:
    let
      platform = import ../nix/each-system.nix;
    in
    {
      packages = platform.withPkgs (pkgs:
        let
          sources = import ../npins;
          oduPkgs = import (sources.odu + "/nix/nixpkgs.nix") {
            system = pkgs.stdenv.hostPlatform.system;
          };
          b2n = bun2nix.lib.mkBun2nix { pkgs = oduPkgs; };
          upstream = import sources.odu {
            pkgs = oduPkgs;
            inherit b2n;
            selfFlake = sources.odu;
          };
        in
        {
          default = upstream.odu;
          odu = upstream.odu;
        });
    };
}
