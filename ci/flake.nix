# Kolu's npins-pinned Odu coordinator, kept outside the runnable Kolu flake.
{
  outputs = { ... }:
    let
      platform = import ../nix/each-system.nix;
    in
    {
      packages = platform.withPkgs (pkgs:
        let
          sources = import ../npins;
          upstream = import sources.odu {
            pkgs = import (sources.odu + "/nix/nixpkgs.nix") {
              system = pkgs.stdenv.hostPlatform.system;
            };
            selfFlake = sources.odu;
          };
        in
        {
          default = upstream.odu;
          odu = upstream.odu;
        });
    };
}
