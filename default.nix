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
  # TEST-ONLY hook (padi's twin of `kavalBuildIdOverride`, default null): when
  # set, FORCE this build's PADI_BUILD_ID to the given value instead of padi's
  # source-closure hash — baked onto BOTH the padi wrapper AND the koluBin wrapper
  # (the binder's expected == what it would spawn), so a second build reads as a
  # padi-build skew to the drain-on-build-mismatch convergence (#1670). Consumed by
  # the `adoption-padi-upgrade` VM arm; the real build always takes the source hash.
, padiBuildIdOverride ? null
  # Per-system `{ system → kaval .drv }` map, baked onto the kaval-tui wrapper as
  # KAVAL_AGENT_DRVS_JSON so `kaval-tui --host <ssh>` can ship the target-arch
  # kaval derivation (provisionAgent copies+realises it on the remote). default.nix
  # is single-system, so the map is built across all systems in flake.nix and
  # threaded in here. Defaults to "{}" for a bare `nix-build default.nix` (no
  # --host map; --host then fails with a clear "run from the Nix wrapper" error).
, kavalAgentDrvsJson ? "{}"
  # Per-system `{ system → padi .drv }` map, baked onto kolu-server's wrapper
  # (koluBin) as PADI_AGENT_DRVS_JSON so a `KOLU_PADI_HOST=<ssh>` remote binding
  # (W3.1) can ship the target-arch padi derivation (provisionAgent copies+realises
  # it on the remote). kaval rides INSIDE padi's closure (padi's wrapper bakes
  # KOLU_KAVAL_BIN), so this ONE drv provisions BOTH daemons. Same shape as
  # kavalAgentDrvsJson; defaults to "{}" (KOLU_PADI_HOST then fails with a clear
  # "run from the Nix wrapper" error).
