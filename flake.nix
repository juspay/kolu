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
    extra-substituters = "https://kolu.cachix.org";
    extra-trusted-public-keys = "kolu.cachix.org-1:jXCB7PDK4v+9fcOmiFSKWHdYU31mfbCvpPiJ0l0zaRs=";
  };

  outputs = { self, ... }:
    let
      platform = import ./nix/each-system.nix;
      commitHash = import ./nix/commit-hash.nix self;
      # Import Kolu once per system; `packages` and `checks` both consume these
      # so each derivation set is evaluated once.
      koluBySystem = platform.withPkgs (pkgs:
        import ./default.nix {
          inherit pkgs commitHash;
        });
    in
    {
      # The module proper is platform-agnostic; the flake closes over it to
      # default `tuiPackage` / `padiTuiPackage` to this flake's matching
      # `kaval-tui` / `padi-tui` builds, so both CLIs ship automatically with
      # the server (override or set null to opt out of either).
      homeManagerModules.default = { pkgs, lib, ... }: {
        imports = [ ./nix/home/module.nix ];
        config.services.kolu.tuiPackage =
          lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.kaval-tui;
        config.services.kolu.padiTuiPackage =
          lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.padi-tui;
      };
      packages = platform.mapSystems (system:
        let
          kolu = koluBySystem.${system};
        in
        # `agentFlakeSrc`, `koluEnv`, and `typecheck` are internal; pnpmDeps
          # remains a Kolu dependency output used by the hash-fresh gate.
        removeAttrs kolu [ "agentFlakeSrc" "koluEnv" "typecheck" ]);
      # Type gates on every system. The build environment (nodejs/pnpm and the
      # platform-resolved deps `pnpmConfigHook` installs) differs per platform,
      # so each platform's `tsc`/`astro check` is its own proof — a darwin-only
      # type error wouldn't surface from a linux-only check. CI's
      # `ci::nix` realizes each platform's checks on that platform. The website
      # owns its independent check in website/flake.nix.
      checks = platform.mapSystems (system: {
        typecheck = koluBySystem.${system}.typecheck;
      });
      devShells = platform.withPkgs (pkgs:
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
