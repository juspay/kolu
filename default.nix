# Root composer for kolu Nix packages.
#
# nix/packages/* are pure callPackage-style leaf packages, auto-injected via
# the overlay in nix/overlay.nix. The kolu build derivation and its runtime
# wrapper live here in default.nix because they need per-invocation args
# (commitHash, koluEnv, koluClientDist) that aren't on pkgs.
#
# Used by flake.nix (thin wrapper) and nix-build directly. A direct nix-build
# must pass `--argstr commitHash "$(git rev-parse HEAD)"`: a Nix-built daemon
# cannot honestly carry a build id without the source commit that produced it.
{ pkgs ? import ./nix/nixpkgs.nix { }
, commitHash
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
}:
let
  koluEnv = import ./nix/env.nix { inherit pkgs; };
  workspace = import ./nix/workspace.nix { inherit pkgs; };
  inherit (workspace) version src fileset pnpmDeps;
  sources = import ./npins;

  # Keep Node's full command set in the wrapper PATH: padi passes that PATH into
  # hosted terminals, where node, npm, npx, and corepack are part of the existing
  # environment.
  runtimeNode = pkgs.nodejs;
  # This nixpkgs revision builds tsx against Node 22. Point only tsx at the
  # stock, cache.nixos.org-substitutable Node 24 runtime so the shipped closure
  # carries one Node core.
  runtimeTsx = pkgs.tsx.override { nodejs_22 = runtimeNode; };
  runtimeTsxLoader = "${runtimeTsx}/lib/tsx/dist/loader.mjs";

  # Build uses a placeholder so docs-only commits don't bust the derivation
  # cache; koluClientDist sed-replaces it with the real hash afterwards.
  koluCommitPlaceholder = "__KOLU_COMMIT_PLACEHOLDER__";

  # Surface-owned Nix recipes (location is structure — they travel with the
  # code that reads / depends on them). Both live inside @kolu/surface-daemon:
  #   mkDaemonIdentity     — hashString-over-fileset + `<PREFIX>_*` bake
  #   mkProvenAgentSource  — pure agent-tree assemble + evaluate-an-agent prove
  mkDaemonIdentity = import ./packages/surface-daemon/nix/daemon-identity.nix {
    inherit (pkgs) lib;
  };
  mkProvenAgentSource = import ./packages/surface-daemon/nix/agent-source.nix {
    inherit (pkgs) lib;
  };

  # Exact source flake with a minimal remote-agent output surface.
  #
  # Baking root `self` would keep the whole repository (website, Atlas, evidence)
  # in every Kolu runtime closure. Instead, assemble the agent tree from the
  # workspace package fileset plus the Nix/npins machinery that evaluates it,
  # then PROVE an agent evaluates from that tree before handing the path to any
  # wrapper (mkProvenAgentSource — shallow bake is unspellable). The flake
  # exposes only Kolu's nix/agent-packages.json inventory via nix/agent-flake.nix.
  #
  # Fileset policy (kolu's): workspace packages + default.nix + nix/ + npins/.
  # osfacts is not in the tree at all (OSF5) — koluEnv bakes KOLU_OSFACTS_BIN
  # from the npins pin, and nix/workspace.nix grafts the same pin's client-ts
  # in as the `osfacts-client` workspace member, so `./npins` covers both.
  #
  # `expose` (what the agent flake offers a remote to resolve) and `prove` (what
  # must evaluate before any wrapper gets the bake path) are DELIBERATELY two
  # lists, not one. `mkProvenAgentSource` proves an attr by re-importing this
  # file from the assembled tree, so — per its own comment — a proven attr must
  # never reach the `agentFlakeSrc` thunk below, or the prove re-enters itself
  # forever. `padi-agent` reaches it (it contains `kolu` and both TUIs, all of
  # which bake the flake ref), so it is exposed but NOT proven.
  #
  # Be honest about what that costs. `padi-agent` IS what both dial paths now
  # resolve (`@kolu/padi/dial`'s `PADI_REMOTE_DIAL`), so the build-input gate no
  # longer covers the dialed attr — it covers the daemon graph that closure is
  # composed out of, which is where a thin fileset actually shows up. What covers
  # the exposed attrs themselves is `ci::agent-flake-nix`, which evaluates every
  # `expose` entry's `drvPath` from this same assembled tree
  # (`.#agent-flake-source` = `agentFlakeSrc`). That recipe is load-bearing for
  # remote provisioning, not a nicety: delete it and a fileset gap reaching only
  # `default` / the TUIs surfaces on a user's box at dial time.
  #
  # `prove` is a strict subset of `expose`, ASSERTED rather than remembered: a
  # proven-but-unexposed attr passes this build and then 404s at dial time on a
  # remote host — the exact failure `mkProvenAgentSource` exists to abolish.
  agentPackages =
    let m = pkgs.lib.importJSON ./nix/agent-packages.json;
    in
    assert pkgs.lib.assertMsg
      (pkgs.lib.all (p: pkgs.lib.elem p m.expose) m.prove)
      "nix/agent-packages.json: every `prove` entry must also be in `expose` (a proven attr no remote can resolve)";
    m;
  agentSource = mkProvenAgentSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      fileset
      ./biome.jsonc
      ./default.nix
      ./nix
      ./npins
    ];
    inherit pkgs commitHash;
    agents = agentPackages.prove;
    flakeNix = ./nix/agent-flake.nix;
  };
  agentFlakeSrc = agentSource.flakeSrc;
  agentFlakeRefEnv =
    (pkgs.lib.importJSON ./packages/surface-remote/agent-env.json).flakeRef;
  # Every (name, value) pair a run must carry to resolve remote agents — ONE
  # definition, rendered two ways below. A working-tree run and the packaged
  # wrapper cannot export a different set, because neither spells the pair: add
  # an entry HERE and both the wrapper's `--set` args and the sourceable file
  # pick it up with no second edit. (The set is a single pair today; it is an
  # attrset rather than a scalar so that stays true when it isn't.)
  agentBakedEnv = { ${agentFlakeRefEnv} = "${agentFlakeSrc}"; };
  agentFlakeRefBakeArg = pkgs.lib.concatStringsSep " "
    (pkgs.lib.mapAttrsToList (name: value: ''--set ${name} "${value}"'') agentBakedEnv);
  # The same set as shell-sourceable data, for working-tree runs (`just dev`,
  # `just server`) that have no wrapper to bake into. `toShellVars` rather than a
  # hand-rolled `name=value` join: it is nixpkgs' own renderer for this and
  # quotes values that need it, so the set can grow past today's store paths
  # without a value containing a space silently mis-sourcing.
  agentFlakeEnv = pkgs.writeText "agent-flake-env" (pkgs.lib.toShellVars agentBakedEnv);

  # osfacts — the single OS process/socket sampler padi's port scan spawns
  # (OSF2). Read from koluEnv rather than re-deriving the path, so the wrapper
  # and the dev shell cannot drift.
  osfactsBakeArg = ''--set KOLU_OSFACTS_BIN "${koluEnv.KOLU_OSFACTS_BIN}"'';

  # The terminal-snapshot PNG rasteriser's font directory (nix/packages/fonts/
  # snapshot.nix). Read from koluEnv for the same reason as osfactsBakeArg: the
  # wrapper and the dev shell must name ONE store path. pngFonts.ts throws when this
  # is unset, so the bake is the runtime hop that makes the build-time value
  # (koluEnv is spread into the build derivation's env below) reach a spawned
  # daemon, which inherits nothing from the shell that built it.
  snapshotFontsBakeArg = ''--set KOLU_SNAPSHOT_FONTS_DIR "${koluEnv.KOLU_SNAPSHOT_FONTS_DIR}"'';

  # ── Daemon identity: DERIVED from the workspace dependency graph (#2094) ──
  #
  # A daemon's staleKey used to be a hand-listed fileset here, mirrored by an
  # AST-walking guard test in the daemon's package — two hand-kept lists for one
  # question ("what would a restart load?"), which is exactly the drift class
  # that produced a rebuilt daemon carrying an unchanged identity (#2094). Now
  # the set is COMPUTED. The mechanism no longer lives in this file either: it
  # graduated into `@kolu/surface-daemon`'s `nix/workspace-closure.nix` (#2096)
  # so external spine consumers derive their daemon identities the same way, and
  # `workspace.identityInputs` below is kolu applying it to its own members map.
  # It walks the transitive package.json `dependencies` closure of the daemon's
  # package — the same edges pnpm's isolated node_modules makes the only
  # resolvable ones at runtime. A new dependency joins the staleKey
  # automatically; forgetting nothing is possible, and the residual failure
  # direction is OVER-inclusion (an unnecessary flip — a cheap drain or an early
  # nudge), never a silent escape. The one assumption the derivation rests on —
  # every import a daemon can reach is declared in the importing package's
  # `dependencies`, never a devDependency — is enforced by the dependency-edge
  # guards (`packages/{padi,kaval}/src/buildId.closure.test.ts`, on the shared
  # walker in `@kolu/daemon-test-gate`).
  #
  # A member that is a PIN rather than a directory (juspay/kolu#2093 grafts
  # osfacts-client that way) needs no change here: `identityInputs` hands its
  # content-addressed store path out as `pinnedSources`, which `mkDaemonIdentity`
  # folds into the same hash — so a pin bump lands in the id by construction
  # instead of silently escaping it.
  #
  # What remains in THIS file is pure policy, one list per daemon: its
  # `stableLeaves` — the closure packages it DELIBERATELY keys no currency on.
  # A leaf truncates the walk (its whole subtree is excluded with it, unless
  # reached another way), and a leaf that leaves the closure fails eval loudly
  # (see depClosure), so the lists cannot go stale silently.
  #
  # The identity is PACKAGE-granular on purpose. The old filesets also carved
  # out single FILES (padi's client-side `dial.ts`/`watch.ts`, kaval's daemon
  # executable out of padi's key) — precision that needed the mirror test to
  # stay honest, because nothing else could prove those files were really not
  # loaded. At package granularity every carve-out disappears into the safe
  # direction: a dial-kit-only edit now flips padi's staleKey and costs one
  # no-op auto-drain, instead of a hand-kept exclusion that could silently
  # rot into the dangerous direction.

  # kaval's baked identity. Its currency slice — kaval's OWN decision of what a
  # restart would load that MATTERS to the currency nudge — is derived from
  # kaval's dependency closure minus the stable leaves below, which today
  # resolves to the two BEHAVIORAL roots: kaval itself and
  # `@kolu/terminal-protocol` (the wire/behaviour it serves — the device-query
  # forward/drop policy, the suppression grammars; a protocol change must not
  # escape the staleKey). `kavalBuildIdOverride` (TEST-ONLY) forces the id for
  # the build-skew VM arms.
  kavalIdentity = mkDaemonIdentity {
    name = "kaval";
    prefix = "KAVAL";
    root = ./.;
    inherit commitHash;
    override = kavalBuildIdOverride;
    inherit (workspace.identityInputs {
      entries = [ "kaval" ];
      stableLeaves = [
        # `@kolu/surface-daemon` (the transport SPINE) runs in the kaval binary
        # but is DELIBERATELY NOT in kaval's currency slice (#L3). kaval's
        # staleKey drives ONLY the human "update available" nudge, and acting on
        # it RECYCLES kaval — killing live PTYs. The spine's behavioral surface
        # to a consumer IS the wire contract (`PTY_HOST_CONTRACT_VERSION`, in
        # kaval/src): a contract-COMPATIBLE spine change is behaviorally
        # interchangeable BY THE CONTRACT'S DEFINITION, so keying currency on
        # the spine double-counts what the contract already covers and
        # over-fires the nudge on every compatible spine refactor. This was paid
        # for in production (zest, 2026-07-03): a spine-only change with no
        # kaval behavior delta flipped kaval's staleKey and fired a spurious
        # nudge. A spine change that DOES matter to the wire bumps the contract
        # (hashed via kaval/src) → recycle-on-skew converges it, a separate
        # sanctioned signal. (padi's leaves are only the framework tier — its
        # staleness response is a cheap auto-drain, so over-firing is harmless.)
        "@kolu/surface-daemon"
        # `@kolu/surface-daemon-supervisor` — the SUPERVISOR half of that same
        # spine, an edge kaval grew at juspay/kolu#2101 when `kaval --stdio`
        # started converging its own daemon before relaying. Excluded for exactly
        # the #L3 reason above, and one more: this package runs in the SUPERVISING
        # process, never inside the kaval daemon, so by construction a change here
        # cannot change what a kaval restart would load — which is the only
        # question the staleKey exists to answer. Keying kaval's PTY-costing nudge
        # on it would fire on every convergence-kit refactor for no kaval delta at
        # all. (kaval's OWN convergence declaration — `convergencePolicy.ts` — is
        # in kaval/src and IS hashed; that is the part a supervisor must not
        # disagree with us about.)
        "@kolu/surface-daemon-supervisor"
        # `@kolu/surface` — the framework "electricity", a stable drishti-gated
        # volatility boundary, excluded for the same contract-shaped reason as
        # the spine it underlies.
        "@kolu/surface"
        # `@kolu/xterm-kit` — the graduated xterm machinery; kaval consumes only
        # its runtime-neutral core (the mirror anchor + snapToWrapHead). The
        # anchor's kaval-relevant behavioral surface (the absolute-line
        # coordinates getHistory pages by) IS part of PTY_HOST_CONTRACT_VERSION,
        # which lives in kaval and IS hashed — a wire-breaking anchor change
        # rides the contract bump, while a browser-only /solid or /backfill
        # change must not fire kaval's PTY-costing currency nudge.
        "@kolu/xterm-kit"
        # `terminal-snapshot` — the grid→picture leaf. kaval consumes ONE
        # function from it (`readGrid`, a pure buffer read); the scene builder,
        # the SVG writer and the wasm rasteriser behind `terminal-snapshot/png`
        # never run in this process (the kaval wrapper below bakes no
        # KOLU_SNAPSHOT_FONTS_DIR, and says why). The kaval-relevant surface is
        # the SHAPE `readGrid` emits, and that shape is `SnapshotGridSchema` in
        # kaval/src — hashed via PTY_HOST_CONTRACT_VERSION, so a wire-relevant
        # change rides the contract bump. A chrome-geometry or palette edit —
        # or a `themes.json` regeneration, which reaches here through
        # `terminal-themes` — must not fire kaval's PTY-costing currency nudge.
        # Same argument as @kolu/xterm-kit above.
        "terminal-snapshot"
        # `@kolu/shell-quote` — the POSIX-quote source of truth. kaval seeds a
        # command-rooted PTY's `lastCommand` with `shellJoin` (#1872), and the
        # seed's DIALECT is carried on the `commandRun` frame's `shellJoin`
        # field, which lives in `ptyHostSurface` (kaval) and IS hashed via
        # PTY_HOST_CONTRACT_VERSION — so a wire-relevant quoting change rides
        # the contract bump; a browser-irrelevant leaf change must not nudge.
        "@kolu/shell-quote"
        # `@kolu/heap-diag` — opt-in heap instrumentation, no wire/behaviour.
        "@kolu/heap-diag"
        # `osfacts-client` — the TypeScript face of the baked osfacts binary,
        # used only for start-qualified process identity at the pid-gate (UW4).
        # Its wire is the binary's TSV, not kaval's PTY contract; a client-only
        # change must not fire the nudge.
        "osfacts-client"
      ];
    }) behavioralFileset pinnedSources;
  };

  # padi's staleKey (W2.2) — the twin of kaval's, one layer up. padi is the
  # per-host terminal-workspace daemon; `PADI_BUILD_ID` (baked below) hashes the
  # source closure that runs IN padi's process, so it flips iff a restart would
  # load different daemon code. Derived from `@kolu/padi`'s dependency closure —
  # which reaches kaval's embedded library, the surface-daemon spine +
  # supervisor, the terminal wire, the integrations, and osfacts-client (which
  # lives under osfacts/ so it can leave with the tool at OSF5, yet still hashes
  # into padi's staleKey; when #2093 turns it into a grafted npins member, a pin
  # bump lands in this key by construction — the hole #2094 recorded). Unlike
  # kaval, padi keys currency on essentially its WHOLE closure, spine and
  # supervisor included: its staleness response is a CHEAP auto-drain, so
  # over-firing is harmless — only kaval's human-nudge currency needs a
  # behavioral slice (see mkDaemonIdentity's doorstep). The only leaves are the
  # framework tier and instrumentation below. `padiBuildIdOverride` (TEST-ONLY)
  # forces the id.
  padiIdentity = mkDaemonIdentity {
    name = "padi";
    prefix = "PADI";
    # Repo root, same as kaval's. `root` only has to be a common ancestor of
    # `behavioralFileset`, and every LOCAL member is under packages/ now that
    # osfacts-client is a pin — but the root is part of the hashed source's
    # shape, so narrowing it would move both live daemon ids for nothing.
    root = ./.;
    inherit commitHash;
    override = padiBuildIdOverride;
    inherit (workspace.identityInputs {
      entries = [ "@kolu/padi" ];
      stableLeaves = [
        # The `@kolu/surface*` framework tier — the "electricity", a stable,
        # drishti-gated volatility boundary. Its behavioral surface to a
        # consumer is its API contract; a compatible framework refactor must
        # not drain every padi on every host. (surface-remote + surface-map
        # are in padi's closure only for the CLIENT dial kit that ships in the
        # same package; same tier, same exclusion.)
        "@kolu/surface"
        "@kolu/surface-remote"
        "@kolu/surface-map"
        # `@kolu/xterm-kit` — reached only through kaval's embedded library
        # (the runtime-neutral mirror-anchor core). Its daemon-relevant
        # behavioral surface rides PTY_HOST_CONTRACT_VERSION, which lives in
        # kaval's src and IS hashed here — a browser-only change must not
        # flip padi's key.
        "@kolu/xterm-kit"
        # `@kolu/heap-diag` — opt-in heap instrumentation, no wire/behaviour.
        "@kolu/heap-diag"
      ];
    }) behavioralFileset pinnedSources;
  };

  # The workspace type gate (juspay/kolu#1049): `tsc --noEmit` over every
  # package. Reuses this build's `src` + `pnpmDeps` — every package with a
  # typecheck script is in the `src` fileset above (see its INVARIANT
  # comment), so this checks exactly what `pnpm typecheck` does.
  #
  # This is NOT a side check: `kolu` (and therefore every wrapper that
  # embeds `${kolu}/…` — koluBin, padi, kaval, the TUIs) depends on it, so
  # `nix build .#default` / `.#padi` fails on a type or module-graph error
  # before a store path is handed to deploy. flake.nix still also exposes it
  # as `checks.*.typecheck` for a standalone proof; CI inherits the gate via
  # the ordinary package build.
  typecheck = import ./nix/pnpm-typecheck.nix {
    inherit pkgs src pnpmDeps version;
    pname = "kolu-typecheck";
  };

  kolu = pkgs.stdenv.mkDerivation {
    pname = "kolu";
    inherit version src;

    nativeBuildInputs = [
      pkgs.nodejs
      pkgs.pnpm-build
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

    # Workspace typecheck is a REQUIRED input, not a parallel lane. Kolu runs
    # TypeScript at runtime (tsx); Vite only transpiles. Without this, a green
    # store path can boot-loop on a missing export (juspay/kolu#1049 class).
    # `${typecheck}` forces the gate before any vite/node-gyp work; the empty
    # path is the success token from pnpm-typecheck.nix.
    buildPhase = ''
      runHook preBuild
      test -e ${typecheck}
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
      rm -rf packages/client/src packages/client/node_modules
      pushd node_modules/.pnpm
      # NOTE: esbuild is kept because @kolu/artifact-sdk bundles the in-iframe
      # SDK script at runtime.
      rm -rf typescript@* \
             @typescript+typescript-* \
             lightningcss* rollup@* @rollup* rolldown@* @rolldown* \
             vitest@* @vitest* \
             vite@* vitefu@* vite-plugin-* @tailwindcss* tailwindcss@* \
             @babel* babel-plugin-* \
             concurrently@* rxjs@* happy-dom@* \
             es-toolkit@* \
             es-abstract@* caniuse-lite@* browserslist@* update-browserslist-db@* \
             @types+* type-fest@* csstype@* \
             core-js-compat@* regexpu-core@* regjsparser@* terser@*
      local pty
      pty=$(echo node-pty@*/node_modules/node-pty)
      local ptyInstance="''${pty%/node_modules/node-pty}"
      # node-pty loads a fixed set of artifacts out of build/Release at
      # runtime. Preserve exactly those and drop the rest of the node-gyp
      # output, along with node-addon-api at both places where pnpm's
      # package-instance layout links it.
      #
      # The set is PLATFORM-SPECIFIC, and getting it wrong fails asymmetrically:
      # darwin's binding.gyp carries a second `OS=="mac"` target, `spawn-helper`,
      # which lib/unixTerminal.js exec's for every fork. Pruning it leaves the
      # addon loadable and the daemon healthy while no hosted terminal can spawn
      # at all — invisible on linux, which never builds that target. #1988
      # pruned it and reddened ci::smoke@aarch64-darwin only.
      local ptyRuntime=(pty.node ${
        pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin "spawn-helper"
      })
      mkdir -p "$NIX_BUILD_TOP/pty-runtime"
      # cp fails the build if an expected artifact is missing, so a node-pty
      # bump that renames one surfaces here rather than at a user's terminal.
      for artifact in "''${ptyRuntime[@]}"; do
        cp --preserve=mode "$pty/build/Release/$artifact" "$NIX_BUILD_TOP/pty-runtime/$artifact"
      done
      rm -rf "$pty/build"
      mkdir -p "$pty/build/Release"
      for artifact in "''${ptyRuntime[@]}"; do
        cp --preserve=mode "$NIX_BUILD_TOP/pty-runtime/$artifact" "$pty/build/Release/$artifact"
      done
      rm -rf $pty/prebuilds $pty/third_party $pty/deps $pty/src $pty/scripts \
             "$ptyInstance"/node-addon-api@* "$ptyInstance/node_modules/node-addon-api"
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
  koluClientDist = pkgs.runCommand "kolu-client-dist" { } ''
    # Only index.html changes with the commit. Link the content-hashed assets
    # and other static files back to the cache-stable build instead of copying
    # the entire runtime workspace into a second store path.
    cp -rs ${kolu}/packages/client/dist/. "$out"
    chmod u+w "$out"
    rm "$out/index.html"
    cp ${kolu}/packages/client/dist/index.html "$out/index.html"
    chmod u+w "$out/index.html"
    shell="$out/index.html"
    if ! grep -q '${koluCommitPlaceholder}' "$shell"; then
      echo "koluClientDist: '${koluCommitPlaceholder}' not found in index.html — the surfaceApp() shell injection broke (kolu#1319)." >&2
      exit 1
    fi
    if assetMatches=$(grep -rl '${koluCommitPlaceholder}' "$out/assets"); then
      echo "koluClientDist: '${koluCommitPlaceholder}' leaked into a hashed /assets/* file — identity must ride the shell, not an immutable bundle (kolu#1319)." >&2
      echo "$assetMatches" >&2
      exit 1
    else
      grepStatus=$?
      if [ "$grepStatus" -ne 1 ]; then
        echo "koluClientDist: failed to inspect hashed assets for '${koluCommitPlaceholder}'." >&2
        exit "$grepStatus"
      fi
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

  # Base wrapper: single-process Node + tsx loader, env vars, and PATH. The
  # loader form lets SIGTERM reach the server directly so its graceful shutdown
  # exits zero; tsx's CLI parent otherwise exits 143 before the child completes.
  # Does NOT set KOLU_STATE_DIR —
  # callers must provide it (state.ts crashes with a clear error if missing).
  # Tests use this directly so a missing KOLU_STATE_DIR crashes immediately
  # instead of silently falling back to the production ~/.config/kolu path.
  #
  # Two identity pairs are baked here. The kaval pair drives the from-source
  # currency nudge; the padi pair lets the binder compare the exact daemon it
  # would spawn (#1670) while preserving readBakedIdentity's both-or-neither
  # invariant. Both equal the identities baked into their corresponding bins.
  koluBin = pkgs.runCommand "kolu-bin"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "kolu";
    } ''
    mkdir -p $out/bin
    makeWrapper ${runtimeNode}/bin/node $out/bin/kolu \
      --add-flags "--import ${runtimeTsxLoader}" \
      --add-flags "${kolu}/packages/kolu-cli/src/main.ts" \
      --set KOLU_CLIENT_DIST "${koluClientDist}" \
      --set KOLU_GH_BIN "${koluEnv.KOLU_GH_BIN}" \
      ${osfactsBakeArg} \
      ${snapshotFontsBakeArg} \
      --set KOLU_COMMIT_HASH "${commitHash}" \
      ${kavalIdentity.bakeArgs} \
      --set KOLU_KAVAL_BIN "${kaval}/bin/kaval" \
      --set KOLU_PADI_BIN "${padi}/bin/padi" \
      ${padiIdentity.bakeArgs} \
      ${agentFlakeRefBakeArg} \
      --prefix PATH : ${pkgs.lib.makeBinPath [ runtimeNode pkgs.gitMinimal pkgs.gh pkgs.openssh pkgs.nix ]} \
      --run ${pkgs.lib.escapeShellArg (diagRunHook "")}
  '';

  # One shell snippet both production wrappers use for KOLU_PADI_STATE_DIR
  # (juspay/kolu#1334): code never silently defaults the state-root; wrappers
  # supply the well-known path when unset. Explicit override still wins.
  # Fail loud if HOME is empty when computing the default — an empty HOME would
  # resolve to `/.local/state/padi` here while TS productionPadiStateRoot() uses
  # passwd homedir() (codex F1). Keep the formula aligned with
  # packages/padi/src/stateRoot.ts productionPadiStateRoot() ($HOME/.local/state/padi).
  exportPadiStateDirRun = ''
    if [ -z "''${KOLU_PADI_STATE_DIR:-}" ]; then
      : "''${HOME:?HOME must be set to resolve production padi state-root}"
      export KOLU_PADI_STATE_DIR="$HOME/.local/state/padi"
    fi
  '';

  # Production wrapper: koluBin + default KOLU_STATE_DIR + KOLU_PADI_STATE_DIR.
  # Used by `nix run .` and the NixOS service. Defaults the state dir to
  # ~/.config/kolu but honors an inherited KOLU_STATE_DIR (`:-` fallback) —
  # so a second production instance can relocate state without hijacking
  # $HOME (juspay/kolu#1414). Same shape for padi's state-root (juspay/kolu#1334).
  # Restoring these fallbacks can NOT reintroduce the silent-production-
  # corruption bug #530/#531 fixed: tests build `.#koluBin` (justfile:122),
  # which has no KOLU_STATE_DIR / KOLU_PADI_STATE_DIR and crashes if unset, and
  # so never go through this wrapper.
  #
  # `KOLU_AGENT_TOOLS_PATH` — the BAKE: what this build tells the padi it
  # supervises about the client CLIs a terminal must be able to run. THIS wrapper
  # is the SINGLE setter for the local arm, and it `--set`s the COMPLETE value:
  # its own `bin/` (the `kolu` whose `mcp` face an agent's `.mcp.json` invokes,
  # nameable only here — koluBin cannot carry it without a cycle, since that env
  # would reference the wrapper that references it) plus `koluAgentTools` (the
  # two TUIs).
  #
  # One `--set`, not two merging wrappers, because a merge has no fixed point:
  # an inner `--set` clobbers an outer `--prefix` (that one-word bug shipped),
  # and `--prefix`/`--suffix` fold in whatever the process already carried. A
  # single assertion cannot be clobbered, cannot accumulate, and raises no
  # ordering question. A bare `.#koluBin` — the binary the tests build — therefore
  # carries NO toolchain at all, by design: it is not a wrapper a user runs.
  # The remote arm asserts the same fact the same way — see `padi-agent` below.
  default = pkgs.runCommand "kolu"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "kolu";
    } ''
    mkdir -p $out/bin
    makeWrapper ${koluBin}/bin/kolu $out/bin/kolu \
      --set KOLU_AGENT_TOOLS_PATH "$out/bin:${koluAgentTools}/bin" \
      --run 'export KOLU_STATE_DIR="''${KOLU_STATE_DIR:-''${XDG_CONFIG_HOME:-$HOME/.config}/kolu}"; ${exportPadiStateDirRun}'

    # ── The composed-wrapper proof, IN the derivation it proves ───────────────
    # The toolchain a LOCAL terminal ends up with is a property of the two nested
    # production wrappers COMPOSED — this one wraps `koluBin` — and nothing in
    # the TypeScript suite exercises that composition: every unit test injects
    # the variable directly. That gap shipped a real defect green (koluBin's
    # `--set` silently discarding this wrapper's value, so every locally-spawned
    # terminal lost `kolu`), invisible to `just check`, `nix build`, and every
    # unit test.
    #
    # So assert it here rather than in a sibling derivation: `nix build .#default`,
    # `nix run .`, the home-manager module and the NixOS service all realise this
    # wrapper, and each of them now realises its proof. A separate check attr
    # could only be a build input of something ELSE (it must read `${"$"}{default}`,
    # so `default` depending on it is a cycle) — which is how the guarantee for a
    # purely local property came to hang off the remote closure.
    #
    # Neutralise each wrapper's final `exec …` so sourcing runs only the env
    # prelude, then chain them in the real order: outer (this) → inner (koluBin).
    # Assert the shape BEFORE relying on it: if nixpkgs' makeWrapper ever stops
    # emitting exactly one `^exec ` line, the `sed` would match nothing and the
    # sourcings would run the real `kolu` inside the sandbox instead of asserting
    # anything — a guard that exists because a one-word change shipped green must
    # not itself be able to fail open on a one-word upstream change.
    for w in $out/bin/kolu ${koluBin}/bin/kolu; do
      if [ "$(grep -c '^exec ' "$w")" != 1 ]; then
        echo "FAIL: $w has no single '^exec ' line — makeWrapper's output shape" >&2
        echo "changed, and this check would silently fail open. Fix the sed." >&2
        exit 1
      fi
    done
    sed 's|^exec .*||' $out/bin/kolu > outer.sh
    sed 's|^exec .*||' ${koluBin}/bin/kolu > inner.sh
    . ./outer.sh
    . ./inner.sh

    echo "resolved KOLU_AGENT_TOOLS_PATH=$KOLU_AGENT_TOOLS_PATH"
    IFS=: read -ra dirs <<< "$KOLU_AGENT_TOOLS_PATH"
    # One loop over a name→message table, so the check is written once but each
    # binary keeps its OWN failure message — they name exactly what a local
    # terminal loses, and each was falsified separately.
    #
    # Both TUIs, not just one: they arrive together from `agentToolPackages`
    # today, so a proof that names only `kaval-tui` would stay green if
    # `padi-tui` were dropped from that list — leaving local terminals able to
    # run `kaval-tui` and `kolu mcp` but not the `padi-tui wait` loop.
    for b in kolu kaval-tui padi-tui; do
      case "$b" in
        kolu) why="a local terminal could not run 'kolu mcp' OR any terminal verb ('kolu ls' / 'send' / 'wait' / 'snapshot' / ...) — kolu is the ONE terminal CLI, so losing it here costs an agent every way it has of driving its siblings. An inner-wrapper --set that clobbers this one is the known cause." ;;
        kaval-tui) why="a local terminal could not attach to its siblings." ;;
        padi-tui) why="a local terminal could not run the 'padi-tui wait' done-signal loop." ;;
      esac
      found=0
      for d in "''${dirs[@]}"; do
        [ -z "$d" ] && continue
        [ -e "$d/$b" ] && found=1
      done
      if [ "$found" != 1 ]; then
        echo "FAIL: no '$b' on the composed KOLU_AGENT_TOOLS_PATH — $why" >&2
        exit 1
      fi
    done
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
    #
    # NOT baked here: KOLU_SNAPSHOT_FONTS_DIR. kaval consumes terminal-snapshot's
    # BROWSER half only (readGrid — a pure buffer read); the wasm rasteriser and
    # its ~9MB of outline faces sit behind the `terminal-snapshot/png` export,
    # which nothing in kaval imports. Baking it would hang the font closure on
    # every PTY daemon for no reader, and pngFonts.ts throws by name the moment that
    # stops being true — so the omission fails loudly rather than silently.
    makeWrapper ${runtimeNode}/bin/node $out/bin/kaval \
      --add-flags "--import ${runtimeTsxLoader}" \
      --add-flags "${kolu}/packages/kaval/src/bin.ts" \
      ${kavalIdentity.bakeArgs} \
      ${osfactsBakeArg} \
      --prefix PATH : ${pkgs.lib.makeBinPath [ runtimeNode ]} \
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
  #
  # KOLU_PADI_STATE_DIR: see exportPadiStateDirRun. This wrapper (the binary
  # kolu ships and remotes provision) supplies the production path so remote
  # `padi --stdio` needs no `--state-root` on the argv.
  padi = pkgs.runCommand "padi"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "padi";
    } ''
    mkdir -p $out/bin
    makeWrapper ${runtimeNode}/bin/node $out/bin/padi \
      --add-flags "--import ${runtimeTsxLoader}" \
      --add-flags "${kolu}/packages/padi/src/daemonBoot/bin.ts" \
      ${padiIdentity.bakeArgs} \
      --set KOLU_KAVAL_BIN "${kaval}/bin/kaval" \
      ${kavalIdentity.bakeArgs} \
      --set KOLU_GH_BIN "${koluEnv.KOLU_GH_BIN}" \
      ${osfactsBakeArg} \
      ${snapshotFontsBakeArg} \
      --prefix PATH : ${pkgs.lib.makeBinPath [ runtimeNode pkgs.gitMinimal pkgs.gh ]} \
      --run '${exportPadiStateDirRun}' \
      --run ${pkgs.lib.escapeShellArg (diagRunHook "padi-")}
  '';

  # A surface-agent TUI wrapper: a `tsx` entrypoint from the built workspace
  # closure whose `--host <ssh>` path resolves and ships a TARGET-arch agent
  # derivation to a remote. kaval-tui and padi-tui both consume it. The source
  # flake ref is baked with `--set` (NOT `--set-default`): it is a build fact —
  # the exact source whose derivation this wrapper ships and realises remotely —
  # not a tunable. `--set-default` would let an ambient/stale
  # `SURFACE_AGENT_FLAKE_REF` inherited from the caller silently override the source
  # of truth and make the wrapper provision the WRONG agent,
  # which is exactly the override-knob the repo's fail-fast rule forbids. openssh
  # + nix are on PATH for the provision (resolveSystem's ssh arch-probe +
  # provisionAgent's Nix remote-store build / `nix-store` probe and pin).
  mkAgentTuiWrapper = { name, entry }:
    pkgs.runCommand name
      {
        nativeBuildInputs = [ pkgs.makeWrapper ];
        meta.mainProgram = name;
      } ''
      mkdir -p $out/bin
      makeWrapper ${runtimeTsx}/bin/tsx $out/bin/${name} \
        --add-flags "${kolu}/${entry}" \
        ${agentFlakeRefBakeArg} \
        --prefix PATH : ${pkgs.lib.makeBinPath [ runtimeNode pkgs.openssh pkgs.nix ]}
    '';

  # kaval-tui (R-4 Phase 1): the terminal-side CLI that dials a running kaval's
  # (or, with --socket, a kolu-server's) pty-host unix socket and lists/snapshots/
  # attaches its live PTYs. Runs from the SAME built workspace closure as `kolu`
  # (so kaval + @kolu/surface resolve identically) under tsx — no client bundle,
  # no state dir, just nodejs.
  #
  # R-2's `--host <ssh>` rides this wrapper: the baked source ref lets the CLI
  # evaluate and ship the target system's kaval derivation on demand.
  kaval-tui = mkAgentTuiWrapper {
    name = "kaval-tui";
    entry = "packages/kaval-tui/src/main.ts";
  };

  # padi-tui (W2.3): the terminal-side CLI that dials a running padi's digest-keyed
  # socket and reads its `padiSurface` — `status`/`watch` (record state · agent ·
  # live byte activity) and the precise agent-state `wait` done-signal, plus
  # `create` (a terminal / split tile / worktree'd agent). kaval-tui's sibling and
  # `pulam-tui`'s replacement (see `packages/padi-tui/README.md`). Runs from the
  # SAME built workspace closure as `kolu` under tsx, via `mkAgentTuiWrapper`.
  # The same source ref baked onto koluBin lets padi-tui resolve the target
  # system's padi derivation on demand.
  padi-tui = mkAgentTuiWrapper {
    name = "padi-tui";
    entry = "packages/padi-tui/src/main.ts";
  };

  # kolu-rpc: the HARNESS caller on kolu-server's own wire — one call, by wire tag,
  # over the `/rpc/ws` ndjson socket, printing the answer as JSON
  # (`packages/server/src/wireCall.ts` owns the why). The NixOS adoption VM tests
  # reach into a running kolu with it, in place of the `curl -X POST /rpc/...` HTTP
  # arm the Effect port deleted; a shell cannot speak the socket, and hand-rolling
  # its frames would be a second copy of the wire contract.
  #
  # QUARANTINE — harness-only, and it must STAY that way. This attr may be named by
  # exactly two things: this binding, and the flake `packages` export at the bottom of
  # this file (which is how `nix/home/example/adoption/*.nix` reaches it). It must NOT
  # be added to `agentToolPackages` / `koluAgentTools` (a terminal's PATH), to
  # `padi-agent`'s `paths` (a remote host's closure), to `default` / `koluBin`, or to
  # `nix/home/module.nix`'s `home.packages` — a caller that can place ANY wire call is
  # a debug tool, not something a user installs. It is also not a `kolu` subcommand,
  # and nothing in kolu-server imports its entry. The rule is machine-checked by the
  # "quarantine" block in `packages/server/src/wireCall.test.ts`, which reads this file
  # and rejects any occurrence outside those two sites; keep prose mentions of the name
  # on their OWN comment lines, which is what that scanner skips.
  #
  # It rides `mkAgentTuiWrapper` because that helper is exactly "run a workspace TS
  # entry from the built closure under tsx" — the same thing this needs.
  kolu-rpc = mkAgentTuiWrapper {
    name = "kolu-rpc";
    entry = "packages/server/src/wireCallMain.ts";
  };

  # The client CLIs a kolu TERMINAL must be able to run, named ONCE. Both arms
  # derive from this list — `koluAgentTools` (local) and `padi-agent` (remote) —
  # so adding a fourth tool cannot give local terminals something remote ones
  # lack, which is the same "one host, two behaviours" class one level down.
  #
  # `kolu` itself is deliberately NOT here and cannot be: it is what each arm
  # adds by SELF-reference (`$out/bin`), the only spelling that avoids a cycle
  # through the wrapper that would reference it.
  agentToolPackages = [ kaval-tui padi-tui ];

  # The local arm's tools as ONE directory, so `default`'s single `--set` can
  # name the whole toolchain in one string. kolu-server forwards that bake onto
  # the padi it spawns, so a LOCAL terminal's PATH carries the tools from the
  # same build as the daemon that owns it.
  koluAgentTools = pkgs.buildEnv {
    name = "kolu-agent-tools";
    paths = agentToolPackages;
  };

  # padi-agent — what a REMOTE HOST is provisioned with: `padi` plus the client
  # toolchain a terminal that daemon spawns must be able to run (`kaval-tui`,
  # `padi-tui`, and the `kolu` whose `mcp` face an agent's `.mcp.json` invokes).
  # Nothing is installed on the host; these ride the closure kolu already copies.
  #
  # It closes the remote gap with ONE property, and no new mechanism anywhere:
  # the wrapper bakes `KOLU_AGENT_TOOLS_PATH` to its OWN `$out/bin` (a
  # self-reference, resolved at build time). A padi reached as
  # `ssh <host> <agentPath>/bin/padi --stdio` therefore reports the closure that
  # was actually copied to that host — with no env channel (ssh has none) and
  # nothing threaded through argv or `@kolu/surface-remote`. The tools a terminal
  # gets and the daemon that spawned it are the same store path BY CONSTRUCTION,
  # so the tool/daemon version skew `PADI_BUILD_ID` exists to catch cannot arise
  # here at all.
  #
  # **It is a separate attr from `padi`, and it must stay OUT of the `agents`
  # PROVE list in `nix/agent-packages.json`.** `mkProvenAgentSource` proves an
  # agent by re-importing this very `default.nix` from the assembled tree and
  # forcing that attr's `drvPath`; its own comment records the invariant that
  # makes the recursion terminate — a proven attr must never reach the
  # `agentFlakeSrc` thunk. This closure reaches it three ways (`default` →
  # `koluBin`, and both TUI wrappers, all of which bake the flake ref), so
  # proving it is an infinite regress — a real `error: stack overflow` this
  # composition was first written into. The rule belongs to the mechanism, not to
  # kolu: see `packages/surface-daemon/nix/agent-source.nix`'s header. `padi` and
  # `kaval` stay the proven pair — the daemon graph THIS closure is composed out
  # of — and `ci::agent-flake-nix` is what evaluates the exposed attrs
  # themselves; see the `expose`/`prove` note at the top of this file.
  #
  # Composed with `pkgs.buildEnv` — the same idiom `koluAgentTools` above uses,
  # not a hand-rolled `mkdir` + `ln -s` set. One mechanism for "compose a `bin/`
  # out of several packages", and buildEnv's collision detection comes free.
  # The self-reference forces a wrapper step, which `postBuild` supplies.
  padi-agent = pkgs.buildEnv {
    name = "padi-agent";
    paths = [ padi default ] ++ agentToolPackages;
    nativeBuildInputs = [ pkgs.makeWrapper ];
    postBuild = ''
      wrapProgram $out/bin/padi --set KOLU_AGENT_TOOLS_PATH "$out/bin"

      # ── The composed-wrapper proof, IN the derivation that is DIALED ─────────
      # `padi-agent` — not `padi`, not `default` — is what BOTH dial paths
      # provision onto a host, so it is where the remote guarantee has to be
      # proven. Without this, dropping `default` (the `kolu` binary) or a TUI
      # from `paths=` above still BUILDS, still evaluates green in
      # `ci::agent-flake-nix` (which only forces `drvPath`), and still passes
      # every TypeScript test (they all inject the bake directly) — failing only
      # much later, on a real remote host, when an agent's `.mcp.json` cannot
      # run `kolu mcp`. That is the same class of hole the LOCAL `default` arm
      # closed after a one-word wrapper bug shipped green; the remote arm is the
      # primary product of this change and gets the same proof, at the same
      # altitude, spelled the same way.
      #
      # Two facts, because the bake is a self-reference and either half can rot
      # independently: (1) `$out/bin` really carries the three programs, and
      # (2) the wrapped `padi` a remote actually execs resolves a bake that
      # NAMES a directory carrying them — an inner `--set` that clobbers the
      # outer one would leave (1) true and (2) false.
      for b in kolu kaval-tui padi-tui; do
        if [ ! -e "$out/bin/$b" ]; then
          echo "FAIL: padi-agent has no '$b' in its own bin/ — a REMOTE agent" >&2
          echo "provisioned with this closure could not run it. Check that" >&2
          echo "'paths' still carries 'default' and every agentToolPackages entry." >&2
          exit 1
        fi
      done

      # Neutralise each wrapper's final `exec …` so sourcing runs only the env
      # prelude, then chain them in the real order: outer (wrapProgram's, above)
      # → inner (the `padi` wrapper it wraps). Assert the shape BEFORE relying
      # on it — the same guard the local proof uses: if nixpkgs' makeWrapper ever
      # stops emitting exactly one `^exec ` line the `sed` would match nothing
      # and this proof would fail OPEN, running the real `padi` in the sandbox
      # instead of asserting anything.
      for w in $out/bin/padi $out/bin/.padi-wrapped; do
        if [ "$(grep -c '^exec ' "$w")" != 1 ]; then
          echo "FAIL: $w has no single '^exec ' line — makeWrapper's output shape" >&2
          echo "changed, and this check would silently fail open. Fix the sed." >&2
          exit 1
        fi
      done
      sed 's|^exec .*||' $out/bin/padi > "$TMPDIR/padi-agent-outer.sh"
      sed 's|^exec .*||' $out/bin/.padi-wrapped > "$TMPDIR/padi-agent-inner.sh"
      . "$TMPDIR/padi-agent-outer.sh"
      . "$TMPDIR/padi-agent-inner.sh"

      echo "resolved KOLU_AGENT_TOOLS_PATH=$KOLU_AGENT_TOOLS_PATH"
      IFS=: read -ra agent_dirs <<< "$KOLU_AGENT_TOOLS_PATH"
      # Same shape as the local proof: one loop over a name→message table, so
      # each binary keeps its OWN failure message naming exactly what a remote
      # agent loses. Each was falsified separately.
      for b in kolu kaval-tui padi-tui; do
        case "$b" in
          kolu) why="an agent in a terminal on a remote host could not run 'kolu mcp' OR any terminal verb ('kolu ls' / 'send' / 'wait' / 'snapshot' / ...) — kolu is the ONE terminal CLI, so losing it here costs a remote agent every way it has of driving its siblings. An inner-wrapper --set that clobbers this one is the known cause." ;;
          kaval-tui) why="a terminal on a remote host could not attach to its siblings." ;;
          padi-tui) why="a terminal on a remote host could not run the 'padi-tui wait' done-signal loop." ;;
        esac
        found=0
        for d in "''${agent_dirs[@]}"; do
          [ -z "$d" ] && continue
          [ -e "$d/$b" ] && found=1
        done
        if [ "$found" != 1 ]; then
          echo "FAIL: no '$b' on the composed KOLU_AGENT_TOOLS_PATH of the padi a remote host is dialed with — $why" >&2
          exit 1
        fi
      done
    '';
    meta.mainProgram = "padi";
  };

  # osfacts — scoped process/socket fact sampler (Atlas: os-facts-tool, OSF1).
  # The tool graduated to its own repo (juspay/osfacts) at OSF5; npins pins it
  # and its default.nix still takes `{ pkgs }`, so kolu builds the pinned source
  # exactly as it built the in-tree one. Kept as a kolu package output because
  # `nix run .#osfacts` is how a kolu checkout reaches the sampler it bakes.
  osfacts = import sources.osfacts { inherit pkgs; };
in
{
  inherit agentFlakeSrc agentFlakeEnv default koluBin kaval kaval-tui kolu-rpc padi padi-agent padi-tui koluEnv pnpmDeps typecheck osfacts;
}
