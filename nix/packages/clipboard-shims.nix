# Clipboard shims for xclip and wl-paste that read from KOLU_CLIPBOARD_DIR.
{ pkgs }:
let
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
in
pkgs.symlinkJoin {
  name = "kolu-clipboard-shims";
  paths = [ xclip-kolu-shim wl-paste-kolu-shim ];
}
