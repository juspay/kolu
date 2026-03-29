# Dev shell — shared by `nix develop` (via flake.nix) and `nix-shell`.
{ pkgs ? import ./nix/nixpkgs.nix { } }:
let
  packages = import ./default.nix { inherit pkgs; };
in
pkgs.mkShell {
  name = "kolu-shell";

  # Env vars shared with the nix build (defined once in default.nix)
  env = packages.koluEnv // {
    KOLU_COMMIT_HASH = "dev";
    PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  };

  shellHook = ''
    pre-commit install --allow-missing-config -q 2>/dev/null || true
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
      ln -sfn "$KOLU_FONTS_DIR" "$root/client/public/fonts"
    fi
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