, padiAgentDrvsJson ? "{}"
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
      ./packages/surface-map
      ./packages/surface-mcp
      ./packages/surface-remote
      ./packages/surface-app
      ./packages/surface-daemon
      ./packages/surface-daemon-supervisor
      ./packages/solid-pierre
      ./packages/solid-markdown
      ./packages/solid-pwa-install
      ./packages/solid-fileview
      ./packages/solid-browser
      ./packages/solid-statepip
      ./packages/common
      ./packages/integrations
      ./packages/nonempty
      ./packages/shared
      ./packages/terminal-themes
      ./packages/theme
      ./packages/memorable-names
      ./packages/terminal-vocab
      ./packages/terminal-protocol
      ./packages/kaval
      ./packages/kaval-tui
      ./packages/padi
      ./packages/padi-tui
      ./packages/mock-agent
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
      ./packages/xterm-kit
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
    hash = "sha256-Iwdperk6QLQoRm1P3xXa45Mc7Qbet7/3RXBT/JppAoQ=";
    fetcherVersion = 3;
  };

  # Build uses a placeholder so docs-only commits don't bust the derivation
  # cache; koluStamped sed-replaces it with the real hash afterwards.
  koluCommitPlaceholder = "__KOLU_COMMIT_PLACEHOLDER__";

  # The ONE recipe for a daemon's baked build identity (hashString over a behavioral
  # fileset + the `<PREFIX>_*` env bake), the Nix half of @kolu/surface-daemon's
  # `readBakedIdentity`. It lives INSIDE the surface-daemon package (location is
  # structure — it travels with the code that reads it). Each daemon below instantiates
  # it with its OWN behavioralFileset (the policy — what counts as its behavior); the
  # rationale for "currency key = behavioral closure" (and the zest incident) lives once
  # at the recipe's doorstep there.
  mkDaemonIdentity = import ./packages/surface-daemon/nix/daemon-identity.nix {
    inherit (pkgs) lib;
  };

  # The `.ts` filter for a hashed daemon fileset: real source only (drops `.test.ts`
  # AND `.testlib.ts` shared test-only helpers). The id is a content hash of the
  # fileset's store path, byte-identical across Darwin/Linux; the recipe + rationale
  # live in `mkDaemonIdentity`.
  isHashedSource =
    f: f.hasExt "ts"
      && !pkgs.lib.hasSuffix ".test.ts" f.name
      && !pkgs.lib.hasSuffix ".testlib.ts" f.name;

  # kaval's baked identity. Its behavioralFileset — kaval's OWN decision of what a restart
  # would load that MATTERS to the currency nudge — is the two BEHAVIORAL roots: kaval
  # itself and `@kolu/terminal-protocol` (the wire/behaviour it serves). The
  # `@kolu/surface-daemon` spine also runs in the kaval *binary* but is DELIBERATELY EXCLUDED
  # (#L3, see the inline note below) — it is a stable leaf for kaval's currency key, not a
  # hashed root. The set hashed here is asserted to equal kaval's behavioral slice by
  # `packages/kaval/src/buildId.closure.test.ts` — keep this fileset and that test in
  # lockstep. `kavalBuildIdOverride` (TEST-ONLY) forces the id for the build-skew VM arms.
  kavalIdentity = mkDaemonIdentity {
    name = "kaval";
    prefix = "KAVAL";
    root = ./packages;
    inherit commitHash;
    override = kavalBuildIdOverride;
    behavioralFileset = pkgs.lib.fileset.unions [
      (pkgs.lib.fileset.fileFilter isHashedSource ./packages/kaval/src)
      ./packages/kaval/package.json
      # @kolu/terminal-protocol — the device-query forward/drop policy + suppression
      # grammars the daemon serves; a protocol change must not escape the staleKey.
      (pkgs.lib.fileset.fileFilter isHashedSource ./packages/terminal-protocol/src)
      ./packages/terminal-protocol/package.json
      # `@kolu/surface-daemon` (the transport SPINE) is DELIBERATELY NOT in kaval's
      # currency slice (#L3). kaval's staleKey drives ONLY the human "update available"
      # nudge, and acting on it RECYCLES kaval — killing live PTYs. The spine's behavioral
      # surface to a consumer IS the wire contract (`PTY_HOST_CONTRACT_VERSION`, in
      # kaval/src above): a contract-COMPATIBLE spine change is behaviorally interchangeable
      # BY THE CONTRACT'S DEFINITION, so keying currency on the spine double-counts what the
      # contract already covers and over-fires the nudge on every compatible spine refactor.
      # This was paid for in production (zest, 2026-07-03): a spine-only change with no kaval
      # behavior delta flipped kaval's staleKey and fired a spurious nudge. A spine change
      # that DOES matter to the wire bumps the contract (hashed here) → recycle-on-skew
      # converges it, a separate sanctioned signal. So kaval's currency = its BEHAVIORAL
      # closure (kaval + terminal-protocol), spine excluded. (padi keeps the full closure —
      # its staleness response is a cheap auto-drain, so over-firing is harmless.) The
      # closure guard in packages/kaval/src/buildId.closure.test.ts pins this restated
      # invariant — keep the two in lockstep.
    ];
  };

  # padi's staleKey (W2.2) — the twin of kaval's, one layer up. padi is the
  # per-host terminal-workspace daemon; `PADI_BUILD_ID` (baked below) hashes the
  # source closure that runs IN padi's process, so it flips iff a restart would
  # load different daemon code. Scoped EMPIRICALLY to padi's reachable closure
  # from its two entry roots — `bin.ts` (the process) and `assembly.ts` (the
  # library barrel kolu-server still imports) — enumerated and asserted equal to
  # this fileset by `packages/padi/src/buildId.closure.test.ts`. Keep the two in
  # lockstep: the test mirrors this fileFilter and these two per-root exclusions
  # exactly, so nix and the guard can never drift on what "the closure" is.
  #
  # `isHashedSourcePadi` broadens kaval's `.ts`-only filter to `.ts`+`.tsx` —
  # padi's closure reaches a `.tsx` module (`@kolu/transcript-html`), which
  # `hasExt "ts"` would silently drop. Test-only files (`.test.ts` / `.test.tsx`
  # / `.testlib.ts`) are dropped, matching the id's content-addressed intent.
  isHashedSourcePadi =
    f: (f.hasExt "ts" || f.hasExt "tsx")
      && !pkgs.lib.hasSuffix ".test.ts" f.name
      && !pkgs.lib.hasSuffix ".test.tsx" f.name
      && !pkgs.lib.hasSuffix ".testlib.ts" f.name;
  # A hashed root contributes its `src`'s non-test sources plus its package.json
  # (a dependency/version change is a behaviour change) — the same pairing kaval
  # hashes for each of its roots.
  padiPkgRoot = pkgDir: pkgs.lib.fileset.unions [
    (pkgs.lib.fileset.fileFilter isHashedSourcePadi (pkgDir + "/src"))
    (pkgDir + "/package.json")
  ];
  # padi's baked identity — the twin of kaval's, one layer up. Its behavioralFileset is
  # padi's reachable closure from its two entry roots (`bin.ts` · `assembly.ts`),
  # enumerated + asserted equal by `packages/padi/src/buildId.closure.test.ts` (keep the
  # two in lockstep). Unlike kaval, padi's key STAYS full-closure (incl. the surface-daemon
  # spine + supervisor): padi's staleness response is a CHEAP auto-drain, so over-firing is
  # harmless — only kaval's human-nudge currency needs a behavioral slice (see
  # mkDaemonIdentity's doorstep). `padiBuildIdOverride` (TEST-ONLY) forces the id.
  padiIdentity = mkDaemonIdentity {
    name = "padi";
    prefix = "PADI";
    root = ./packages;
    inherit commitHash;
    override = padiBuildIdOverride;
    behavioralFileset = pkgs.lib.fileset.unions [
      # padi itself — both entry roots (bin.ts · assembly.ts) live here. MINUS
      # `dial.ts` (`@kolu/padi/dial`, W2.3): the CLIENT dial kit runs in a padi
      # CLIENT (padi-tui, the kolu-server binder), NEVER in padi's daemon process,
      # so it belongs to those consumers' code — not padi's staleKey (a dial-only
      # change must not flip what a padi restart would load). NOTE `stdioBridge.ts`
      # (`padi --stdio`, W3.1) is NOT excluded: `bin.ts` imports it at top level, so
      # the daemon process loads the module even when it dispatches to `runPadiDaemon`
      # — it is genuinely part of what a restart loads (the padi closure test walks
      # `bin.ts` and reaches it, so `reached` == `hashed` requires it INSIDE the set).
      (pkgs.lib.fileset.unions [
        (pkgs.lib.fileset.difference
          (pkgs.lib.fileset.fileFilter isHashedSourcePadi ./packages/padi/src)
          ./packages/padi/src/dial.ts)
        ./packages/padi/package.json
      ])
      # kaval — but ONLY its LIBRARY surface (what padi embeds in-process from
      # `index.ts`), NOT its daemon EXECUTABLE (bin.ts · daemonMain.ts ·
      # stdioBridge.ts). padi spawns that executable as a SEPARATE process via
      # KOLU_KAVAL_BIN, and it carries its OWN KAVAL_BUILD_ID — so those three
      # belong to kaval's staleKey, never padi's (excluding them also keeps padi's
      # key from flipping on a kaval-executable-only change it does not load).
      (pkgs.lib.fileset.unions [
        (pkgs.lib.fileset.difference
          (pkgs.lib.fileset.fileFilter isHashedSourcePadi ./packages/kaval/src)
          (pkgs.lib.fileset.unions [
            ./packages/kaval/src/bin.ts
            ./packages/kaval/src/daemonMain.ts
            ./packages/kaval/src/stdioBridge.ts
          ]))
        ./packages/kaval/package.json
      ])
      # The daemon spine + supervisor padi runs on, and the terminal wire it serves.
      (padiPkgRoot ./packages/terminal-protocol)
      (padiPkgRoot ./packages/surface-daemon)
      (padiPkgRoot ./packages/surface-daemon-supervisor)
      # terminal-vocab — the browser-safe TerminalSnapshot vocabulary +
      # agentProjection folds (L7 re-cut from the old terminal-workspace package).
      (padiPkgRoot ./packages/terminal-vocab)
      # The domain leaves padi's closure reaches: serving, the agent/forge/git
      # integrations, transcripts, and the shared utilities. (`@kolu/surface` and
      # the npm deps are NOT here — surface is the framework "electricity" (a
      # stable, drishti-gated boundary) and the rest are pinned by pnpmDeps; both
      # are stable externals in the closure guard's ALLOWED list.)
      (padiPkgRoot ./packages/serve-dir)
      (padiPkgRoot ./packages/shell-quote)
      (padiPkgRoot ./packages/html-escape)
      (padiPkgRoot ./packages/log)
      (padiPkgRoot ./packages/shared)
      (padiPkgRoot ./packages/transcript-core)
      (padiPkgRoot ./packages/transcript-html)
      (padiPkgRoot ./packages/memorable-names)
      (padiPkgRoot ./packages/nonempty)
      (padiPkgRoot ./packages/integrations/pty)
      (padiPkgRoot ./packages/integrations/git)
      (padiPkgRoot ./packages/integrations/github)
      (padiPkgRoot ./packages/integrations/io)
      (padiPkgRoot ./packages/integrations/claude-code)
      (padiPkgRoot ./packages/integrations/codex)
      (padiPkgRoot ./packages/integrations/grok)
      (padiPkgRoot ./packages/integrations/opencode)
      (padiPkgRoot ./packages/integrations/anyagent)
      (padiPkgRoot ./packages/integrations/anyforge)
    ];
  };

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
  #
  # Two identity bakes here: `${kavalIdentity.bakeArgs}` is the shared kaval-identity pair
  # (the from-source kaval-currency nudge reads it); `PADI_BUILD_ID` is a LEAF — the padi
  # build id the BINDER expects (#1670 drain-on-build-mismatch), BUILD_ID only (no
  # COMMIT_HASH), binder-specific, so it stays an explicit `--set` rather than the
  # `padiIdentity.bakeArgs` pair. It equals what this build's KOLU_PADI_BIN spawns.
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
      ${kavalIdentity.bakeArgs} \
      --set KOLU_KAVAL_BIN "${kaval}/bin/kaval" \
      --set KOLU_PADI_BIN "${padi}/bin/padi" \
      --set PADI_BUILD_ID "${padiIdentity.buildId}" \
      --set PADI_AGENT_DRVS_JSON '${padiAgentDrvsJson}' \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.git pkgs.gh pkgs.openssh pkgs.nix ]} \
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
      ${kavalIdentity.bakeArgs} \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]} \
      --run ${pkgs.lib.escapeShellArg (diagRunHook "kaval-")}
  '';

  # padi (W2.2): the per-host terminal-workspace daemon — the layer above kaval.
  # It supervises the host's kaval (owning its PTYs), composes the terminal
  # registry, folds awareness on the host's clock, persists the session under its
  # state-root, and serves `padiSurface` + the frozen control core over its own
  # unix socket. Runs from the SAME built workspace closure as `kolu` (so padi +
  # kaval + @kolu/surface resolve identically). Carries its OWN identity env
  # (PADI_BUILD_ID / PADI_COMMIT_HASH), and — because padi SPAWNS + owns kaval now
  # — KOLU_KAVAL_BIN points at the kaval derivation above AND it bakes that kaval's
  # KAVAL_BUILD_ID / KAVAL_COMMIT_HASH. The build id is load-bearing: padi's
  # boot-currency check compares the RUNNING kaval's id against the one padi WOULD
  # spawn (`process.env.KAVAL_BUILD_ID`, read in `terminalEndpoint/reattach.ts`) to
  # fire the kaval "update available" nudge — pre-cutover the in-process server
  # carried it; padi owns kaval now, so its closure knows it at build time (a baked
  # required value per fail-fast; the binder's env-forward stays only for dev).
  #
  # Launched as `node --import <tsx loader> bin.ts`, NOT `tsx bin.ts`: the
  # single-process loader form delivers SIGTERM to the daemon so its socket + gate
  # teardown runs (the same reason kaval's bin uses it). padi's boot
  # reconcile shells out to `git` (repo/worktree context) and the pinned `gh`
  # (KOLU_GH_BIN — PR resolution), so both are on PATH / in the env, exactly as
  # kolu's own wrapper carries them. `--run (diagRunHook "padi-")` arms the same
  # opt-in heap capture as kaval/koluBin (the hook is defined once, above).
  padi = pkgs.runCommand "padi"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "padi";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.nodejs}/bin/node $out/bin/padi \
      --add-flags "--import ${pkgs.tsx}/lib/tsx/dist/loader.mjs" \
      --add-flags "${kolu}/packages/padi/src/bin.ts" \
      ${padiIdentity.bakeArgs} \
      --set KOLU_KAVAL_BIN "${kaval}/bin/kaval" \
      ${kavalIdentity.bakeArgs} \
      --set KOLU_GH_BIN "${koluEnv.KOLU_GH_BIN}" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.git pkgs.gh ]} \
      --run ${pkgs.lib.escapeShellArg (diagRunHook "padi-")}
  '';

  # A surface-agent TUI wrapper: a `tsx` entrypoint from the built workspace
  # closure whose `--host <ssh>` path ships a TARGET-arch agent derivation to a
  # remote. kaval-tui and padi-tui both consume it (the two thin, single-daemon
  # `--host` CLIs): name, entrypoint, and the per-system `{ system → agent .drv }`
  # map env var are the only volatile axes. The map is
  # baked with `--set` (NOT `--set-default`): it is a baked build
  # fact — the exact derivations this wrapper ships and realises on the remote —
  # not a tunable. `--set-default` would let an ambient/stale
  # `*_AGENT_DRVS_JSON` inherited from the caller's env silently override the
  # Nix-computed source of truth and make the wrapper provision the WRONG agent,
  # which is exactly the override-knob the repo's fail-fast rule forbids. openssh
  # + nix are on PATH for the provision (resolveSystem's ssh arch-probe +
  # provisionAgent's `nix copy` / `nix-store`).
  mkAgentTuiWrapper = { name, entry, envVar, agentDrvsJson }:
    pkgs.runCommand name
      {
        nativeBuildInputs = [ pkgs.makeWrapper ];
        meta.mainProgram = name;
      } ''
      mkdir -p $out/bin
      makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/${name} \
        --add-flags "${kolu}/${entry}" \
        --set ${envVar} '${agentDrvsJson}' \
        --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.openssh pkgs.nix ]}
    '';

  # kaval-tui (R-4 Phase 1): the terminal-side CLI that dials a running kaval's
  # (or, with --socket, a kolu-server's) pty-host unix socket and lists/snapshots/
  # attaches its live PTYs. Runs from the SAME built workspace closure as `kolu`
  # (so kaval + @kolu/surface resolve identically) under tsx — no client bundle,
  # no state dir, just nodejs.
  #
  # R-2's `--host <ssh>` rides this wrapper: KAVAL_AGENT_DRVS_JSON carries the
  # per-system `{ system → kaval .drv }` map so the CLI can ship the target-arch
  # kaval derivation to a remote.
  kaval-tui = mkAgentTuiWrapper {
    name = "kaval-tui";
    entry = "packages/kaval-tui/src/main.ts";
    envVar = "KAVAL_AGENT_DRVS_JSON";
    agentDrvsJson = kavalAgentDrvsJson;
  };

  # padi-tui (W2.3): the terminal-side CLI that dials a running padi's digest-keyed
  # socket and reads its `padiSurface` — `status`/`watch` (record state · agent ·
  # live byte activity) and the precise agent-state `wait` done-signal, plus
  # `create` (a terminal / split tile / worktree'd agent). kaval-tui's sibling and
  # `pulam-tui`'s replacement (see `packages/padi-tui/README.md`). Runs from the
  # SAME built workspace closure as `kolu` under tsx, via `mkAgentTuiWrapper`.
  # `PADI_AGENT_DRVS_JSON` carries the per-system `{ system → padi .drv }` map
  # (W3.1) — the SAME map baked onto koluBin, whose remote binding is W3.1's real
  # consumer; padi-tui's own `--host` leg is a later, thin wrapper over the same
  # dial, but the map is baked here now so it is ready the moment that lands.
  padi-tui = mkAgentTuiWrapper {
    name = "padi-tui";
    entry = "packages/padi-tui/src/main.ts";
    envVar = "PADI_AGENT_DRVS_JSON";
    agentDrvsJson = padiAgentDrvsJson;
  };

  # kolu-mock-agent (W3.4): a stand-in coding agent the e2e harness runs INSIDE
  # a kolu terminal. It writes real agent-state artifacts (claude JSONL · codex/
  # opencode SQLite+WAL · grok events.jsonl) at the REAL default `$HOME` paths of
  # WHATEVER box the terminal lives on, so agent-state scenarios run identically
  # local and over an ssh bind — no test-side "where does padi live" branch (the
  # old fixture-file mock couldn't cross the ssh boundary). One bin per kind, so
  # the terminal invocation's head basename is `claude`/`codex`/`opencode`/`grok`
  # — exactly what the preexec command-name detector keys on; the kind is baked
  # as the first arg.
  # Runs from the SAME built workspace closure as `kolu` under tsx, so `nix copy`
  # onto a leased bind target transfers only this tiny wrapper (node + tsx + the
  # closure are already there via padi's provisioning). Not a runtime dep of
  # kolu/padi — a sibling output, built + shipped only by the remote-e2e lane.
  mock-agent = pkgs.runCommand "kolu-mock-agent"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
    } ''
    mkdir -p $out/bin
    for kind in claude codex opencode grok; do
      makeWrapper ${pkgs.nodejs}/bin/node $out/bin/$kind \
        --add-flags "--import ${pkgs.tsx}/lib/tsx/dist/loader.mjs" \
        --add-flags "${kolu}/packages/mock-agent/src/bin.ts" \
        --add-flags "$kind" \
        --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]}
    done
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
  # fleet-top-agent — the remote agent the multi-host tutorials ship over ssh.
  # Exposed so the tutorials' `nix eval --raw .#fleet-top-agent.drvPath` works as
  # written (FLEET_TOP_AGENT_DRV has no fallback; the reader needs a real drv).
  fleetTop = import ./packages/surface/example/fleet-top/default.nix {
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
  inherit default koluBin kaval kaval-tui padi padi-tui mock-agent koluEnv pnpmDeps typecheck;
} // remoteProcessMonitor // miniCi // fleetTop // docsiteExample // oduPackages
