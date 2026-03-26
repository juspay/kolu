# Dev shell — uses nix-shell (not nix develop) for fast startup.
# nixpkgs pin is read from flake.lock so both stay in sync.
let
  pkgs = import ./nix/nixpkgs.nix { };
  ghosttyThemes = pkgs.callPackage ./nix/ghostty-themes { };
  fonts = pkgs.callPackage ./nix/fonts { };

  xclip-kolu-shim = pkgs.writeShellApplication {
    name = "xclip";
    text = ''
      KOLU_IMG="''${KOLU_CLIPBOARD_DIR}/image.png"
      case "$*" in
        *"-selection"*"clipboard"*"-t"*"TARGETS"*"-o"*)
          [ -f "$KOLU_IMG" ] && printf 'image/png\n' && exit 0
          ;;
        *"-selection"*"clipboard"*"-t"*"image/"*"-o"*)
          [ -f "$KOLU_IMG" ] && cat "$KOLU_IMG" && exit 0
          ;;
      esac
      exit 1
    '';
  };

  wl-paste-kolu-shim = pkgs.writeShellApplication {
    name = "wl-paste";
    text = ''
      KOLU_IMG="''${KOLU_CLIPBOARD_DIR}/image.png"
      for arg in "$@"; do
        case "$arg" in
          -l|--list-types)
            [ -f "$KOLU_IMG" ] && printf 'image/png\n' && exit 0
            exit 1
            ;;
        esac
      done
      case "$*" in
        *"--type"*"image/"*)
          [ -f "$KOLU_IMG" ] && cat "$KOLU_IMG" && exit 0
          ;;
      esac
      exit 1
    '';
  };

  clipboard-shims = pkgs.symlinkJoin {
    name = "kolu-clipboard-shims";
    paths = [ xclip-kolu-shim wl-paste-kolu-shim ];
  };
in
pkgs.mkShell {
  name = "kolu-shell";
  shellHook = ''
    pre-commit install --allow-missing-config -q 2>/dev/null || true
    export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    export KOLU_THEMES_JSON="${ghosttyThemes}/themes.json"
    export KOLU_FONTS_DIR="${fonts}"
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
      ln -sfn "$KOLU_FONTS_DIR" "$root/client/public/fonts"
    fi
    export KOLU_CLIPBOARD_SHIM_DIR="${clipboard-shims}/bin"
    export KOLU_COMMIT_HASH="dev"
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
