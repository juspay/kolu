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
        export KOLU_THEMES_JSON="${self'.packages.ghosttyThemes}/themes.json"
        export KOLU_CLIPBOARD_SHIM_DIR="${self'.packages.clipboard-shims}/bin"
      '';
      packages = [
        self'.packages.kolu-dev
      ] ++ (with pkgs; [
        just
        nixd
        nodejs
        pnpm
        tsx
      ]);
    };
  };
}
