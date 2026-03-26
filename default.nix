# All Nix packages for kolu.
# Used by flake.nix (thin wrapper) and nix-build directly.
{ pkgs ? import ./nix/nixpkgs.nix { }
, commitHash ? "dev"
}:
let
  nodejs = pkgs.nodejs;
  pnpm = pkgs.pnpm;
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

  src = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./package.json
      ./pnpm-workspace.yaml
      ./pnpm-lock.yaml
      ./tsconfig.base.json
      ./common
      ./server
      ./client
    ];
  };

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu";
    version = "0.1.0";
    inherit src;
    hash = "sha256-G3Vc7SxAPiaCzM4HEcfpo/bQ8pLDHVIKS8FkT07RXUM=";
    fetcherVersion = 3;
  };

  kolu = pkgs.stdenv.mkDerivation {
    pname = "kolu";
    version = "0.1.0";
    inherit src;

    nativeBuildInputs = [
      nodejs
      pnpm
      pkgs.pnpmConfigHook
      pkgs.python3
      pkgs.node-gyp
      pkgs.pkg-config
    ];

    inherit pnpmDeps;

    env.npm_config_nodedir = nodejs;
    env.NIX_NODEJS_BUILDNPMPACKAGE = "1";
    env.KOLU_THEMES_JSON = "${ghosttyThemes}/themes.json";
    env.KOLU_FONTS_DIR = "${fonts}";
    env.KOLU_COMMIT_HASH = commitHash;

    buildPhase = ''
      runHook preBuild
      pushd node_modules/.pnpm/node-pty@*/node_modules/node-pty
      node-gyp rebuild
      popd
      ln -sfn $KOLU_FONTS_DIR client/public/fonts
      pnpm --filter kolu-client build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      cp -r . $out
      rm -rf $out/client/src $out/client/node_modules
      chmod +x $out/node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true
      runHook postInstall
    '';
  };
in
{
  inherit kolu ghosttyThemes fonts clipboard-shims;

  default = pkgs.writeShellApplication {
    name = "kolu";
    runtimeInputs = [ nodejs pkgs.tsx pkgs.git ];
    text = ''
      export KOLU_CLIENT_DIST="${kolu}/client/dist"
      export KOLU_CLIPBOARD_SHIM_DIR="${clipboard-shims}/bin"
      exec tsx "${kolu}/server/src/index.ts" "$@"
    '';
  };
}
