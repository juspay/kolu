# @kolu/agent-distro's Nix half — kolu's whole build-side contract with
# agent-distro (https://github.com/juspay/agent-distro), consumed from its npins
# pin and built with kolu's own nixpkgs: the coding agents a kolu terminal can
# get on its PATH (which ones, for users: kolu.dev/agents).
# The package's TypeScript half (src/) reads what this file bakes.
#
# Everything here is agent-distro's own library — its validated `profiles`, its
# `mkLaunchers`, `stateDirectory`, `cache` and `schedule` — read off
# its flake outputs with kolu's nixpkgs standing in for the flake's own input
# (the same "one nixpkgs for every harness" move agent-distro's
# lib/flake-source.nix makes for its upstreams). Kolu adds a manifest, a default
# and the proofs; it re-implements nothing.
#
# What leaves this file:
#
#   * `bundle` — the LOCAL FLOOR: every profile's bundle, as agent-distro builds
#     it, so switching profile on the machine running kolu is instant and
#     offline. Each bundle describes itself (`share/agent-distro/profile.json`
#     and `versions`, which kolu-server reads) and carries its own picker,
#     `bin/agent-distro` — a command for people, never run for information.
#     kolu's one file about the floor is the MANIFEST,
#     `share/kolu/agent-distro.json`:
#         { default, profiles: [{ name, dir, bin }] }
#     — the default profile, and each profile's directory (what a terminal
#     pins) and its `bin/` (what goes on PATH). A short hash is read off the
#     path itself, never a field: a content-addressed rewrite of a bundle
#     rewrites the store paths in it but not a bare hash. Generated from
#     the very values that build the directories, so nothing downstream knows a
#     layout by hand.
#   * `profiles` — the profiles this build knows, in listing order, and where a
#     host keeps each one's `current` (agent-distro's own `stateDirectory`,
#     under a placeholder state home padi makes concrete on its host). Baked on
#     BOTH arms: padi checks a pushed setting against it and points `current`
#     at the bundle kolu delivered.
#   * `delivery` — what the BINDER (kolu-server) needs to deliver a profile's
#     bundle to every host: upstream's content-addressed index (which store
#     path each system's bundle is), its one binary cache (`lib.cache`, the
#     store every host pulls that path from) and its update schedule
#     (`lib.schedule`). Baked on the floor arm only — the binder decides when
#     and what a host pulls; a host never decides on its own.
#   * `pluginDir` — this kolu's `agent-plugin`, handed to every harness at launch
#     through `AGENT_DISTRO_PLUGINS`, so kolu's MCP plugin is loaded in every
#     profile without agent-distro pinning kolu.
#   * `bakeArgs { floor }` — the `--set` flags that bake the above onto a
#     wrapper (the floor and the delivery only when `floor`).
#   * `proof { floor }` — the build-time check a wrapper runs on what it baked.
#     On the floor it runs `readListing`, kolu-server's own boot read of the
#     floor's profiles (the caller builds that command: this file does not know
#     where kolu-server lives), so the build fails on a floor kolu-server would
#     refuse.
#
# The default profile is typed ONCE, in ./defaults.json, which the TypeScript
# half reads too (DEFAULT_PREFERENCES).
{ pkgs, src, pluginSrc, readListing }:
let
  inherit (pkgs) lib;

  # agent-distro's flake outputs with kolu's nixpkgs as its `nixpkgs` input.
  # Only `profiles` and `lib` are read: both are plain values, so this never
  # instantiates the flake's own per-system package sets.
  distro = (import "${src}/flake.nix").outputs {
    nixpkgs = {
      outPath = pkgs.path;
      inherit lib;
    };
  };

  # The bundle kolu lists first: plain upstream, the one every profile that is
  # not a bundle of its own rides — kolu's default Agents profile,
  # `github:juspay/skills`, among them (`JUSPAY_PROFILE` in src/status.ts).
  # Read from ./defaults.json, the one place it is written.
  inherit (lib.importJSON ./defaults.json) defaultProfile;
  profileNames =
    assert lib.assertMsg (distro.profiles ? ${defaultProfile})
      "agent-distro has no '${defaultProfile}' profile; kolu's default must be one it ships";
    [ defaultProfile ] ++ lib.remove defaultProfile (lib.attrNames distro.profiles);

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

  launchers = lib.genAttrs profileNames (name:
    distro.lib.mkLaunchers {
      pkgs = pkgsUnfree;
      profile = distro.profiles.${name};
    });

  # The manifest: the floor described by the SAME values that build it. Each
  # profile's directory is agent-distro's bundle as is — the same kind of store
  # path kolu delivers to a host as `current`.
  manifest = pkgs.writeText "agent-distro.json" (builtins.toJSON {
    default = defaultProfile;
    profiles = map
      (name:
        let dir = "${launchers.${name}.bundle}";
        in {
          inherit name dir;
          bin = "${dir}/bin";
        })
      profileNames;
  });

  bundle = pkgs.runCommand "agent-distro-bundle" { } ''
    mkdir -p "$out/share/kolu"
    cp ${manifest} "$out/share/kolu/agent-distro.json"
  '';

  # Where a host keeps each profile: agent-distro's own `stateDirectory`, so a
  # host that also runs agent-distro's Home Manager module for the same profile
  # shares its `current` rather than keeping a second one. A host's state home
  # is only known on that host, so the directory is written against a
  # placeholder home that padi replaces with the host's real `$XDG_STATE_HOME`
  # (or `~/.local/state`). The history log is upstream's too.
  flakeRef = "github:juspay/agent-distro";
  stateHomePlaceholder = "@KOLU_XDG_STATE_HOME@";
  profiles = pkgs.writeText "kolu-agent-distro-profiles.json" (builtins.toJSON {
    inherit stateHomePlaceholder;
    history = "${stateHomePlaceholder}/agent-distro/history.log";
    # Listing order: the default first.
    profiles = map
      (name: {
        inherit name;
        state = distro.lib.stateDirectory {
          xdgStateHome = stateHomePlaceholder;
          flake = flakeRef;
          profile = name;
        };
      })
      profileNames;
  });

  # What kolu-server delivers from: the index it reads each bundle's
  # content-addressed path off, the one binary cache every host pulls that path
  # from (never building one), and when it runs. The cache and the schedule are
  # upstream's `lib` values; the index base is upstream's too (its own updater's
  # `CA_INDEX`, src/update/update.ts), spelled here once because `lib` does not
  # export it.
  caIndex = "https://raw.githubusercontent.com/juspay/agent-distro/ca-index";
  delivery = pkgs.writeText "kolu-agent-distro-delivery.json" (builtins.toJSON {
    index = caIndex;
    cache = distro.lib.cache.url;
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
    profiles = "KOLU_AGENT_DISTRO_PROFILES";
    delivery = "KOLU_AGENT_DISTRO_DELIVERY";
    pluginDir = "KOLU_AGENT_PLUGIN_DIR";
  };

  # The `--set` flags that bake the agents onto a wrapper. Both arms bake the
  # profiles listing and the plugin dir; only the arm a user runs locally bakes
  # the floor and the delivery — kolu-server delivers every host's agents, and
  # a remote host's padi only points `current` at what it was given.
  bakeArgs = { floor }: lib.concatStringsSep " " (
    lib.optionals floor [
      ''--set ${env.bundle} "${bundle}"''
      ''--set ${env.delivery} "${delivery}"''
    ]
    ++ [
      ''--set ${env.profiles} "${profiles}"''
      ''--set ${env.pluginDir} "${pluginDir}"''
    ]
  );

  # The proof a wrapper runs on the bake it RESOLVED (after sourcing its own
  # composed wrapper): a broken bake fails the build that would ship it, not a
  # user's spawn. It reads only the manifest and the listings — never a
  # directory layout by hand. Needs `jq` on PATH.
  proof = { floor }: ''
    echo "resolved ${env.profiles}=''${${env.profiles}:-}"
    echo "resolved ${env.pluginDir}=''${${env.pluginDir}:-}"
    if [ ! -f "''${${env.pluginDir}:-}/plugin.json" ]; then
      echo "FAIL: ${env.pluginDir} has no plugin.json — every harness would launch without kolu's plugin." >&2
      exit 1
    fi
    first=$(jq -r '.profiles[0].name' "''$${env.profiles}")
    if [ "$first" != ${defaultProfile} ]; then
      echo "FAIL: the profiles listing's first profile is '$first', not kolu's default '${defaultProfile}' (packages/agent-distro/defaults.json)." >&2
      exit 1
    fi
    if ! jq -e --arg p ${lib.escapeShellArg stateHomePlaceholder} 'all(.profiles[]; .state | startswith($p)) and (.history | startswith($p))' "''$${env.profiles}" >/dev/null; then
      echo "FAIL: the profiles listing does not keep its state under the host-home placeholder — every host would use the build machine's home." >&2
      exit 1
    fi
  '' + (if floor then ''
    # The floor: present, described by its manifest, and every profile it
    # names really there — describing itself (read by kolu-server's own boot
    # read, which throws on a bundle whose profile.json names another profile),
    # with a launcher for every harness its versions file names, and its own
    # picker.
    echo "resolved ${env.bundle}=''${${env.bundle}:-}"
    echo "resolved ${env.delivery}=''${${env.delivery}:-}"
    if ! jq -e '(.index | length > 0) and (.cache | length > 0) and (.schedule.periodSeconds > 0)' "''${${env.delivery}:-/dev/null}" >/dev/null; then
      echo "FAIL: ${env.delivery} does not name agent-distro's index, cache and schedule — kolu-server could deliver no agents." >&2
      exit 1
    fi
    m="''${${env.bundle}:-}/share/kolu/agent-distro.json"
    if [ ! -f "$m" ]; then
      echo "FAIL: ${env.bundle} has no manifest at share/kolu/agent-distro.json." >&2
      exit 1
    fi
    if [ "$(jq -r '.default' "$m")" != ${defaultProfile} ]; then
      echo "FAIL: the floor manifest's default is not kolu's default '${defaultProfile}'." >&2
      exit 1
    fi
    if [ "$(jq -c '[.profiles[].name]' "$m")" != "$(jq -c '[.profiles[].name]' "''$${env.profiles}")" ]; then
      echo "FAIL: the floor manifest and the profiles listing name different profiles — Settings would offer a profile padi refuses." >&2
      exit 1
    fi
    # The listing names exactly the manifest's profiles by construction; a
    # bundle that describes another profile makes this read fail.
    if ! listing=$(${readListing}); then
      echo "FAIL: kolu-server could not read the floor's profiles — it would refuse to boot on this build." >&2
      exit 1
    fi
    for p in $(jq -r '.profiles[].name' "$m"); do
      dir=$(jq -r --arg p "$p" '.profiles[] | select(.name == $p) | .dir' "$m")
      bin=$(jq -r --arg p "$p" '.profiles[] | select(.name == $p) | .bin' "$m")
      if [ ! -d "$dir" ] || [ "$bin" != "$dir/bin" ]; then
        echo "FAIL: the floor manifest's entry for '$p' does not describe a real profile directory ($dir, $bin)." >&2
        exit 1
      fi
      if [ ! -x "$bin/agent-distro" ]; then
        echo "FAIL: the floor's '$p' profile has no picker at $bin/agent-distro — a terminal could not run 'agent-distro'." >&2
        exit 1
      fi
      for h in $(jq -r --arg p "$p" '.profiles[] | select(.name == $p) | .harnesses[].name' <<<"$listing"); do
        if [ ! -x "$bin/$h" ]; then
          echo "FAIL: the floor's '$p' profile has no '$h' at $bin/$h." >&2
          exit 1
        fi
      done
    done
  '' else ''
    if [ -n "''${${env.bundle}:-}" ]; then
      echo "FAIL: a floor-less wrapper resolved a floor bundle — it would ship every profile's agents to a remote host." >&2
      exit 1
    fi
    if [ -n "''${${env.delivery}:-}" ]; then
      echo "FAIL: a floor-less wrapper resolved the delivery — only kolu-server decides what a host pulls; a host never decides on its own." >&2
      exit 1
    fi
  '');
in
{
  inherit bundle profiles delivery pluginDir defaultProfile bakeArgs proof;
}
