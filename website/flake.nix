# Kolu website — Astro static site. Zero flake inputs, mirroring the root.
#
# nixpkgs is imported via fetchTarball in nix/nixpkgs.nix. Each flake input
# adds ~1.5s to `nix develop` cold eval; keeping zero inputs means the
# website devShell opens as fast as the root one.
{
  nixConfig = {
    extra-substituters = "https://cache.nixos.asia/oss";
    extra-trusted-public-keys = "oss:KO872wNJkCDgmGN3xy9dT89WAhvv13EiKncTtHDItVU=";
  };

  outputs = { self, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-darwin" ];
      eachSystem = f: builtins.listToAttrs (map
        (system: {
          name = system;
          value = f (import ./nix/nixpkgs.nix { inherit system; });
        })
        systems);
    in
    {
      packages = eachSystem (pkgs:
        let all = import ./default.nix { inherit pkgs; };
        in {
          inherit (all) default pnpmDeps;
        });

      devShells = eachSystem (pkgs: {
        default = import ./shell.nix { inherit pkgs; };
      });
    };
}
