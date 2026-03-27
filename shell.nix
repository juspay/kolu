# Dev shell — shared by `nix develop` (via flake.nix) and `nix-shell`.
{ pkgs ? import ./nix/nixpkgs.nix { } }:
let
  packages = import ./default.nix { inherit pkgs; };
  env = packages.koluEnv;
in
pkgs.mkShell {
  name = "kolu-shell";
  shellHook = ''
    pre-commit install --allow-missing-config -q 2>/dev/null || true
    export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    export KOLU_THEMES_JSON="${env.KOLU_THEMES_JSON}"
    export KOLU_FONTS_DIR="${env.KOLU_FONTS_DIR}"
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
      ln -sfn "$KOLU_FONTS_DIR" "$root/client/public/fonts"
    fi
    export KOLU_CLIPBOARD_SHIM_DIR="${env.KOLU_CLIPBOARD_SHIM_DIR}"
    export KOLU_COMMIT_HASH="${env.KOLU_COMMIT_HASH}"
  '';
  packages = with pkgs; [
    just
    nixd
    nodejs
    pnpm
    tsx
    pre-commit
    nixpkgs-fmt
    prettier
  ];
}
