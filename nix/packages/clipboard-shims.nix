# Clipboard shims for xclip and wl-paste that read from KOLU_CLIPBOARD_DIR.
#
# Uses writeShellScriptBin instead of writeShellApplication to avoid pulling
# in shellcheck during Nix evaluation (~600ms savings).
{ writeShellScriptBin, symlinkJoin }:
let
  xclip-kolu-shim = writeShellScriptBin "xclip" ''
    set -eu
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

  wl-paste-kolu-shim = writeShellScriptBin "wl-paste" ''
    set -eu
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
in
symlinkJoin {
  name = "kolu-clipboard-shims";
  paths = [ xclip-kolu-shim wl-paste-kolu-shim ];
}
