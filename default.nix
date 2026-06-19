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
  # TEST-ONLY hook: when set (e.g. "9.0"), rewrite the daemon's
  # `PTY_HOST_CONTRACT_VERSION` so this build's server *and* the kaval it spawns
  # speak an incompatible wire. Used by the adoption-skew VM test to build a
  # "newer kolu" whose handshake rejects (and recycles) a surviving older daemon
  # — there is no env seam for the contract version (it's a source constant), so
  # the skew can only be produced at build time. `null` (the default) is a no-op,
  # so the real build is untouched.
, contractVersionOverride ? null
  # TEST-ONLY hook: when set, FORCE this build's KAVAL_BUILD_ID to the given
  # value instead of the source-closure hash. Used by the adoption build-skew VM
  # test (B3.4) to build a "newer kolu" whose `expectedKaval.staleKey` differs
  # from a surviving DEFAULT-built daemon's reported staleKey — a genuine
  # *build*-behind survivor with a COMPATIBLE wire contract, so it's adopted (not
  # recycled) and the read-site currency nudge fires. The same value is `--set`
  # onto BOTH this build's koluBin wrapper and its kaval bin, so the build stays
  # internally consistent (its expected == what it would spawn). `null` (the
  # default) computes the real source hash, so the real build is untouched. This
  # is the nix-value analog of `contractVersionOverride` (which seds a source
  # constant); KAVAL_BUILD_ID is nix-injected, so this overrides the value, not a
  # source file.
, kavalBuildIdOverride ? null
  # Per-system `{ system → kaval .drv }` map, baked onto the kaval-tui wrapper as
  # KAVAL_AGENT_DRVS_JSON so `kaval-tui --host <ssh>` can ship the target-arch
  # kaval derivation (provisionAgent copies+realises it on the remote). default.nix
  # is single-system, so the map is built across all systems in flake.nix and
  # threaded in here. Defaults to "{}" for a bare `nix-build default.nix` (no
  # --host map; --host then fails with a clear "run from the Nix wrapper" error).
