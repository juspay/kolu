# All Nix packages for kolu.
# Used by flake.nix (thin wrapper) and nix-build directly.
{ pkgs ? import ./nix/nixpkgs.nix { }
, commitHash ? "dev"
}:
let
  bun = pkgs.bun;
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

  # Minimal source for the dependency FOD — just package.json files and lockfile.
  # Separate from src so that source code changes don't invalidate the dep cache.
  depsSrc = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./package.json
      ./bun.lock
      ./common/package.json
      ./server/package.json
      ./client/package.json
      ./tests/package.json
    ];
  };

  src = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./package.json
      ./bun.lock
      ./tsconfig.base.json
      ./common
      ./server
      ./client
      ./tests/package.json
    ];
  };

  # Fixed-output derivation: download all bun dependencies into a cache.
  # Hash must be updated when bun.lock changes (build will show correct hash).
  bunDeps = pkgs.stdenvNoCC.mkDerivation {
    name = "kolu-bun-deps";
    src = depsSrc;

    nativeBuildInputs = [ bun pkgs.cacert ];

    dontConfigure = true;
    dontBuild = true;

    impureEnvVars = pkgs.lib.fetchers.proxyImpureEnvVars;

    installPhase = ''
      export HOME=$(mktemp -d)
      export BUN_INSTALL_CACHE_DIR=$out/cache
      mkdir -p $out/cache
      bun install --frozen-lockfile
      # Only keep the cache; node_modules will be recreated in the main build
      rm -rf node_modules

      # Normalize permissions for reproducibility
      find $out -type f -print0 | xargs -0 chmod 444
      find $out -type d -print0 | xargs -0 chmod 555
    '';

    outputHashMode = "recursive";
    # Platform-specific: bun downloads native packages (esbuild, lightningcss)
    outputHash = {
      x86_64-linux = "sha256-TJZGa/BbqpVb95X2DULoPWdVkTOuCmYIBdMiPVRQGE8=";
      aarch64-darwin = "sha256-h/TvfXdGo/ex+UYtOeWHJHjCsMHtiJ4NQuDuxzOiF2k=";
    }.${pkgs.stdenv.hostPlatform.system};
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
      bun
      # node symlink so patchShebangs can resolve #!/usr/bin/env node shebangs.
      # bun is node-compatible and runs these scripts correctly.
      (pkgs.writeShellScriptBin "node" ''exec ${bun}/bin/bun "$@"'')
    ];

    env = {
      KOLU_COMMIT_HASH = koluCommitPlaceholder;
    } // koluEnv;

    configurePhase = ''
      export HOME=$(mktemp -d)
      export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
      cp -r ${bunDeps}/cache/. "$BUN_INSTALL_CACHE_DIR/"
      chmod -R u+w "$BUN_INSTALL_CACHE_DIR"
      bun install --frozen-lockfile
      patchShebangs node_modules */node_modules
    '';

    buildPhase = ''
      runHook preBuild
      ln -sfn $KOLU_FONTS_DIR client/public/fonts
      pushd client
      bun run build
      popd
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      cp -r . $out
      rm -rf $out/client/src $out/client/node_modules
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
    runtimeInputs = [ bun pkgs.git pkgs.gh ];
    text = ''
      export KOLU_CLIENT_DIST="${koluStamped}/client/dist"
      export KOLU_CLIPBOARD_SHIM_DIR="${koluEnv.KOLU_CLIPBOARD_SHIM_DIR}"
      export KOLU_RANDOM_WORDS="${koluEnv.KOLU_RANDOM_WORDS}"
      exec bun "${koluStamped}/server/src/index.ts" "$@"
    '';
  };
}
