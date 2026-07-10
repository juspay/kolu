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
  };

  outputs = { self, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      eachSystem = f: builtins.listToAttrs (map
        (system: {
          name = system;
          value = f (import ./nix/nixpkgs.nix { inherit system; });
        })
        systems);
      commitHash = self.shortRev or self.dirtyShortRev or "dev";
      # Per-system { system → kaval .drv } map, baked onto kaval-tui's wrapper
      # (KAVAL_AGENT_DRVS_JSON) so `kaval-tui --host <ssh>` ships the TARGET-arch
      # kaval derivation (provisionAgent copies+realises it remotely). Derived from
      # a JSON-LESS import of default.nix on purpose: the kaval daemon drv doesn't
      # depend on the map (only the kaval-tui wrapper does), so building the map
      # this way can't cycle back through the koluBySystem that consumes it.
      # `unsafeDiscardStringContext` drops the .drv's build-dep context so toJSON
      # sees a plain string and the whole thing stays a pure eval (no IFD) — the
      # same host-independent discipline `default.nix`'s kavalBuildId follows.
      kavalDrvBySystem = eachSystem (pkgs:
        builtins.unsafeDiscardStringContext
          (import ./default.nix { inherit pkgs commitHash; }).kaval.drvPath);
      kavalAgentDrvsJson = builtins.toJSON kavalDrvBySystem;
      # Per-system { system → padi .drv } map, baked onto kolu-server's wrapper
      # (PADI_AGENT_DRVS_JSON) so a `KOLU_PADI_HOST=<ssh>` remote binding ships the
      # TARGET-arch padi derivation (provisionAgent copies+realises it remotely).
      # kaval rides INSIDE padi's closure (padi's wrapper bakes KOLU_KAVAL_BIN), so
      # this ONE drv provisions BOTH daemons. Same JSON-less-import + no-IFD
      # discipline as kavalDrvBySystem above: the padi daemon drv doesn't depend on
      # the map (only kolu-server's wrapper does), so building it this way can't
      # cycle back through the koluBySystem that consumes it.
      padiDrvBySystem = eachSystem (pkgs:
        builtins.unsafeDiscardStringContext
          (import ./default.nix { inherit pkgs commitHash; }).padi.drvPath);
      padiAgentDrvsJson = builtins.toJSON padiDrvBySystem;
      # Import default.nix / the website once per system; `packages` and
      # `checks` both consume these so each derivation set is evaluated once.
      koluBySystem = eachSystem (pkgs:
        import ./default.nix {
          inherit pkgs commitHash kavalAgentDrvsJson padiAgentDrvsJson;
        });
      # website/default.nix is self-contained — it resolves its own public/
      # asset symlinks (favicon, kaval logo), so the flake just imports it.
      websiteBySystem = eachSystem (pkgs: import ./website { inherit pkgs; });
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
      packages = eachSystem (pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          kolu = koluBySystem.${system};
          website = websiteBySystem.${system};
        in
        # `typecheck` is routed to `checks` below, not exposed as a package.
        removeAttrs kolu [ "koluEnv" "typecheck" ] // {
          website = website.default;
          website-pnpm-deps = website.pnpmDeps;
          # The e2e suite's ollama backend, orchestrated by process-compose via
          # services-flake (npins-pinned). `just test` / `test-quick` run this
          # package; its `test` process IS the cucumber suite, gated on ollama
          # healthy + model pulled + warmed. See nix/e2e-pc.nix.
          e2e-pc = import ./nix/e2e-pc.nix { inherit pkgs; };
        });
      # Type gates on every system. The build environment (nodejs/pnpm and the
      # platform-resolved deps `pnpmConfigHook` installs) differs per platform,
      # so each platform's `tsc`/`astro check` is its own proof — a darwin-only
      # type error wouldn't surface from a linux-only check. CI's
      # `nix`/devour-flake node realizes each platform's checks on that
      # platform. Rationale: workspace gate in nix/pnpm-typecheck.nix, website
      # gate in website/default.nix.
      checks = eachSystem (pkgs:
        let system = pkgs.stdenv.hostPlatform.system;
        in {
          typecheck = koluBySystem.${system}.typecheck;
          website-typecheck = websiteBySystem.${system}.typecheck;
        });
      devShells = eachSystem (pkgs:
        let default = import ./shell.nix { inherit pkgs; };
        in {
          inherit default;
          # Extended shell with Playwright browsers for e2e testing, plus the
          # binaries the real-agent-against-ollama lane needs on PATH: `ollama`
          # (the locally-served model backend `just test-ollama` starts and
          # health-gates) and `codex` (the real agent CLI that lane drives —
          # see packages/tests/features/codex-ollama.feature). Both ride ONLY
          # this e2e shell, so the ~0.3s-warm default `nix develop` is untouched.
          # No process-compose / services-flake: the flake keeps its zero-input
          # rule, and ollama joins the existing imperative harness graph as one
          # more health-gated node (started by the recipe, seen by hooks.ts),
          # not a parallel orchestration contraption.
          #
          # Usage: nix develop .#e2e
          e2e = default.overrideAttrs (prev: {
            name = "kolu-shell-e2e";
            buildInputs = (prev.buildInputs or [ ]) ++ [
              pkgs.ollama
              # Pinned codex 0.130.0 on EVERY platform (the lane runs on both
              # linux and darwin): nixpkgs' 0.114.0 predates the threads columns
              # kolu's codex provider requires, so its detection stays disabled.
              # See nix/packages/codex-pinned.nix.
              (import ./nix/packages/codex-pinned.nix { inherit pkgs; })
              # Real Claude Code (unfree; scoped-allowUnfree import) for the
              # claude live-state e2e — talks to ollama's /v1/messages.
              (import ./nix/packages/claude-code.nix { inherit pkgs; })
            ];
            env = (prev.env or { }) // {
              PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
            };
          });
        });
    };
}