, kavalAgentDrvsJson ? "{}"
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
      ./packages/terminal-awareness
      ./packages/terminal-protocol
      ./packages/kaval
      ./packages/kaval-tui
      ./packages/server
      ./packages/client
      ./packages/transcript-core
      ./packages/transcript-html
      ./packages/artifact-sdk
      ./packages/serve-dir
      ./packages/heap-diag
      ./packages/html-escape
      ./packages/shell-quote
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
    hash = "sha256-YICTc8q9k5B+Dl3E88glorSdby7DQaRV3M6iNmnXkpM=";
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
  # filter drops `.test.ts` AND `.testlib.ts` (shared test-only helpers); the id
  # (below) is taken over this fileset's content-addressed store path, whose NAR
  # hash is byte-identical across Darwin/Linux. The set hashed here is asserted
  # to equal the daemon's reachable closure by
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
      # @kolu/surface-daemon is the daemon spine — both halves of the kaval
      # *binary* a restart loads. The serve half (pid-gate + the `daemonMain`
      # skeleton) runs inside the daemon process; the front half
      # (`frontDaemonOverStdio`, P2.5) runs in the per-link proxy reached from
      # `bin.ts`'s `--stdio` dispatch — so a change to either is a change to what
      # that binary loads. Hashed WHOLE (its standing invariant, broadened in
      # P2.5: only daemon-BINARY code — serve + front — lives there; the
      # supervisor half is its own un-hashed package from B2).
      (pkgs.lib.fileset.fileFilter isHashedSource ./packages/surface-daemon/src)
      ./packages/surface-daemon/package.json
    ];
  };

  # A content digest of kaval's daemon source closure, baked into KAVAL_BUILD_ID.
  # kavalSrc is content-addressed (fileset.toSource adds it to the store at eval
  # time), so its store path already changes iff any hashed file changes — hash
  # that path to a stable, platform-independent 64-char id. Computed PURELY in
  # Nix: no import-from-derivation, so `nix flake check` can evaluate every
  # output without realising a build mid-eval (juspay/kolu#1317).
  # `kavalBuildIdOverride` (TEST-ONLY, default null) forces this value for the
  # build-skew VM test (B3.4); the real build always takes the source hash.
  kavalBuildId =
    if kavalBuildIdOverride != null
    then kavalBuildIdOverride
    else builtins.hashString "sha256" "${kavalSrc}";

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

    # TEST-ONLY contract-version skew (see the function arg). A no-op unless
    # `contractVersionOverride` is set; then the daemon's single source-constant
    # version is rewritten so both the server and the kaval it spawns speak it.
    postPatch = pkgs.lib.optionalString (contractVersionOverride != null) ''
      sed -i 's|PTY_HOST_CONTRACT_VERSION = "[^"]*"|PTY_HOST_CONTRACT_VERSION = "${contractVersionOverride}"|' \
        packages/kaval/src/ptyHostSurface.ts
      grep -q 'PTY_HOST_CONTRACT_VERSION = "${contractVersionOverride}"' \
        packages/kaval/src/ptyHostSurface.ts \
        || { echo "contractVersionOverride: PTY_HOST_CONTRACT_VERSION constant not found — update default.nix" >&2; exit 1; }
    '';

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

  # Stamp the real commit hash into the no-store SHELL (index.html), NOT the
  # hashed JS bundle. The `surfaceApp()` Vite plugin injects the placeholder
  # onto the shell global (`window.__SURFACE_APP_COMMIT__`), so it lands in
  # index.html only. Stamping the shell — not a `/assets/*.js` file — is the fix
  # for kolu#1319: the JS is content-hashed and served `immutable`, so rewriting
  # its bytes under an unchanged filename (what the old `find … -name '*.js'`
  # did) stranded every returning browser on the year-cached old stamp whenever
  # two deploys differed only outside the client build (a docs-only commit). The
  # shell is re-fetched on every load (`no-store`), so a commit stamped here is
  # always the deployed one. Only this step re-runs on docs-only commits; the
  # expensive build above is cached. The placeholder appears exactly once, in
  # index.html — assert that so a future build-graph change that moves it (back
  # into the bundle, or drops it) fails LOUD here instead of silently shipping an
  # unstamped or mis-stamped shell.
  koluStamped = pkgs.runCommand "kolu-stamped" { } ''
    cp -r ${kolu} $out
    chmod -R u+w $out/packages/client/dist
    shell="$out/packages/client/dist/index.html"
    if ! grep -q '${koluCommitPlaceholder}' "$shell"; then
      echo "koluStamped: '${koluCommitPlaceholder}' not found in index.html — the surfaceApp() shell injection broke (kolu#1319)." >&2
      exit 1
    fi
    if grep -rl '${koluCommitPlaceholder}' "$out/packages/client/dist/assets" 2>/dev/null; then
      echo "koluStamped: '${koluCommitPlaceholder}' leaked into a hashed /assets/* file — identity must ride the shell, not an immutable bundle (kolu#1319)." >&2
      exit 1
    fi
    sed -i 's/${koluCommitPlaceholder}/${commitHash}/g' "$shell"
  '';

  # The opt-in heap-capture --run hook, defined ONCE for every kolu-family
  # wrapper (koluBin + kaval) — the Nix half of the same capability `@kolu/heap-
  # diag` is the TS half of. When KOLU_DIAG_DIR is set, it computes a per-
  # invocation subdir (named `<prefix><timestamp>-<pid>`), cds into it, and
  # injects the V8 heap-snapshot flags into NODE_OPTIONS. The cd is load-bearing:
  # both --heapsnapshot-signal and --heapsnapshot-near-heap-limit write to cwd
  # (nodejs/node#47842), so landing in the per-invocation dir makes all capture
  # paths (baseline, SIGUSR2, near-OOM) correlate to one directory. mkdir/cd
  # failure is FATAL (exit 1), never a silent degrade. Unset = passthrough, zero
  # overhead. `prefix` namespaces a daemon's captures under the server's diag
  # tree (kaval forwards KOLU_DIAG_DIR and lands in `kaval-…`).
  #
  # `--heapsnapshot-near-heap-limit=3` makes V8 dump a heap snapshot when within
  # 3 GCs of its heap ceiling (whatever that ceiling is — kaval and koluBin both
  # run under V8's RAM-derived default), so the next approach to an OOM leaves a
  # diagnosable snapshot behind instead of a bare abort. This is the diagnostics
  # safety net, not a memory cap — kaval is NOT given an explicit
  # `--max-old-space-size`; the per-terminal mirror shrink (DEFAULT_MIRROR_
  # SCROLLBACK) is the actual heap-OOM fix, and an explicit cap would only lower
  # the ceiling the fix raised (see kaval-heap-oom.mdx).
  diagRunHook = prefix: ''
    if [ -n "''${KOLU_DIAG_DIR:-}" ]; then
      KOLU_DIAG_DIR="$KOLU_DIAG_DIR/${prefix}$(date +%Y%m%dT%H%M%S)-$$"
      if ! mkdir -p "$KOLU_DIAG_DIR" || ! cd "$KOLU_DIAG_DIR"; then
        echo "kolu: failed to set up diag dir $KOLU_DIAG_DIR (check permissions)" >&2
        exit 1
      fi
      export KOLU_DIAG_DIR
      export NODE_OPTIONS="--heapsnapshot-near-heap-limit=3 --heapsnapshot-signal=SIGUSR2 ''${NODE_OPTIONS:-}"
    fi'';

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
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/kolu \
      --add-flags "${koluStamped}/packages/server/src/index.ts" \
      --set KOLU_CLIENT_DIST "${koluStamped}/packages/client/dist" \
      --set KOLU_GH_BIN "${koluEnv.KOLU_GH_BIN}" \
      --set KOLU_COMMIT_HASH "${commitHash}" \
      --set KAVAL_BUILD_ID "${kavalBuildId}" \
      --set KAVAL_COMMIT_HASH "${commitHash}" \
      --set KOLU_KAVAL_BIN "${kaval}/bin/kaval" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.git pkgs.gh ]} \
      --run ${pkgs.lib.escapeShellArg (diagRunHook "")}
  '';

  # Production wrapper: koluBin + default KOLU_STATE_DIR.
  # Used by `nix run .` and the NixOS service. Defaults the state dir to
  # ~/.config/kolu but honors an inherited KOLU_STATE_DIR (`:-` fallback) —
  # so a second production instance can relocate state without hijacking
  # $HOME (juspay/kolu#1414). Restoring this fallback can NOT reintroduce the
  # silent-production-corruption bug #530/#531 fixed: tests build `.#koluBin`
  # (justfile:122), which has no KOLU_STATE_DIR and crashes if unset, and so
  # never go through this wrapper.
  default = pkgs.runCommand "kolu"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "kolu";
    } ''
    mkdir -p $out/bin
    makeWrapper ${koluBin}/bin/kolu $out/bin/kolu \
      --run 'export KOLU_STATE_DIR="''${KOLU_STATE_DIR:-''${XDG_CONFIG_HOME:-$HOME/.config}/kolu}"'
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
    # kaval runs under V8's RAM-derived default heap ceiling — NO explicit
    # `--max-old-space-size`. The heap-OOM fix (kaval-heap-oom.mdx) is the
    # per-terminal mirror shrink (DEFAULT_MIRROR_SCROLLBACK), which raised the
    # crash threshold ~4×; pinning a lower cap here would only give that headroom
    # back, and the default ceiling already bounds a runaway. Observability, not a
    # cap, is the safety net: `--run (diagRunHook "kaval-")` arms the same opt-in
    # heap capture as koluBin (the hook is defined once, above) — when
    # KOLU_DIAG_DIR is forwarded (localDriver's daemonEnv), kaval cds into its OWN
    # `kaval-…` subdir and arms the V8 heap-snapshot flags (incl.
    # --heapsnapshot-near-heap-limit), so the next near-OOM dumps a snapshot that
    # names the leak in the real workload. Unset = passthrough, zero overhead.
    makeWrapper ${pkgs.nodejs}/bin/node $out/bin/kaval \
      --add-flags "--import ${pkgs.tsx}/lib/tsx/dist/loader.mjs" \
      --add-flags "${kolu}/packages/kaval/src/bin.ts" \
      --set KAVAL_BUILD_ID "${kavalBuildId}" \
      --set KAVAL_COMMIT_HASH "${commitHash}" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]} \
      --run ${pkgs.lib.escapeShellArg (diagRunHook "kaval-")}
  '';

  # kaval-tui (R-4 Phase 1): the terminal-side CLI that dials a running kaval's
  # (or, with --socket, a kolu-server's) pty-host unix socket and lists/snapshots/
  # attaches its live PTYs. Runs from the SAME built workspace closure as `kolu`
  # (so kaval + @kolu/surface resolve identically) under tsx — no client bundle,
  # no state dir, just nodejs.
  #
  # R-2's `--host <ssh>` rides this wrapper: KAVAL_AGENT_DRVS_JSON carries the
  # per-system `{ system → kaval .drv }` map so the CLI can ship the target-arch
  # kaval derivation to a remote, and openssh + nix are on PATH for the provision
  # (resolveSystem's ssh arch-probe + provisionAgent's `nix copy` / `nix-store`).
  # `--set-default` (not `--set`) so a power user can override the map.
  kaval-tui = pkgs.runCommand "kaval-tui"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "kaval-tui";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/kaval-tui \
      --add-flags "${kolu}/packages/kaval-tui/src/main.ts" \
      --set-default KAVAL_AGENT_DRVS_JSON '${kavalAgentDrvsJson}' \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.openssh pkgs.nix ]}
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
  # it back via npins (`npins update odu` to bump) and re-exports `odu` so
  # `nix run .#odu` runs this repo's pinned coordinator. The lane runner is no
  # longer re-exported: odu resolves it from its OWN flake (juspay/odu#30), so
  # we thread `selfFlake = oduSources.odu` to bake ODU_RUNNER_FLAKE onto the
  # wrapper — the same value a flake build derives from `self.outPath`. odu is
  # built with its own pinned nixpkgs + kolu pin (it consumes @kolu/surface
  # upstream, the drishti pattern) — the import threads the system + self-flake.
  oduSources = import ./npins;
  oduUpstream = import oduSources.odu {
    pkgs = import (oduSources.odu + "/nix/nixpkgs.nix") {
      system = pkgs.stdenv.hostPlatform.system;
    };
    selfFlake = oduSources.odu;
  };
  oduPackages = { inherit (oduUpstream) odu; };

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
