# Thin compat wrapper — re-exports default.nix for CI and downstream flake consumers.
# Dev workflow uses shell.nix via nix-run (see justfile).
{
  nixConfig = {
    extra-substituters = "https://cache.nixos.asia/oss";
    extra-trusted-public-keys = "oss:KO872wNJkCDgmGN3xy9dT89WAhvv13EiKncTtHDItVU=";
  };
  inputs.nixpkgs.url = "github:nixos/nixpkgs/fdc7b8f7b30fdbedec91b71ed82f36e1637483ed";

  outputs = { nixpkgs, self, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-darwin" ];
      eachSystem = f: nixpkgs.lib.genAttrs systems (system:
        f nixpkgs.legacyPackages.${system});
      commitHash = self.shortRev or self.dirtyShortRev or "dev";
    in
    {
      homeManagerModules.default = import ./nix/home/module.nix;
      packages = eachSystem (pkgs:
        import ./default.nix { inherit pkgs commitHash; });
    };
}
