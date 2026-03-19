{ inputs, ... }:
{
  perSystem = { config, self', pkgs, lib, ... }: {
    devShells.default = pkgs.mkShell {
      name = "kolu-shell";
      inputsFrom = [
        self'.devShells.rust
        config.pre-commit.devShell
      ];
      shellHook = ''
        export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
        export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
      '';
      packages = with pkgs; [
        just
        nixd
        trunk
        tailwindcss
        wasm-bindgen-cli
        cargo-watch
        nodejs
      ];
    };
  };
}
