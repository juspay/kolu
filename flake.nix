# Thin compat wrapper — re-exports default.nix for CI and downstream flake consumers.
# Dev workflow uses shell.nix via nix-run (see justfile).
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
      commitHash = self.shortRev or self.dirtyShortRev or "dev";
    in
    {
      homeManagerModules.default = import ./nix/home/module.nix;
      packages = eachSystem (pkgs:
        import ./default.nix { inherit pkgs commitHash; });
    };
}
