{ pkgs ? import ./nix/nixpkgs.nix { }
, commitHash
, contractVersionOverride ? null
, kavalBuildIdOverride ? null
, padiBuildIdOverride ? null
}:
let
  koluEnv = import ./nix/env.nix { inherit pkgs; };
  workspace = import ./nix/workspace.nix { inherit pkgs; };
  inherit (workspace) version src fileset pnpmDeps;
  sources = import ./npins;

  runtimeNode = pkgs.nodejs;
  runtimeTsx = pkgs.tsx.override { nodejs-slim_22 = pkgs.nodejs-slim; };
  runtimeTsxLoader = "${runtimeTsx}/lib/tsx/dist/loader.mjs";

  koluCommitPlaceholder = "__KOLU_COMMIT_PLACEHOLDER__";

  mkDaemonIdentity = import ./packages/surface-daemon/nix/daemon-identity.nix {
    inherit (pkgs) lib;
  };
  mkProvenAgentSource = import ./packages/surface-daemon/nix/agent-source.nix {
    inherit (pkgs) lib;
  };

  # `expose` (what the agent flake offers a remote to resolve) and `prove` (what
  # must evaluate before any wrapper gets the bake path) are DELIBERATELY two
  # lists, not one. `mkProvenAgentSource` proves an attr by re-importing this
  # file from the assembled tree, so — per its own comment — a proven attr must
  # never reach the `agentFlakeSrc` thunk below, or the prove re-enters itself
  # forever. `padi-agent` reaches it (it contains `kolu` and both TUIs, all of
  # which bake the flake ref), so it is exposed but NOT proven.
  #
  # What covers the exposed attrs themselves is `ci::agent-flake-nix`, which
  # evaluates every `expose` entry's `drvPath` from this same assembled tree
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
  agentPluginFileset = pkgs.lib.fileset.unions [
    ./plugin.json
    ./mcp.json
    ./skills
    ./.claude-plugin/plugin.json
  ];
  agentSource = mkProvenAgentSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      fileset
      ./biome.jsonc
      ./default.nix
      ./nix
      ./npins
      agentPluginFileset
    ];
    inherit pkgs commitHash;
    agents = agentPackages.prove;
    flakeNix = ./nix/agent-flake.nix;
    closureIndex = { repo = "juspay/kolu"; branch = "ca-index"; };
    pusher = { kind = "odu"; };
  };
  agentFlakeSrc = agentSource.flakeSrc;
  agentFlakeRefEnv =
    (pkgs.lib.importJSON ./packages/surface-remote/agent-env.json).flakeRef;
  agentBakedEnv = { ${agentFlakeRefEnv} = "${agentFlakeSrc}"; };
  agentFlakeRefBakeArg = pkgs.lib.concatStringsSep " "
    (pkgs.lib.mapAttrsToList (name: value: ''--set ${name} "${value}"'') agentBakedEnv);
  agentFlakeEnv = pkgs.writeText "agent-flake-env" (pkgs.lib.toShellVars agentBakedEnv);

  agentPluginSrc = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = agentPluginFileset;
  };

  agentDistro = import ./packages/agent-distro {
    inherit pkgs;
    src = sources.agent-distro;
    pluginSrc = agentPluginSrc;
    readListing = pkgs.lib.escapeShellArgs [
      "${runtimeNode}/bin/node"
      "--import"
      runtimeTsxLoader
      "--input-type=module"
      "-e"
      ''
        const m = await import("${kolu}/packages/server/src/agentDistroListing.ts");
        process.stdout.write(JSON.stringify(m.readAgentDistroListing()) + "\n");
      ''
    ];
  };

  osfactsBakeArg = ''--set KOLU_OSFACTS_BIN "${koluEnv.KOLU_OSFACTS_BIN}"'';

  snapshotFontsBakeArg = ''--set KOLU_SNAPSHOT_FONTS_DIR "${koluEnv.KOLU_SNAPSHOT_FONTS_DIR}"'';

  kavalIdentity = mkDaemonIdentity {
    name = "kaval";
    prefix = "KAVAL";
    root = ./.;
    inherit commitHash;
    override = kavalBuildIdOverride;
    inherit (workspace.identityInputs {
      entries = [ "kaval" ];
      stableLeaves = [
        "@kolu/surface-daemon"
        "@kolu/surface-daemon-supervisor"
        "@kolu/surface"
        "@kolu/xterm-kit"
        "terminal-snapshot"
        "@kolu/shell-quote"
        "@kolu/heap-diag"
        "osfacts-client"
      ];
    }) behavioralFileset pinnedSources;
  };

  padiIdentity = mkDaemonIdentity {
    name = "padi";
    prefix = "PADI";
    root = ./.;
    inherit commitHash;
    override = padiBuildIdOverride;
    inherit (workspace.identityInputs {
      entries = [ "@kolu/padi" ];
      stableLeaves = [
        "@kolu/surface"
        "@kolu/surface-remote"
        "@kolu/surface-map"
        "@kolu/xterm-kit"
        "@kolu/heap-diag"
      ];
    }) behavioralFileset pinnedSources;
  };

  typecheck = import ./nix/pnpm-typecheck.nix {
    inherit pkgs src pnpmDeps version;
    pname = "kolu-typecheck";
  };

  koluDeps = pkgs.stdenv.mkDerivation {
    pname = "kolu-deps";
    inherit version pnpmDeps;
    src = workspace.depsSrc;

    nativeBuildInputs = [
      pkgs.nodejs
      pkgs.pnpm-build
      pkgs.pnpmConfigHook
      pkgs.python3
      pkgs.node-gyp
      pkgs.pkg-config
    ];

    env = {
      npm_config_nodedir = pkgs.nodejs;
      # No `-rpath $out/lib` on what this derivation links. stdenv adds that
      # self-rpath by default (`_addRpathPrefix`), and node-gyp's pty.node is
      # then STAMPED with this derivation's own store path — a directory
      # kolu-deps never creates, and, once `kolu-runtime-deps` copies the addon,
      # a reference that drags the whole unpruned tree into the runtime closure.
      # The prune would have saved nothing: a dead rpath entry would have made
      # every user download `typescript` and `vite` anyway.
      NIX_NO_SELF_RPATH = "1";
    };

    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      pushd node_modules/.pnpm/node-pty@*/node_modules/node-pty
      node-gyp rebuild
      popd
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      pushd node_modules/.pnpm
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

      mkdir -p $out
      cp -a node_modules $out/node_modules
      while IFS= read -r -d "" farm; do
        local member="''${farm#./}"
        member="''${member%/node_modules}"
        mkdir -p "$out/workspaces/$member"
        cp -a "$farm" "$out/workspaces/$member/node_modules"
      done < <(find . -path ./node_modules -prune -o -type d -name node_modules -print0 -prune)

      runHook postInstall
    '';
  };

  koluRuntimeDeps = pkgs.runCommand "kolu-runtime-deps-${version}" { } ''
    mkdir -p $out
    cp -a ${koluDeps}/node_modules $out/node_modules
    chmod -R u+w $out

    cd $out/node_modules/.pnpm
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
  '';

  # Node resolves a module from its REALPATH (no `--preserve-symlinks`), so a
  # dependency reached through one of these links resolves ITS dependencies
  # inside the deps derivation, where the rest of the instance tree is.
  mirrorNodeModules = depsOut: dest: ''
    shopt -s dotglob nullglob
    mirrorNodeModulesDir() {
      local from=$1 to=$2 path name
      mkdir -p "$to"
      for path in "$from"/*; do
        name=''${path##*/}
        if [ -L "$path" ]; then
          cp -P "$path" "$to/$name"
        elif [ -d "$path" ] && [ "''${name#@}" != "$name" ]; then
          mirrorNodeModulesDir "$path" "$to/$name"
        else
          ln -s "$path" "$to/$name"
        fi
      done
    }
    mirrorNodeModulesDir ${depsOut}/node_modules ${dest}/node_modules
  '';

  copyMemberFarms = depsOut: ''
    for member in $(cd ${depsOut}/workspaces && find . -type d -name node_modules -prune | sed 's|^\./||; s|/node_modules$||'); do
      mkdir -p "$member"
      cp -a "${depsOut}/workspaces/$member/node_modules" "$member/node_modules"
      chmod -R u+w "$member/node_modules"
    done
  '';

  kolu = pkgs.stdenv.mkDerivation {
    pname = "kolu";
    inherit version src;

    nativeBuildInputs = [
      pkgs.nodejs
      pkgs.pnpm-build
    ];

    postPatch = pkgs.lib.optionalString (contractVersionOverride != null) ''
      if grep -q 'PTY_HOST_CONTRACT_VERSION = "${contractVersionOverride}"' \
        packages/kaval/src/ptyHostSurface.ts; then
        echo "contractVersionOverride: the source already speaks ${contractVersionOverride} — this skew is vacuous, pick a version no release will reach" >&2
        exit 1
      fi
      sed -i 's|PTY_HOST_CONTRACT_VERSION = "[^"]*"|PTY_HOST_CONTRACT_VERSION = "${contractVersionOverride}"|' \
        packages/kaval/src/ptyHostSurface.ts
      grep -q 'PTY_HOST_CONTRACT_VERSION = "${contractVersionOverride}"' \
        packages/kaval/src/ptyHostSurface.ts \
        || { echo "contractVersionOverride: PTY_HOST_CONTRACT_VERSION constant not found — update default.nix" >&2; exit 1; }
    '';

    dontConfigure = true;

    dontFixup = true;

    # EVERY SHARED VAR EXCEPT THE ADAPTER. Nothing at build time spawns the
    # Conductor's ACP adapter — it is a runtime fact of the wrapper a person
    # runs — and naming it here is not free: `KOLU_ACP_AGENT` resolves
    # `pkgs.kolu-acp-adapter`, which drives agent-distro's floor `claude`,
    # whose own `package.nix` `fetchTarball`s UPSTREAM'S locked nixpkgs at EVAL
    # time. That turned a `nix eval` of `padi-agent` into a download, and the
    # one machine that evaluates it with no network is the one that matters:
    # `offline-provision`'s binder resolving a host's daemon spent its 900s
    # retrying `github.com` and the dial never landed.
    env = builtins.removeAttrs
      ({ KOLU_COMMIT_HASH = koluCommitPlaceholder; } // koluEnv)
      [ "KOLU_ACP_AGENT" ];

    buildPhase = ''
      runHook preBuild
      test -e ${typecheck}
      ${mirrorNodeModules koluDeps "."}
      ${copyMemberFarms koluDeps}
      ln -sfn $KOLU_FONTS_DIR packages/client/public/fonts
      pnpm --filter kolu-client build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      rm -rf packages/client/src packages/client/node_modules
      rm -rf node_modules

      cp -r . $out
      ${mirrorNodeModules koluRuntimeDeps "$out"}

      runHook postInstall
    '';
  };

  koluClientDist = pkgs.runCommand "kolu-client-dist" { } ''
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

  # kolu's pinned `nix`, appended to PATH — never prepended. Nix's CLI computes a
  # content-addressed rewrite's hash and the daemon it writes to re-verifies it,
  # and Nix 2.35 changed that hash for a self-referencing path: a CLI and a
  # daemon on opposite sides of 2.35 refuse each other (#2368). The host that
  # provides the daemon provides the client, so the host's own `nix` comes
  # first; this pin only fills in for a service PATH with no `nix` at all
  # (launchd, a non-NixOS systemd unit). `deliverClosure` checks the versions
  # that remain either way.
  hostNixFirstArg = "--suffix PATH : ${pkgs.lib.makeBinPath [ pkgs.nix ]}";

  # Base wrapper: single-process Node + tsx loader, env vars, and PATH. The
  # loader form lets SIGTERM reach the server directly so its graceful shutdown
  # exits zero; tsx's CLI parent otherwise exits 143 before the child completes.
  # Does NOT set KOLU_STATE_DIR —
  # callers must provide it (state.ts crashes with a clear error if missing).
  # Tests use this directly so a missing KOLU_STATE_DIR crashes immediately
  # instead of silently falling back to the production ~/.config/kolu path.
  #
  # KOLU_ACP_AGENT is NOT baked here, though this is the binary that spawns the
  # adapter — see `mkKoluWrapper`, which bakes it only on the LOCAL arm. This
  # derivation is shared: `koluRemote` wraps it too, and `koluRemote` is a
  # member of `padi-agent`, the closure every remote host is provisioned with.
  # A reference here therefore shipped the ACP adapter and agent-distro's
  # `claude` to every remote — and to every adoption VM, whose 1 GB guests then
  # OOMed and whose offline provisioning timed out shipping a closure that had
  # no business being that large. The Conductor runs in kolu-server, on the
  # machine a person is looking at; a remote host hosts no conversation.
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
      --set-default KOLU_GH_BIN "${koluEnv.KOLU_GH_BIN}" \
      ${osfactsBakeArg} \
      ${snapshotFontsBakeArg} \
      --set KOLU_COMMIT_HASH "${commitHash}" \
      ${kavalIdentity.bakeArgs} \
      --set KOLU_KAVAL_BIN "${kaval}/bin/kaval" \
      --set KOLU_PADI_BIN "${padi}/bin/padi" \
      ${padiIdentity.bakeArgs} \
      ${agentFlakeRefBakeArg} \
      --prefix PATH : ${pkgs.lib.makeBinPath [ runtimeNode pkgs.gitMinimal pkgs.gh pkgs.openssh ]} \
      ${hostNixFirstArg} \
      --run ${pkgs.lib.escapeShellArg (diagRunHook "")}
  '';

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

  # KOLU_ACP_AGENT is `--set-default`, NOT `--set`, and the difference is a
  # test lane that silently tests nothing: the e2e harness points it at a
  # scripted fixture adapter (`packages/tests/support/hooks.ts`) and the e2e
  # lane runs this very wrapper (`justfile`), so a `--set` overwrote the fixture
  # and drove the real pinned adapter against a real `claude` — green or red
  # for reasons the fixture never stated. `--set-default` keeps the bake as the
  # value nothing else supplies, which is every production path: nobody exports
  # this name.
  mkKoluWrapper = { floor }: pkgs.runCommand "kolu"
    {
      nativeBuildInputs = [ pkgs.makeWrapper pkgs.jq ];
      meta.mainProgram = "kolu";
    }
    (
      ''
        mkdir -p $out/bin
        makeWrapper ${koluBin}/bin/kolu $out/bin/kolu \
          --set KOLU_AGENT_TOOLS_PATH "$out/bin:${koluAgentTools}/bin" ${pkgs.lib.optionalString floor ''--set-default KOLU_ACP_AGENT "${koluEnv.KOLU_ACP_AGENT}"''} \
          ${agentDistro.bakeArgs { inherit floor; }} \
          --run 'export KOLU_STATE_DIR="''${KOLU_STATE_DIR:-''${XDG_CONFIG_HOME:-$HOME/.config}/kolu}"; ${exportPadiStateDirRun}'

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
        if [ -z "''${KOLU_AGENT_DISTRO_STATE:-}" ] || [ "''${dirs[0]}" != "$out/bin" ]; then
          echo "FAIL: the composed KOLU_AGENT_TOOLS_PATH must start with this wrapper's" >&2
          echo "\$out/bin, and this wrapper must bake KOLU_AGENT_DISTRO_STATE — else a" >&2
          echo "change to that bake (on the machine running kolu, an agent-distro pin bump," >&2
          echo "which moves the floor) would no longer restart padi, so a newer kolu would" >&2
          echo "not bring the newer agents." >&2
          exit 1
        fi
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

        ${agentDistro.proof { inherit floor; }}
      ''
    );

  default = mkKoluWrapper { floor = true; };
  koluRemote = mkKoluWrapper { floor = false; };

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

  # padi carries its OWN identity env
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
  # teardown runs (the same reason kaval's bin uses it).
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
      --set-default KOLU_GH_BIN "${koluEnv.KOLU_GH_BIN}" \
      ${osfactsBakeArg} \
      ${snapshotFontsBakeArg} \
      --prefix PATH : ${pkgs.lib.makeBinPath [ runtimeNode pkgs.gitMinimal pkgs.gh ]} \
      --run '${exportPadiStateDirRun}' \
      --run ${pkgs.lib.escapeShellArg (diagRunHook "padi-")}
  '';

  # The source flake ref is baked with `--set` (NOT `--set-default`): it is a build
  # fact — the exact source whose derivation this wrapper ships and realises
  # remotely — not a tunable. `--set-default` would let an ambient/stale
  # `SURFACE_AGENT_FLAKE_REF` inherited from the caller silently override the source
  # of truth and make the wrapper provision the WRONG agent,
  # which is exactly the override-knob the repo's fail-fast rule forbids.
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
        --prefix PATH : ${pkgs.lib.makeBinPath [ runtimeNode pkgs.openssh ]} \
        ${hostNixFirstArg}
    '';

  kaval-tui = mkAgentTuiWrapper {
    name = "kaval-tui";
    entry = "packages/kaval-tui/src/main.ts";
  };

  padi-tui = mkAgentTuiWrapper {
    name = "padi-tui";
    entry = "packages/padi-tui/src/main.ts";
  };

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
  kolu-rpc = mkAgentTuiWrapper {
    name = "kolu-rpc";
    entry = "packages/server/src/wireCallMain.ts";
  };

  # `kolu` itself is deliberately NOT here and cannot be: it is what each arm
  # adds by SELF-reference (`$out/bin`), the only spelling that avoids a cycle
  # through the wrapper that would reference it.
  agentToolPackages = [ kaval-tui padi-tui ];

  koluAgentTools = pkgs.buildEnv {
    name = "kolu-agent-tools";
    paths = agentToolPackages;
  };

  # **It is a separate attr from `padi`, and it must stay OUT of the `agents`
  # PROVE list in `nix/agent-packages.json`.** `mkProvenAgentSource` proves an
  # agent by re-importing this very `default.nix` from the assembled tree and
  # forcing that attr's `drvPath`; its own comment records the invariant that
  # makes the recursion terminate — a proven attr must never reach the
  # `agentFlakeSrc` thunk. This closure reaches it three ways (`koluRemote` →
  # `koluBin`, and both TUI wrappers, all of which bake the flake ref), so
  # proving it is an infinite regress — a real `error: stack overflow` this
  # composition was first written into. The rule belongs to the mechanism, not to
  # kolu: see `packages/surface-daemon/nix/agent-source.nix`'s header. `padi` and
  # `kaval` stay the proven pair — the daemon graph THIS closure is composed out
  # of — and `ci::agent-flake-nix` is what evaluates the exposed attrs
  # themselves; see the `expose`/`prove` note at the top of this file.
  padi-agent = pkgs.buildEnv {
    name = "padi-agent";
    paths = [ padi koluRemote ] ++ agentToolPackages;
    nativeBuildInputs = [ pkgs.makeWrapper pkgs.jq ];
    postBuild = ''
      wrapProgram $out/bin/padi --set KOLU_AGENT_TOOLS_PATH "$out/bin" \
        ${agentDistro.bakeArgs { floor = false; }}

      for b in kolu kaval-tui padi-tui; do
        if [ ! -e "$out/bin/$b" ]; then
          echo "FAIL: padi-agent has no '$b' in its own bin/ — a REMOTE agent" >&2
          echo "provisioned with this closure could not run it. Check that" >&2
          echo "'paths' still carries 'koluRemote' and every agentToolPackages entry." >&2
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
      if [ -z "''${KOLU_AGENT_DISTRO_STATE:-}" ] || [ "''${agent_dirs[0]}" != "$out/bin" ]; then
        echo "FAIL: the composed KOLU_AGENT_TOOLS_PATH of the padi a remote host is dialed" >&2
        echo "with must start with padi-agent's \$out/bin, and that wrapper must bake" >&2
        echo "KOLU_AGENT_DISTRO_STATE — else a change to the bake the host is dialed" >&2
        echo "with, or to padi-agent, would no longer restart the host's padi." >&2
        exit 1
      fi
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

      # ── NO CONDUCTOR OUT HERE ─────────────────────────────────────────────
      # The ACP adapter must not ride this closure. kolu-server hosts the one
      # conversation, on the machine a person is looking at; a remote host
      # hosts none, so an adapter reference here is pure freight — and it was
      # not cheap freight. Baked on the SHARED `koluBin` (which `koluRemote`
      # wraps), it put the adapter and agent-distro's `claude` into every
      # closure a host is provisioned with: the adoption VMs then OOMed their
      # 1 GB guests and `offline-provision` timed out shipping it.
      if [ -n "''${KOLU_ACP_AGENT:-}" ]; then
        echo "FAIL: padi-agent's composed env bakes KOLU_ACP_AGENT=$KOLU_ACP_AGENT" >&2
        echo "— the Conductor's ACP adapter is being shipped to every remote host." >&2
        echo "Bake it on the LOCAL wrapper only (mkKoluWrapper's \`floor\` arm)." >&2
        exit 1
      fi
      if grep -l KOLU_ACP_AGENT $out/bin/* 2>/dev/null | grep -q .; then
        echo "FAIL: a wrapper in padi-agent names KOLU_ACP_AGENT:" >&2
        grep -l KOLU_ACP_AGENT $out/bin/* >&2
        exit 1
      fi

      ${agentDistro.proof { floor = false; }}
    '';
    meta.mainProgram = "padi";
  };

  osfacts = import sources.osfacts { inherit pkgs; };
in
{
  inherit agentFlakeSrc agentFlakeEnv default koluBin kaval kaval-tui kolu-rpc padi padi-agent padi-tui koluEnv pnpmDeps typecheck osfacts;
  inherit kolu;
  kolu-deps = koluDeps;
  kolu-runtime-deps = koluRuntimeDeps;
  agent-distro-bundle = agentDistro.bundle;
  agent-distro-pre-models = import ./packages/agent-distro/package.nix {
    inherit pkgs;
    src = sources.agent-distro-pre-models;
  };
  agent-distro-delivery = agentDistro.delivery;
  agent-published-nix = pkgs.linkFarm "agent-published-nix" [
    { name = "content-addressed"; path = pkgs.nixVersions.nix_2_34; }
    { name = "signed"; path = pkgs.nixVersions.nix_2_35; }
  ];
  acp-adapter = pkgs.kolu-acp-adapter;
}
