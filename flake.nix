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
# bun2nix (the bun-built `pulam-tui` viewer's fetchBunDeps/hook) is pinned with
# npins and imported in nix/bun2nix.nix — the same zero-input path `odu` takes,
# NOT a flake input. See that file for how its own flake.lock is resolved
# without a node on kolu's (which stays nonexistent).
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
      # Per-system { system → pulam .drv } map, baked onto pulam-tui's wrapper
      # (PULAM_AGENT_DRVS_JSON) so `pulam-tui --host <ssh>` ships the TARGET-arch
      # pulam DAEMON derivation — the `pulam` daemon (it carries the sensors +
      # git/gh + node:sqlite), NOT the pulam-tui viewer: the remote box runs
      # `pulam --stdio`. Same context-free, IFD-free discipline as kavalDrvBySystem
      # above (the pulam daemon drv doesn't depend on the map, so building it this
      # way can't cycle back through the koluBySystem that consumes it).
      pulamDrvBySystem = eachSystem (pkgs:
        builtins.unsafeDiscardStringContext
          (import ./default.nix { inherit pkgs commitHash; }).pulam.drvPath);
      pulamAgentDrvsJson = builtins.toJSON pulamDrvBySystem;
      # Import default.nix / the website once per system; `packages` and
      # `checks` both consume these so each derivation set is evaluated once.
      # bun2nix (for the pulam-tui viewer) is pinned via npins and resolved
      # INSIDE default.nix (nix/bun2nix.nix), not threaded from here — it is
      # forced only when the `pulam-tui` attr is built, so it stays out of this
      # pure-eval path and out of the dev shell.
      koluBySystem = eachSystem (pkgs:
        import ./default.nix {
          inherit pkgs commitHash kavalAgentDrvsJson pulamAgentDrvsJson;
        });
      # website/default.nix is self-contained — it resolves its own public/
      # asset symlinks (favicon, kaval logo), so the flake just imports it.
      websiteBySystem = eachSystem (pkgs: import ./website { inherit pkgs; });
    in
    {
      # The per-system `{ system → pulam .drv }` map, exposed as a plain string
      # output so `nix run .#pulam-web` isn't the only way to get it: local dev
      # (`just pulam-web`, or a bare `pnpm dev:server`) reads
      # `PULAM_AGENT_DRVS_JSON=$(nix eval --raw .#pulamAgentDrvsJson)` — the exact
      # form `packages/pulam-web/src/server/config.ts` names when the env is
      # absent. The `nix run .#pulam-web` wrapper bakes the SAME value with
      # `--set`, so the two paths can't drift. Pure eval (the daemon drv's context
      # is discarded above), so listing it here adds no build.
      pulamAgentDrvsJson = pulamAgentDrvsJson;

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
          # change (the pulam-tui viewer's deps). Pinned via npins (nix/bun2nix.nix).
          bun2nix = (import ./nix/bun2nix.nix { inherit pkgs; }).bun2nix;
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
          # Runtime proof that the whole-repo Node (`pkgs.nodejs`, set to a
          # QUIC-enabled Node 26 in nix/overlay.nix) actually exposes the
          # built-in QUIC module — the day-one runtime for kaval's roaming
          # remote transport (docs/atlas note kaval-vs-zmosh). `require("node:
          # quic")` throws ERR_UNKNOWN_BUILTIN_MODULE unless Node was *compiled*
          # with --experimental-quic, and the builtin stays hidden unless Node is
          # also *run* with --experimental-quic, so a green build exercises both
          # gates on each platform. Realized by the `nix` (devour-flake) +
          # `flake-check` CI nodes via eachSystem — no extra recipe.
          node-quic = pkgs.runCommand "node-quic-smoke" { } ''
            ${pkgs.nodejs}/bin/node --experimental-quic -e '
              require("node:quic");
              if (process.features.quic !== true) {
                throw new Error("node:quic loaded but process.features.quic=" + process.features.quic);
              }
              console.log("node:quic OK", process.version);
            '
            touch $out
          '';
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
