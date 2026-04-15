# IMPORTANT: This flake intentionally has ZERO inputs.
#
# nixpkgs is imported via fetchTarball in nix/nixpkgs.nix, bypassing the
# flake input system. This is critical for `nix develop` performance:
#
#   - Each flake input adds ~1.5s of fetcher-cache verification on cold
#     eval cache. Even a single nixpkgs input costs ~7s.
#   - With zero inputs, `nix develop` cold is ~1.0s, warm is ~0.1s.
#
# DO NOT add flake inputs (nixpkgs, flake-parts, git-hooks, etc.).
# Instead, use fetchTarball or callPackage in nix/ files.
{
  nixConfig = {
    extra-substituters = "https://cache.nixos.asia/oss";
    extra-trusted-public-keys = "oss:KO872wNJkCDgmGN3xy9dT89WAhvv13EiKncTtHDItVU=";
    # Skip flake registry lookups — this flake has zero inputs, so the
    # registry check is pure overhead (~280ms on cold eval).
    use-registries = false;
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
        let all = import ./default.nix { inherit pkgs commitHash; };
        in removeAttrs all [ "koluEnv" ]);
      devShells = eachSystem (pkgs:
        let default = import ./shell.nix { inherit pkgs; };
        in {
          inherit default;
          # Extended shell with Playwright browsers for e2e testing.
          # Usage: nix develop .#e2e
          e2e = default.overrideAttrs (prev: {
            name = "kolu-shell-e2e";
            env = (prev.env or { }) // {
              PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
            };
          });
        });
    };
}
