# Kolu website — independent from the runnable Kolu flake.
#
# This flake has no inputs. It reuses the repository's npins-backed nixpkgs
# import through nix/each-system.nix.
{
  outputs = { ... }:
    let
      platform = import ../nix/each-system.nix;
      websiteBySystem =
        platform.withPkgs (pkgs: import ./. { inherit pkgs; });
    in
    {
      packages = platform.mapSystems (system:
        let website = websiteBySystem.${system};
        in {
          inherit (website) default;
          pnpm-deps = website.pnpmDeps;
        });

      checks = platform.mapSystems (system:
        let website = websiteBySystem.${system};
        in {
          typecheck = website.typecheck;
        });
    };
}
