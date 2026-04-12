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
  koluEnv = import ./nix/env.nix { inherit pkgs; };

  src = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./package.json
      ./pnpm-workspace.yaml
      ./pnpm-lock.yaml
      ./tsconfig.base.json
      ./common
      ./integrations
      ./workspace-fs
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
    hash = "sha256-uDUcuuFr9K01/SbJjlBnQ8xv5HWf/4oaUXEo2Ts1248=";
    fetcherVersion = 3;
  };

  # Build uses a placeholder so docs-only commits don't bust the derivation
  # cache; koluStamped sed-replaces it with the real hash afterwards.
  koluCommitPlaceholder = "__KOLU_COMMIT_PLACEHOLDER__";

  kolu = pkgs.stdenv.mkDerivation {
    pname = "kolu";
    version = "0.1.0";
    inherit src;

    nativeBuildInputs = [
      pkgs.nodejs
      pkgs.pnpm
      pkgs.pnpmConfigHook
      pkgs.python3
      pkgs.node-gyp
      pkgs.pkg-config
    ];

    inherit pnpmDeps;

    env = {
      npm_config_nodedir = pkgs.nodejs;
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

  # Runtime wrapper around tsx with env vars and PATH baked in.
  default = pkgs.runCommand "kolu"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "kolu";
    } ''
    mkdir -p $out/bin
    # If KOLU_DIAG_DIR is set, the --run hook computes a per-invocation
    # subdir, cds into it, and injects V8 heap-snapshot flags into
    # NODE_OPTIONS. The cd is load-bearing: both --heapsnapshot-signal
    # and --heapsnapshot-near-heap-limit write to cwd (nodejs/node#47842),
    # so landing in the per-invocation dir makes all capture paths
    # (baseline, SIGUSR2, near-OOM) correlate to one directory.
    # Unset = passthrough, zero overhead.
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/kolu \
      --add-flags "${koluStamped}/server/src/index.ts" \
      --set KOLU_CLIENT_DIST "${koluStamped}/client/dist" \
      --set KOLU_CLIPBOARD_SHIM_DIR "${koluEnv.KOLU_CLIPBOARD_SHIM_DIR}" \
      --set KOLU_RANDOM_WORDS "${koluEnv.KOLU_RANDOM_WORDS}" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.git pkgs.gh ]} \
      --run 'if [ -n "''${KOLU_DIAG_DIR:-}" ]; then
               KOLU_DIAG_DIR="$KOLU_DIAG_DIR/$(date +%Y%m%dT%H%M%S)-$$"
               if ! mkdir -p "$KOLU_DIAG_DIR" || ! cd "$KOLU_DIAG_DIR"; then
                 echo "kolu: failed to set up diag dir $KOLU_DIAG_DIR (check permissions)" >&2
                 exit 1
               fi
               export KOLU_DIAG_DIR
               export NODE_OPTIONS="--heapsnapshot-near-heap-limit=3 --heapsnapshot-signal=SIGUSR2 ''${NODE_OPTIONS:-}"
             fi'
  '';
in
{
  inherit default koluEnv;
}
