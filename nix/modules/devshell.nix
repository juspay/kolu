{ inputs, ... }:
{
  perSystem = { config, self', pkgs, lib, ... }: {
    devShells.default = pkgs.mkShell {
      name = "kolu-shell";
      inputsFrom = [
        config.pre-commit.devShell
      ];
      shellHook = ''
        export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
        export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
      '';
      packages = [
        self'.packages.kolu-dev
      ] ++ (with pkgs; [
        just
        nixd
        nodejs
        pnpm
        tsx
        # node-gyp needs python3 + pkg-config for native addons (node-pty)
        python3
        pkg-config
      ]);
    };
  };
}
