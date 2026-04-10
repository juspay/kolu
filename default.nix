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
  worktreeWords = pkgs.callPackage ./nix/worktree-words { };

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
      ./integrations
      ./server
      ./client
      # pnpm.patchedDependencies entries — read by pnpm during install and
      # applied to the upstream tarball. Currently:
      #   - node-pty@1.1.0.patch: adds a foregroundPid accessor wrapping
      #     tcgetpgrp(masterFd). Upstream feature request:
      #     https://github.com/microsoft/node-pty/issues/913 — drop this
      #     patch once that lands.
      ./patches
    ];
  };

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu";
    version = "0.1.0";
    inherit src;
    hash = "sha256-FIHG1bTz7VSKTstqncQ2RNlLdHpAuwqitwQrbubTgIY=";
    fetcherVersion = 3;
  };

  # Shared env vars — used by the kolu build, the devShell, and the wrapper.
  # KOLU_COMMIT_HASH excluded — it busts the derivation cache on every commit.
  # The build uses a placeholder; koluStamped stamps the real hash afterwards.
  koluEnv = {
    KOLU_THEMES_JSON = "${ghosttyThemes}/themes.json";
    KOLU_FONTS_DIR = "${fonts}";
    KOLU_CLIPBOARD_SHIM_DIR = "${clipboard-shims}/bin";
    KOLU_RANDOM_WORDS = "${worktreeWords}";
  };

  koluCommitPlaceholder = "__KOLU_COMMIT_PLACEHOLDER__";

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

    env = {
      npm_config_nodedir = nodejs;
      NIX_NODEJS_BUILDNPMPACKAGE = "1";
      KOLU_COMMIT_HASH = koluCommitPlaceholder;
    } // koluEnv;

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

  # Stamp the real commit hash into the built JS bundle.
  # Only this re-runs on docs-only commits; the expensive build above is cached.
  koluStamped = pkgs.runCommand "kolu-stamped" { } ''
    cp -r ${kolu} $out
    chmod -R u+w $out/client/dist
    find $out/client/dist -name '*.js' -exec \
      sed -i 's/${koluCommitPlaceholder}/${commitHash}/g' {} +
  '';
in
{
  inherit kolu ghosttyThemes fonts clipboard-shims koluEnv;

  default = pkgs.writeShellApplication {
    name = "kolu";
    runtimeInputs = [ nodejs pkgs.tsx pkgs.git pkgs.gh ];
    text = ''
      export KOLU_CLIENT_DIST="${koluStamped}/client/dist"
      export KOLU_CLIPBOARD_SHIM_DIR="${koluEnv.KOLU_CLIPBOARD_SHIM_DIR}"
      export KOLU_RANDOM_WORDS="${koluEnv.KOLU_RANDOM_WORDS}"
      exec tsx "${koluStamped}/server/src/index.ts" "$@"
    '';
  };
}
