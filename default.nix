# Root composer for kolu Nix packages.
#
# nix/packages/* are pure callPackage-style leaf packages, auto-injected via
# the overlay in nix/overlay.nix. The kolu build derivation and its runtime
# wrapper live here in default.nix because they need per-invocation args
# (commitHash, koluEnv, koluStamped) that aren't on pkgs.
#
# Used by flake.nix (thin wrapper), shell.nix, and nix-build directly.
{ pkgs ? import ./nix/nixpkgs.nix { }
, commitHash ? "dev"
}:
let
  inherit (pkgs)
    lib stdenv runCommand
    nodejs pnpm pnpmConfigHook fetchPnpmDeps
    python3 node-gyp pkg-config
    writeShellApplication tsx git gh;

  koluEnv = import ./nix/env.nix { inherit pkgs; };

  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
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

  pnpmDeps = fetchPnpmDeps {
    pname = "kolu";
    version = "0.1.0";
    inherit src;
    hash = "sha256-FIHG1bTz7VSKTstqncQ2RNlLdHpAuwqitwQrbubTgIY=";
    fetcherVersion = 3;
  };

  # Build uses a placeholder so docs-only commits don't bust the derivation
  # cache; koluStamped sed-replaces it with the real hash afterwards.
  koluCommitPlaceholder = "__KOLU_COMMIT_PLACEHOLDER__";

  kolu = stdenv.mkDerivation {
    pname = "kolu";
    version = "0.1.0";
    inherit src;

    nativeBuildInputs = [
      nodejs
      pnpm
      pnpmConfigHook
      python3
      node-gyp
      pkg-config
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
  koluStamped = runCommand "kolu-stamped" { } ''
    cp -r ${kolu} $out
    chmod -R u+w $out/client/dist
    find $out/client/dist -name '*.js' -exec \
      sed -i 's/${koluCommitPlaceholder}/${commitHash}/g' {} +
  '';

  # Runtime wrapper that launches kolu with all env vars set.
  default = writeShellApplication {
    name = "kolu";
    runtimeInputs = [ nodejs tsx git gh ];
    text = ''
      export KOLU_CLIENT_DIST="${koluStamped}/client/dist"
      export KOLU_CLIPBOARD_SHIM_DIR="${koluEnv.KOLU_CLIPBOARD_SHIM_DIR}"
      export KOLU_RANDOM_WORDS="${koluEnv.KOLU_RANDOM_WORDS}"
      exec tsx "${koluStamped}/server/src/index.ts" "$@"
    '';
  };
in
{
  inherit default koluEnv;
}
