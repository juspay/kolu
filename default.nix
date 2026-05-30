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
      ./packages/surface
      ./packages/surface-nix-host
      ./packages/solid-pierre
      ./packages/common
      ./packages/integrations
      ./packages/nonempty
      ./packages/shared
      ./packages/terminal-themes
      ./packages/memorable-names
      ./packages/pty-host
      ./packages/server
      ./packages/client
      ./packages/transcript-core
      ./packages/transcript-html
      ./packages/artifact-sdk
    ];
  };

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu";
    version = "0.1.0";
    inherit src;
    # Platform-independent. fetchPnpmDeps runs `pnpm install --force`, which
    # sets includeIncompatiblePackages=true and bypasses pnpm's os/cpu/libc
    # gating (pkg-manager/headless/src/index.ts:260 in pnpm 10.32.1), so
    # Darwin and Linux populate byte-identical pnpm stores. `just ci::pnpm-
    # hash-fresh` enforces this stays in sync with pnpm-lock.yaml by forcing
    # fetchPnpmDeps to re-execute (--rebuild), so stale artifacts in the
    # binary cache can't silently satisfy a hash that no longer matches.
    hash = "sha256-3PHwtkW+K7ciV5GY++U/o0aAnPkTH07jff4XiaznzhY=";
    fetcherVersion = 3;
  };

  # Build uses a placeholder so docs-only commits don't bust the derivation
  # cache; koluStamped sed-replaces it with the real hash afterwards.
  koluCommitPlaceholder = "__KOLU_COMMIT_PLACEHOLDER__";

  # Constraint #6: the daemon "outdated" staleness key. Hash ONLY the
  # @kolu/pty-host source (runtime *.ts, excluding tests) + its package.json,
  # so the key changes iff terminal-host code/deps change. Keying on the whole
  # kolu store hash (the old `argv[1]` approach) over-fired: every deploy,
  # even pty-host-untouched ones, flipped `outdated` and nudged the user into a
  # terminal-losing restart for zero benefit. Computed independently of
  # commitHash so docs/server-only commits don't bust it.
  #
  # Cross-platform reproducible (Darwin+Linux must agree, like pnpmDeps):
  # `find | sort` for a stable file order, then a single sha256 over the
  # concatenated curated bytes. node-pty / @xterm versions ride along via
  # package.json (their `dependencies` entries), keeping the input source-
  # scoped — we never hash node_modules.
  ptyHostSrc = pkgs.lib.fileset.toSource {
    root = ./packages/pty-host;
    fileset = pkgs.lib.fileset.unions [
      (pkgs.lib.fileset.fileFilter
        (f: f.hasExt "ts" && !pkgs.lib.hasSuffix ".test.ts" f.name)
        ./packages/pty-host/src)
      ./packages/pty-host/package.json
    ];
  };
  ptyHostBuildId = builtins.readFile (pkgs.runCommand "kolu-pty-host-build-id"
    { src = ptyHostSrc; } ''
    cd "$src"
    find . -type f | LC_ALL=C sort | xargs cat | sha256sum | cut -c1-64 \
      | tr -d '\n' > $out
  '');

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

    # The fixupPhase (strip, patchShebangs, patchELF) traverses the entire
    # output tree (~395MB of node_modules). For a Node.js app this is pure
    # overhead: shebangs are already patched by pnpmConfigHook, and the
    # only native binary (node-pty .node) is correctly linked by node-gyp.
    dontFixup = true;

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
      ln -sfn $KOLU_FONTS_DIR packages/client/public/fonts
      pnpm --filter kolu-client build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      # Strip build-only packages and artifacts BEFORE copying to $out.
      # Removing ~187MB of dev deps here means cp -r copies 208MB instead
      # of 395MB, halving the I/O and Nix NAR hashing time.
      rm -rf packages/client/src packages/client/node_modules
      pushd node_modules/.pnpm
      # NOTE: esbuild is kept (NOT pruned) because @kolu/artifact-sdk's server
      # module bundles the in-iframe SDK script at runtime via esbuild. The
      # cost is ~15MB in the production NAR for one platform-specific binary;
      # the simplicity win is no separate build-step coordination with Nix.
      rm -rf typescript@* \
             lightningcss* rollup@* @rollup* \
             vitest@* @vitest* \
             vite@* vitefu@* vite-plugin-* @tailwindcss* tailwindcss@* \
             @babel* babel-plugin-* \
             es-abstract@* caniuse-lite@* browserslist@* update-browserslist-db@* \
             @types+node@* @types+ws@* \
             core-js-compat@* regexpu-core@* regjsparser@* terser@*
      local pty=node-pty@*/node_modules/node-pty
      rm -rf $pty/prebuilds $pty/third_party $pty/deps $pty/src $pty/scripts \
             $pty/build/Release/obj.target $pty/node-addon-api@*
      popd

      cp -r . $out

      runHook postInstall
    '';
  };

  # Stamp the real commit hash into the built JS bundle.
  # Only this re-runs on docs-only commits; the expensive build above is cached.
  koluStamped = pkgs.runCommand "kolu-stamped" { } ''
    cp -r ${kolu} $out
    chmod -R u+w $out/packages/client/dist
    find $out/packages/client/dist -name '*.js' -exec \
      sed -i 's/${koluCommitPlaceholder}/${commitHash}/g' {} +
  '';

  # Base wrapper: tsx + env vars + PATH. Does NOT set KOLU_STATE_DIR —
  # callers must provide it (state.ts crashes with a clear error if missing).
  # Tests use this directly so a missing KOLU_STATE_DIR crashes immediately
  # instead of silently falling back to the production ~/.config/kolu path.
  koluBin = pkgs.runCommand "kolu-bin"
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
      --add-flags "${koluStamped}/packages/server/src/index.ts" \
      --set KOLU_CLIENT_DIST "${koluStamped}/packages/client/dist" \
      --set KOLU_GH_BIN "${koluEnv.KOLU_GH_BIN}" \
      --set KOLU_PTY_HOST_BUILD_ID "${ptyHostBuildId}" \
      --prefix PATH : ${pkgs.lib.makeBinPath ([ pkgs.nodejs pkgs.git pkgs.gh ]
        # R4c (#951): the daemon supervisor shells out to `systemd-run` /
        # `systemctl --user` to spawn the PTY-host daemon in its own cgroup
        # (so it survives a deploy). systemd units run with a minimal PATH, so
        # put them on it explicitly rather than rely on inheriting
        # /run/current-system/sw/bin. Linux only — macOS uses a detached spawn.
        ++ pkgs.lib.optional pkgs.stdenv.hostPlatform.isLinux pkgs.systemd)} \
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

  # Production wrapper: koluBin + default KOLU_STATE_DIR.
  # Used by `nix run .` and the NixOS service. Sets the state dir
  # unconditionally — no `:-` override, so tests can't accidentally
  # inherit the production path.
  default = pkgs.runCommand "kolu"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "kolu";
    } ''
    mkdir -p $out/bin
    makeWrapper ${koluBin}/bin/kolu $out/bin/kolu \
      --run 'export KOLU_STATE_DIR="''${XDG_CONFIG_HOME:-$HOME/.config}/kolu"'
  '';

  # @kolu/surface remote-process-monitor demo — derivations live next
  # to the demo source, not here. Pass through the workspace-wide
  # `src` + `pnpmDeps` so the fixed-output fetch is cached once.
  remoteProcessMonitor = import ./packages/surface/example/remote-process-monitor/default.nix {
    inherit pkgs src pnpmDeps;
  };
in
{
  inherit default koluBin koluEnv pnpmDeps;
} // remoteProcessMonitor
