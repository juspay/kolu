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
#
# THE ONE SANCTIONED EXCEPTION: `bun2nix`. There is no fetchBunDeps /
# buildBunPackage in nixpkgs, and bun2nix's nix layer is flake-parts-shaped, so
# it cannot be cleanly imported via fetchTarball the way nixpkgs is. Its
# `rawflake` branch exposes `lib.mkBun2nix { pkgs }`, fed OUR npins-pinned pkgs
# so no transitive nixpkgs is evaluated. It is realized only when the bun-built
# `arivu-tui` viewer (the sole Bun consumer, arivu P3 PR1) is accessed — the
# daemon and the rest of kolu stay Node, and `nix develop` cold eval is
# untouched (the input is not forced by the dev shell). This mirrors drishti's
# own Bun-on-Nix recipe, which kolu's @kolu/surface packages already feed.
{
  inputs.bun2nix.url = "github:juspay/bun2nix/rawflake";

  nixConfig = {
    extra-substituters = "https://cache.nixos.asia/oss";
    extra-trusted-public-keys = "oss:KO872wNJkCDgmGN3xy9dT89WAhvv13EiKncTtHDItVU=";
  };

  outputs = { self, bun2nix, ... }:
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
      # Per-system { system → arivu .drv } map, baked onto arivu-tui's wrapper
      # (ARIVU_AGENT_DRVS_JSON) so `arivu-tui --host <ssh>` ships the TARGET-arch
      # arivu DAEMON derivation — the `arivu` daemon (it carries the sensors +
      # git/gh + node:sqlite), NOT the arivu-tui viewer: the remote box runs
      # `arivu --stdio`. Same context-free, IFD-free discipline as kavalDrvBySystem
      # above (the arivu daemon drv doesn't depend on the map, so building it this
      # way can't cycle back through the koluBySystem that consumes it).
      arivuDrvBySystem = eachSystem (pkgs:
        builtins.unsafeDiscardStringContext
          (import ./default.nix { inherit pkgs commitHash; }).arivu.drvPath);
      arivuAgentDrvsJson = builtins.toJSON arivuDrvBySystem;
      # The bun2nix helper set (fetchBunDeps / hook / the bun2nix CLI), per
      # system, fed our npins-pinned pkgs. Threaded into default.nix so the
      # bun-built arivu-tui viewer (arivu P3 PR1) can realise its dep cache from
      # the committed bun.nix. Lazy: only forced when the arivu-tui attr is
      # accessed — the arivuDrvBySystem import above (the Node daemon's drvPath)
      # never touches it, so it stays out of that pure-eval path.
      b2nBySystem = eachSystem (pkgs: bun2nix.lib.mkBun2nix { inherit pkgs; });
      # Import default.nix / the website once per system; `packages` and
      # `checks` both consume these so each derivation set is evaluated once.
      koluBySystem = eachSystem (pkgs:
        import ./default.nix {
          inherit pkgs commitHash kavalAgentDrvsJson arivuAgentDrvsJson;
          b2n = b2nBySystem.${pkgs.stdenv.hostPlatform.system};
        });
      # website/default.nix is self-contained — it resolves its own public/
      # asset symlinks (favicon, kaval logo), so the flake just imports it.
      websiteBySystem = eachSystem (pkgs: import ./website { inherit pkgs; });
    in
    {
      # The module proper is platform-agnostic; the flake closes over it to
      # default `tuiPackage` to this flake's matching `kaval-tui` build, so the
      # CLI ships automatically with the server (override or set null to opt out).
      homeManagerModules.default = { pkgs, lib, ... }: {
        imports = [ ./nix/home/module.nix ];
        config.services.kolu.tuiPackage =
          lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.kaval-tui;
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
          # The bun2nix CLI — `nix run .#bun2nix -- -l <dir>/bun.lock -o
          # <dir>/bun.nix` regenerates the committed dep cache after a bun.lock
          # change (the arivu-tui viewer's deps).
          bun2nix = b2nBySystem.${system}.bun2nix;
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
