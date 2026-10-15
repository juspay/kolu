# @kolu/agent-distro's Nix half — kolu's whole build-side contract with
# agent-distro (https://github.com/juspay/agent-distro), consumed from its npins
# pin and built with kolu's own nixpkgs: the coding agents a kolu terminal can
# get on its PATH (which ones, for users: kolu.dev/agents).
# The package's TypeScript half (src/) reads what this file bakes.
#
# Everything here is agent-distro's own library — its `mkLaunchers`,
# `stateDirectory`, `caIndex`, `cache` and `schedule` — read off its flake
# outputs with kolu's nixpkgs standing in for the flake's own input (the same
# "one nixpkgs for every harness" move agent-distro's lib/flake-source.nix
# makes for its upstreams). Kolu adds a manifest and the proofs; it
# re-implements nothing.
#
# agent-distro is ONE package — every harness launcher and the picker — and
# profiles are not part of it: kolu-server builds each profile of the Agents
# setting with upstream's `lib.mkProfile` and delivers it beside the package
# (`packages/server/src/agentDelivery/`). Nothing here knows a profile.
#
# What leaves this file:
#
#   * `bundle` — the LOCAL FLOOR: the package as agent-distro builds it, so the
#     machine running kolu has its harnesses at once and offline. It describes
#     itself (`share/agent-distro/versions`, which kolu-server reads) and
#     carries its own picker, `bin/agent-distro` — a command for people, never
#     run for information. kolu's one file about the floor is the MANIFEST,
#     `share/kolu/agent-distro.json`:
#         { dir, bin }
#     — the package's directory (what a terminal pins) and its `bin/` (what
#     goes on PATH). Generated from the very value that builds the directory,
#     so nothing downstream knows a layout by hand.
#   * `hostState` — where a host keeps what kolu delivered it: the package's
#     state directory (agent-distro's own `stateDirectory` for its one
#     package, so a host that also runs agent-distro's Home Manager module
#     shares its `current`), the history log, and kolu's record of the
#     profiles that landed — under a placeholder state home padi makes
#     concrete on its host. Baked on BOTH arms: padi points `current` at what
#     kolu delivered and records the profiles beside it.
#   * `delivery` — what the BINDER (kolu-server) needs to deliver the package
#     to every host: upstream's content-addressed index (`lib.caIndex`: which
#     store path each system's package is, at which revision — the revision
#     kolu-server also builds the profiles with), its one binary cache
#     (`lib.cache`, the store every host pulls that path from) and its update
#     schedule (`lib.schedule`). Baked on the floor arm only — the binder
#     decides when and what a host gets; a host never decides on its own.
#   * `pluginDir` — this kolu's `agent-plugin`, handed to every harness at launch
#     through `AGENT_DISTRO_PLUGINS`, so kolu's MCP plugin is loaded in every
#     terminal without agent-distro pinning kolu.
#   * `bakeArgs { floor }` — the `--set` flags that bake the above onto a
#     wrapper (the floor and the delivery only when `floor`).
#   * `proof { floor }` — the build-time check a wrapper runs on what it baked.
#     On the floor it runs `readListing`, kolu-server's own boot read of the
#     floor (the caller builds that command: this file does not know where
#     kolu-server lives), so the build fails on a floor kolu-server would
#     refuse.
{ pkgs, src, pluginSrc, readListing }:
let
  inherit (pkgs) lib;

  # agent-distro's flake outputs with kolu's nixpkgs as its `nixpkgs` input.
  # Only `lib` is read: a plain value, so this never instantiates the flake's
  # own per-system package sets.
  distro = (import "${src}/flake.nix").outputs {
    nixpkgs = {
      outPath = pkgs.path;
      inherit lib;
    };
  };

  # Some harnesses are unfree (Claude Code), so the launchers need a package
  # set that allows them: kolu's own nixpkgs and overlays, re-instantiated with
  # `allowUnfree`. That is a SECOND evaluation of nixpkgs (kolu's set does not
  # allow unfree), paid only when the floor is forced — `default` and
  # `agent-distro-bundle`, never the dev shell or `padi-agent`.
  pkgsUnfree = import pkgs.path {
    inherit (pkgs.stdenv.hostPlatform) system;
    inherit (pkgs) overlays;
    config = pkgs.config // { allowUnfree = true; };
  };

  # The one package, as upstream builds it — the same kind of store path kolu
  # delivers to a host as `current`.
  package = (distro.lib.mkLaunchers { pkgs = pkgsUnfree; }).package;

  # The manifest: the floor described by the SAME value that builds it.
  manifest = pkgs.writeText "agent-distro.json" (builtins.toJSON {
    dir = "${package}";
    bin = "${package}/bin";
  });

  bundle = pkgs.runCommand "agent-distro-bundle" { } ''
    mkdir -p "$out/share/kolu"
    cp ${manifest} "$out/share/kolu/agent-distro.json"
  '';

  # Where a host keeps what kolu delivered: agent-distro's own
  # `stateDirectory` for its one package, keyed as its Home Manager module
  # keys it (the flake it updates from, and the attribute it builds,
  # `default`), so a host that also runs that module shares its `current`
  # rather than keeping a second one. A host's state home is only known on
  # that host, so everything is written against a placeholder home that padi
  # replaces with the host's real `$XDG_STATE_HOME` (or `~/.local/state`). The
  # history log is upstream's too; the record of the set that landed is
  # kolu's own.
  stateHomePlaceholder = "@KOLU_XDG_STATE_HOME@";
  # The flake upstream's index publishes, named once from `lib.caIndex`: the
  # key of the package's state directory (as the Home Manager module keys it)
  # and the flake kolu-server builds profiles with.
  flakeRef = "github:${distro.lib.caIndex.repo}";
  hostState = pkgs.writeText "kolu-agent-distro-state.json" (builtins.toJSON {
    inherit stateHomePlaceholder;
    state = distro.lib.stateDirectory {
      xdgStateHome = stateHomePlaceholder;
      flake = flakeRef;
      profile = "default";
    };
    history = "${stateHomePlaceholder}/agent-distro/history.log";
    landed = "${stateHomePlaceholder}/kolu/agent-distro/landed.json";
  });

  # What kolu-server delivers from: the index it reads the package's
  # content-addressed path (and the revision it was built at) off
  # (`lib.caIndex`), the one binary cache every host pulls that path from and
  # the key a Mac trusts its signed package by (`lib.cache`, never building
  # one), and when it runs (`lib.schedule`). All three are upstream's own
  # values — read here, written nowhere else.
  delivery = pkgs.writeText "kolu-agent-distro-delivery.json" (builtins.toJSON {
    # The flake the index publishes, which kolu-server builds the profiles
    # with at the package's own revision (`github:<repo>/<rev>`).
    flake = flakeRef;
    index = distro.lib.caIndex.rawBase;
    cache = { inherit (distro.lib.cache) url publicKey; };
    schedule = {
      periodSeconds = distro.lib.schedule.updatePeriodSeconds;
      offsetSeconds = distro.lib.schedule.updateOffsetSeconds;
    };
  });

  pluginDir = builtins.path {
    path = pluginSrc;
    name = "kolu-agent-plugin";
  };
  # The env names a wrapper bakes (padi's `agentDistro/bake.ts` reads them).
  env = {
    bundle = "KOLU_AGENT_DISTRO_BUNDLE";
    state = "KOLU_AGENT_DISTRO_STATE";
    delivery = "KOLU_AGENT_DISTRO_DELIVERY";
    pluginDir = "KOLU_AGENT_PLUGIN_DIR";
  };

  # The bake, as name → value: both arms bake the host state and the plugin
  # dir; only the arm a user runs locally bakes the floor and the delivery —
  # kolu-server delivers every host's agents, and a remote host's padi only
  # records what it was given.
  bakeEnv = { floor }:
    lib.optionalAttrs floor
      {
        ${env.bundle} = "${bundle}";
        ${env.delivery} = "${delivery}";
      } // {
      ${env.state} = "${hostState}";
      ${env.pluginDir} = "${pluginDir}";
    };

  # The `--set` flags that bake the agents onto a wrapper.
  bakeArgs = { floor }: lib.concatStringsSep " "
    (lib.mapAttrsToList (name: value: ''--set ${name} "${value}"'') (bakeEnv { inherit floor; }));

  # The proof a wrapper runs on the bake it RESOLVED (after sourcing its own
  # composed wrapper): a broken bake fails the build that would ship it, not a
  # user's spawn. It reads only the manifest and the host state — never a
  # directory layout by hand. Needs `jq` on PATH.
  proof = { floor }: ''
    echo "resolved ${env.state}=''${${env.state}:-}"
    echo "resolved ${env.pluginDir}=''${${env.pluginDir}:-}"
    if [ ! -f "''${${env.pluginDir}:-}/plugin.json" ]; then
      echo "FAIL: ${env.pluginDir} has no plugin.json — every harness would launch without kolu's plugin." >&2
      exit 1
    fi
    if ! jq -e --arg p ${lib.escapeShellArg stateHomePlaceholder} '(.state | startswith($p)) and (.history | startswith($p)) and (.landed | startswith($p))' "''${${env.state}:-/dev/null}" >/dev/null; then
      echo "FAIL: ${env.state} does not keep its state under the host-home placeholder — every host would use the build machine's home." >&2
      exit 1
    fi
  '' + (if floor then ''
    # The floor: present, described by its manifest, and the package it names
    # really there — readable by kolu-server's own boot read (which reads its
    # versions file), with a launcher for every harness that file names, and
    # its own picker.
    echo "resolved ${env.bundle}=''${${env.bundle}:-}"
    echo "resolved ${env.delivery}=''${${env.delivery}:-}"
    if ! jq -e '(.flake | length > 0) and (.index | length > 0) and (.cache.url | length > 0) and (.cache.publicKey | length > 0) and (.schedule.periodSeconds > 0)' "''${${env.delivery}:-/dev/null}" >/dev/null; then
      echo "FAIL: ${env.delivery} does not name agent-distro's index, cache, key and schedule — kolu-server could deliver no agents." >&2
      exit 1
    fi
    m="''${${env.bundle}:-}/share/kolu/agent-distro.json"
    if [ ! -f "$m" ]; then
      echo "FAIL: ${env.bundle} has no manifest at share/kolu/agent-distro.json." >&2
      exit 1
    fi
    dir=$(jq -r '.dir' "$m")
    bin=$(jq -r '.bin' "$m")
    if [ ! -d "$dir" ] || [ "$bin" != "$dir/bin" ]; then
      echo "FAIL: the floor manifest does not describe a real package directory ($dir, $bin)." >&2
      exit 1
    fi
    if [ ! -x "$bin/agent-distro" ]; then
      echo "FAIL: the floor's package has no picker at $bin/agent-distro — a terminal could not run 'agent-distro'." >&2
      exit 1
    fi
    if ! listing=$(${readListing}); then
      echo "FAIL: kolu-server could not read the floor — it would refuse to boot on this build." >&2
      exit 1
    fi
    for h in $(jq -r '.harnesses[].name' <<<"$listing"); do
      if [ ! -x "$bin/$h" ]; then
        echo "FAIL: the floor's package has no '$h' at $bin/$h." >&2
        exit 1
      fi
    done
  '' else ''
    if [ -n "''${${env.bundle}:-}" ]; then
      echo "FAIL: a floor-less wrapper resolved a floor bundle — it would ship the local agents to a remote host." >&2
      exit 1
    fi
    if [ -n "''${${env.delivery}:-}" ]; then
      echo "FAIL: a floor-less wrapper resolved the delivery — only kolu-server decides what a host gets; a host never decides on its own." >&2
      exit 1
    fi
  '');
in
{
  inherit bundle hostState delivery pluginDir bakeArgs proof;
}
