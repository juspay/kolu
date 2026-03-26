{ inputs, ... }:
let
  commitHash = inputs.self.shortRev or inputs.self.dirtyShortRev or "dev";
in
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
        export KOLU_FONTS_DIR="${self'.packages.fonts}"
        if root=$(git rev-parse --show-toplevel 2>/dev/null); then
          ln -sfn "$KOLU_FONTS_DIR" "$root/client/public/fonts"
        fi
        export KOLU_CLIPBOARD_SHIM_DIR="${self'.packages.clipboard-shims}/bin"
        export KOLU_COMMIT_HASH="${commitHash}"
      '';
      packages = with pkgs; [
        just
        nixd
        nodejs
        pnpm
        tsx
      ];
    };
  };
}
