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
        # I1 (juspay/kolu#2101): a deploy of this module carries every agent
        # closure it can provision. The SET is read from the manifest, never
        # hand-listed — `nix/agent-packages.json`'s `expose` is already the one
        # answer to "which attrs may a remote resolve", shared with
        # `nix/agent-flake.nix`, `ci/agent-preflight` and the `publish-closures`
        # job that proves each one fetchable. A newly exposed agent therefore
        # ships with the next deploy and no second edit; a hand-listed set here
        # would be a second source of truth that goes stale exactly where it
        # hurts.
        config.services.kolu.agentPackages = lib.mkDefault (
          map (name: self.packages.${pkgs.stdenv.hostPlatform.system}.${name})
            (lib.importJSON ./nix/agent-packages.json).expose
        );
      };
      packages = platform.mapSystems (system:
        let
          kolu = koluBySystem.${system};
        in
        # `agent-distro-pre-models` and `agent-distro-delivery` are kept out of
          # `packages` because `ci/flake-build` builds — and odu PUSHES — every
          # package this flake exposes: the first is an old upstream closure
          # nobody ships, and neither is something a kolu user installs.
          # `ci::agent-models` / `ci::agent-published` reach them with
          # `nix build -f default.nix`.
        (removeAttrs kolu [ "agentFlakeSrc" "agentFlakeEnv" "koluEnv" "typecheck" "agent-distro-pre-models" "agent-distro-delivery" ]) // {
          agent-flake-source = kolu.agentFlakeSrc;
          agent-flake-env = kolu.agentFlakeEnv;
        });
      checks = platform.mapSystems (system: {
        typecheck = koluBySystem.${system}.typecheck;
        # The agent-distro floor must EVALUATE for every system kolu supports,
        # including the ones CI never builds on (aarch64-linux): a harness recipe
        # that fails to evaluate there would otherwise surface only as a broken
        # `nix run` on a user's machine. Records each system's drvPath with its
        # context dropped, so realising this check evaluates every system but
        # builds none of them.
        agent-distro-systems =
          pkgsBySystem.${system}.writeText "agent-distro-systems"
            (builtins.unsafeDiscardStringContext (builtins.toJSON
              (platform.mapSystems (s: koluBySystem.${s}.agent-distro-bundle.drvPath))));
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
