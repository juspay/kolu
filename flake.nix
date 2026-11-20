# nixpkgs comes from nix/nixpkgs.nix via fetchTarball rather than a flake input:
# each flake input costs ~1.5s of fetcher-cache verification on a cold eval cache
# (~7s for nixpkgs alone), against ~1.0s cold / ~0.1s warm for this flake.
{
  nixConfig = {
    extra-substituters = "https://cache.kolu.dev/kolu-r2";
    extra-trusted-public-keys = "kolu-r2-1:7KmFrK05rVrnxkyZi9hJGnJJmRCpg87u6MUQIk7nokQ=";
  };

  outputs = { self, ... }:
    let
      platform = import ./nix/each-system.nix;
      commitHash = import ./nix/commit-hash.nix self;
      pkgsBySystem = platform.withPkgs (pkgs: pkgs);
      koluBySystem = platform.mapSystems (system:
        import ./default.nix {
          pkgs = pkgsBySystem.${system};
          inherit commitHash;
        });
    in
    {
      homeManagerModules.default = { pkgs, lib, ... }: {
        imports = [ ./nix/home/module.nix ];
        config.services.kolu.tuiPackage =
          lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.kaval-tui;
        config.services.kolu.padiTuiPackage =
          lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.padi-tui;
        config.services.kolu.agentPackages = lib.mkDefault (
          map (name: self.packages.${pkgs.stdenv.hostPlatform.system}.${name})
            (lib.importJSON ./nix/agent-packages.json).expose
        );
      };
      packages = platform.mapSystems (system:
        let
          kolu = koluBySystem.${system};
        in
        (removeAttrs kolu [ "agentFlakeSrc" "agentFlakeEnv" "koluEnv" "typecheck" "agent-distro-pre-models" "agent-distro-delivery" ]) // {
          agent-flake-source = kolu.agentFlakeSrc;
          agent-flake-env = kolu.agentFlakeEnv;
        });
      checks = platform.mapSystems (system: {
        typecheck = koluBySystem.${system}.typecheck;
        agent-distro-systems =
          let
            floorDrvPathsEvaluatedNotBuilt = builtins.unsafeDiscardStringContext
              (builtins.toJSON
                (platform.mapSystems (s: koluBySystem.${s}.agent-distro-bundle.drvPath)));
          in
          pkgsBySystem.${system}.writeText "agent-distro-systems"
            floorDrvPathsEvaluatedNotBuilt;
      });
      devShells = platform.withPkgs (pkgs:
        let default = import ./shell.nix { inherit pkgs; };
        in {
          inherit default;
          e2e = default.overrideAttrs (prev: {
            name = "kolu-shell-e2e";
            nativeBuildInputs = (prev.nativeBuildInputs or [ ]) ++ [ pkgs.gitMinimal ];
            env = (prev.env or { }) // {
              PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
            };
          });
        });
    };
}
