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

  # App version — the SINGLE source of truth is packages/server/package.json
  # (`/release` bumps it before tagging; the server reads the same file at
  # runtime via pkg.version). Read it here so the nix artifact's version tracks
  # it with no duplicated literal to drift.
  version = (pkgs.lib.importJSON ./packages/server/package.json).version;

  # INVARIANT: this fileset must include every workspace package that has a
  # `typecheck` script — the typecheck derivation (nix/pnpm-typecheck.nix) reuses
  # this `src`, so a package omitted here is silently skipped by the type
  # gate even though `just check` (full working tree) would catch it.
  # packages/tests is the only workspace member intentionally absent: it has
  # no typecheck script, so it's outside the gate's scope either way.
  src = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./package.json
      ./pnpm-workspace.yaml
      ./pnpm-lock.yaml
      ./tsconfig.base.json
      ./packages/surface
      ./packages/surface-mcp
      ./packages/surface-nix-host
      ./packages/surface-app
      ./packages/surface-daemon
      ./packages/surface-daemon-supervisor
      ./packages/solid-pierre
      ./packages/solid-markdown
      ./packages/solid-pwa-install
      ./packages/solid-fileview
      ./packages/solid-browser
      ./packages/common
      ./packages/integrations
      ./packages/nonempty
      ./packages/shared
      ./packages/terminal-themes
      ./packages/memorable-names
      ./packages/terminal-protocol
      ./packages/kaval
      ./packages/kaval-tui
      ./packages/server
      ./packages/client
      ./packages/transcript-core
      ./packages/transcript-html
      ./packages/artifact-sdk
      ./packages/serve-dir
      ./packages/html-escape
      ./packages/url-shape
      ./packages/log
    ];
  };

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu";
    inherit version src;
    # Platform-independent. fetchPnpmDeps runs `pnpm install --force`, which
    # sets includeIncompatiblePackages=true and bypasses pnpm's os/cpu/libc
    # gating (pkg-manager/headless/src/index.ts:260 in pnpm 10.32.1), so
    # Darwin and Linux populate byte-identical pnpm stores. `just ci::pnpm-
    # hash-fresh` enforces this stays in sync with pnpm-lock.yaml by forcing
    # fetchPnpmDeps to re-execute (--rebuild), so stale artifacts in the
    # binary cache can't silently satisfy a hash that no longer matches.
    hash = "sha256-gRSVtm1TZoz2Tyqg1a0B19uWdHFE9OJLlzdahrdUw14=";
    fetcherVersion = 3;
  };

  # Build uses a placeholder so docs-only commits don't bust the derivation
  # cache; koluStamped sed-replaces it with the real hash afterwards.
  koluCommitPlaceholder = "__KOLU_COMMIT_PLACEHOLDER__";

  # The staleKey (R-4 A2, re-rooted in B1): a content hash of kaval's daemon
  # source closure — the survivor's wire + behaviour. Baked into KAVAL_BUILD_ID
  # below so the server (and, in phase B, a surviving daemon) can tell whether a
  # restart would load different daemon code. Scoped to the three roots that run
  # IN the daemon — kaval, terminal-protocol, and the surface-daemon spine — so
  # server-/client-only deploys leave it unchanged (no over-prompting). The .ts
  # filter drops `.test.ts` AND `.testlib.ts` (shared test-only helpers), and
  # LC_ALL=C sort makes the hash byte-identical across Darwin/Linux. The set
  # hashed here is asserted to equal the daemon's reachable closure by
  # packages/kaval/src/buildId.closure.test.ts — keep the fileFilter and that
  # test in lockstep.
  isHashedSource =
    f: f.hasExt "ts"
      && !pkgs.lib.hasSuffix ".test.ts" f.name
      && !pkgs.lib.hasSuffix ".testlib.ts" f.name;
  kavalSrc = pkgs.lib.fileset.toSource {
    root = ./packages;
    fileset = pkgs.lib.fileset.unions [
      (pkgs.lib.fileset.fileFilter isHashedSource ./packages/kaval/src)
      ./packages/kaval/package.json
      # @kolu/terminal-protocol is wire/behaviour the daemon serves (the
      # device-query forward/drop policy + the suppression grammars), reached
      # from the runtime closure — so it is hashed too, or a protocol change
      # would escape the staleKey.
      (pkgs.lib.fileset.fileFilter isHashedSource ./packages/terminal-protocol/src)
      ./packages/terminal-protocol/package.json
      # @kolu/surface-daemon is the daemon spine — the pid-gate and the
      # `daemonMain` skeleton run inside the daemon process, so a change to them
      # is a change to what a restart loads. Hashed WHOLE (its standing
      # invariant: only daemon-running code lives there — the supervisor
      # half is its own un-hashed package from B2).
      (pkgs.lib.fileset.fileFilter isHashedSource ./packages/surface-daemon/src)
      ./packages/surface-daemon/package.json
    ];
  };

  kavalBuildId = builtins.readFile (pkgs.runCommand "kaval-build-id"
    { src = kavalSrc; } ''
    cd "$src"
    find . -type f | LC_ALL=C sort | xargs cat | sha256sum | cut -c1-64 \
      | tr -d '\n' > $out
  '');

  kolu = pkgs.stdenv.mkDerivation {
    pname = "kolu";
    inherit version src;

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

    # NOTE: this does NOT typecheck. The client is bundled by Vite (per-file
    # transpile) and the server runs under tsx at runtime, so a green
    # `nix build .#default` is not a type-proof (juspay/kolu#1049). The type
    # gate is the separate `typecheck` derivation below, exposed as a flake
    # check and built by CI's `nix` node.
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
      --set KOLU_COMMIT_HASH "${commitHash}" \
      --set KAVAL_BUILD_ID "${kavalBuildId}" \
      --set KAVAL_COMMIT_HASH "${commitHash}" \
      --set KOLU_KAVAL_BIN "${kaval}/bin/kaval" \
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

  # kaval (R-4 Phase B): the standalone PTY daemon — owns the node-pty children,
  # mirrors their screens, and serves `ptyHostSurface` over its own unix socket.
  # Runs from the SAME built workspace closure as `kolu` (so kaval + @kolu/surface
  # + @kolu/surface-daemon resolve identically). Carries its OWN identity env
  # (KAVAL_BUILD_ID / KAVAL_COMMIT_HASH) so a standalone kaval reports a real
  # `system.version`. In B1 kolu still embeds the host in-process; this bin is the
  # runnable program the daemon flip (B2) will spawn.
  #
  # Launched as `node --import <tsx loader> bin.ts`, NOT `tsx bin.ts`: tsx's CLI
  # forks a child, and that fork does NOT relay SIGTERM to the daemon's
  # `waitForShutdown` — the daemon gets killed (143) and LEAKS its socket + gate
  # instead of releasing them. The single-process loader form delivers the signal
  # to the daemon directly, so SIGTERM teardown works (proven by socketDaemon.test's
  # "shipped tsx-CLI wrapper" guard, which spawns BOTH shapes and pins the diff).
  kaval = pkgs.runCommand "kaval"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "kaval";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.nodejs}/bin/node $out/bin/kaval \
      --add-flags "--import ${pkgs.tsx}/lib/tsx/dist/loader.mjs" \
      --add-flags "${kolu}/packages/kaval/src/bin.ts" \
      --set KAVAL_BUILD_ID "${kavalBuildId}" \
      --set KAVAL_COMMIT_HASH "${commitHash}" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]}
  '';

  # kaval-tui (R-4 Phase 1): the terminal-side CLI that dials a running kaval's
  # (or, with --socket, a kolu-server's) pty-host unix socket and lists/snapshots/
  # attaches its live PTYs. Runs from the SAME built workspace closure as `kolu`
  # (so kaval + @kolu/surface resolve identically) under tsx — no client bundle,
  # no state dir, just nodejs.
  kaval-tui = pkgs.runCommand "kaval-tui"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "kaval-tui";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/kaval-tui \
      --add-flags "${kolu}/packages/kaval-tui/src/main.ts" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]}
  '';

  # @kolu/surface example demos — derivations live next to each demo's
  # source, not here. Pass through the workspace-wide `src` + `pnpmDeps`
  # so the fixed-output fetch is cached once.
  remoteProcessMonitor = import ./packages/surface/example/remote-process-monitor/default.nix {
    inherit pkgs src pnpmDeps;
  };
  miniCi = import ./packages/surface/example/mini-ci/default.nix {
    inherit pkgs src pnpmDeps;
  };

  # odu — the CI runner that grew out of the mini-ci example (Atlas:
  # mini-ci-vs-justci) and graduated to github.com/juspay/odu. kolu consumes
  # it back via npins (`npins update odu` to bump) and RE-EXPORTS its two
  # packages, so `nix run .#odu` and the coordinator's
  # `nix eval .#packages.<platform>.odu-runner.drvPath` keep working from
  # this repo. odu is built with its own pinned nixpkgs + kolu pin (it
  # consumes @kolu/surface upstream, the drishti pattern) — the import here
  # threads only the system.
  oduSources = import ./npins;
  oduUpstream = import oduSources.odu {
    pkgs = import (oduSources.odu + "/nix/nixpkgs.nix") {
      system = pkgs.stdenv.hostPlatform.system;
    };
  };
  oduPackages = { inherit (oduUpstream) odu odu-runner; };

  # @kolu/solid-browser docsite — a standalone second consumer of createBrowser
  # (the history electricity), built so CI proves the reuse claim doesn't rot.
  docsiteExample = import ./packages/solid-browser/example/docsite/default.nix {
    inherit pkgs src pnpmDeps;
  };

  # The workspace type gate (juspay/kolu#1049): `tsc --noEmit` over every
  # package. Reuses this build's `src` + `pnpmDeps` — every package with a
  # typecheck script is in the `src` fileset above (see its INVARIANT
  # comment), so this checks exactly what `pnpm typecheck` does. flake.nix
  # strips this from `packages` and routes it to `checks`.
  typecheck = import ./nix/pnpm-typecheck.nix {
    inherit pkgs src pnpmDeps version;
    pname = "kolu-typecheck";
  };
in
{
  inherit default koluBin kaval kaval-tui koluEnv pnpmDeps typecheck;
} // remoteProcessMonitor // miniCi // docsiteExample // oduPackages
