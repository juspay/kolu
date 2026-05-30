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
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      eachSystem = f: builtins.listToAttrs (map
        (system: {
          name = system;
          value = f (import ./nix/nixpkgs.nix { inherit system; });
        })
        systems);
      commitHash = self.shortRev or self.dirtyShortRev or "dev";
      # Import default.nix / the website once per system; `packages` and
      # `checks` both consume these so each derivation set is evaluated once.
      koluBySystem = eachSystem (pkgs: import ./default.nix { inherit pkgs commitHash; });
      websiteBySystem = eachSystem (pkgs:
        # Synthesized website source tree: website/ with the canonical favicon
        # copied in where the working tree has a symlink to
        # ../../packages/client/favicon.svg. One SVG on disk; the Nix sandbox
        # still sees a self-contained website/ with real bytes.
        let
          websiteSrc = pkgs.runCommand "kolu-website-src" { } ''
            cp -r ${./website} $out
            chmod -R u+w $out
            rm -f $out/public/favicon.svg
            cp ${./packages/client/favicon.svg} $out/public/favicon.svg
          '';
        in
        import ./website { inherit pkgs; src = websiteSrc; });
    in
    {
      homeManagerModules.default = import ./nix/home/module.nix;
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
