# Clipboard shim scripts for bridging browser clipboard to PTY.
#
# Claude Code reads images from the system clipboard via xclip/wl-paste.
# In a web terminal these tools see the server's clipboard, not the
# browser's. These shims serve images uploaded from the browser via
# per-terminal directories indicated by $KOLU_CLIPBOARD_DIR.
{
  perSystem = { pkgs, ... }:
    let
      xclip-shim = pkgs.writeShellScriptBin "xclip" ''
        KOLU_IMG="''${KOLU_CLIPBOARD_DIR}/image.png"

        # Handle image-related clipboard reads
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

      wl-paste-shim = pkgs.writeShellScriptBin "wl-paste" ''
        KOLU_IMG="''${KOLU_CLIPBOARD_DIR}/image.png"

        for arg in "$@"; do
          case "$arg" in
            -l|--list-types)
              [ -f "$KOLU_IMG" ] && printf 'image/png\n' && exit 0
              exit 1
              ;;
          esac
        done

        # --type image/png (or similar)
        case "$*" in
          *"--type"*"image/"*)
            [ -f "$KOLU_IMG" ] && cat "$KOLU_IMG" && exit 0
            ;;
        esac
        exit 1
      '';

      clipboard-shims = pkgs.symlinkJoin {
        name = "kolu-clipboard-shims";
        paths = [ xclip-shim wl-paste-shim ];
      };
    in
    {
      packages.clipboard-shims = clipboard-shims;
    };
}
