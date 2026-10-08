# @kolu/agent-distro's Nix half — kolu's whole build-side contract with
# agent-distro (https://github.com/juspay/agent-distro), consumed from its npins
# pin and built with kolu's own nixpkgs: the coding agents a kolu terminal can
# get on its PATH (which ones, for users: kolu.dev/agents).
# The package's TypeScript half (src/) reads what this file bakes.
#
# Everything here is agent-distro's own library — its validated `profiles`, its
# `mkLaunchers`, `mkUpdater`, `stateDirectory` and `cache` — read off
# its flake outputs with kolu's nixpkgs standing in for the flake's own input
# (the same "one nixpkgs for every harness" move agent-distro's
# lib/flake-source.nix makes for its upstreams). Kolu adds a manifest, a default
# and the proofs; it re-implements nothing.
#
# What leaves this file:
#
#   * `bundle` — the LOCAL FLOOR: every profile's bundle, as agent-distro builds
#     it (its harness commands and its own picker, `bin/agent-distro`), so
#     switching profile on the machine running kolu is instant and offline. Its
#     one file kolu reads is the MANIFEST, `share/kolu/agent-distro.json`:
#         { default, profiles: [{ name, dir, bin, hash }] }
#     — the default profile, and each profile's directory (what a terminal
#     pins), its `bin/` (what goes on PATH, and whose `agent-distro --list
#     --json` kolu-server lists the profile with) and its store hash. Generated
#     from the very values that build the directories, so nothing downstream
#     knows a layout by hand. kolu bakes no picker of its own: the one writer of
#     the picker is agent-distro.
#   * `updater` — per-profile updater configs: how a host fetches a profile's
#     bundle from the binary cache into its own store (agent-distro's
#     `lib.mkUpdater`), and where that host keeps `current`. Baked on BOTH arms;
#     a remote host (no floor) runs it on first use.
#   * `pluginDir` — this kolu's `agent-plugin`, handed to every harness at launch
#     through `AGENT_DISTRO_PLUGINS`, so kolu's MCP plugin is loaded in every
#     profile without agent-distro pinning kolu.
#   * `bakeArgs { floor }` — the `--set` flags that bake the above onto a
#     wrapper (the floor only when `floor`).
#   * `proof { floor }` — the build-time check a wrapper runs on what it baked.
#
# The default profile is typed ONCE, in ./defaults.json, which the TypeScript
# half reads too (DEFAULT_PREFERENCES).
{ pkgs, src, pluginSrc }:
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

  # The profile kolu selects by default and lists first. agent-distro's own
  # registry default is a distribution's choice (`juspay`); kolu is for everyone,
  # so it defaults to plain upstream. Read from ./defaults.json, the one place
  # it is written; kolu-common's `DEFAULT_PREFERENCES` reads the same file.
  inherit (lib.importJSON ./defaults.json) defaultProfile;
  profileNames =
    assert lib.assertMsg (distro.profiles ? ${defaultProfile})
      "agent-distro has no '${defaultProfile}' profile; kolu's default must be one it ships";
    [ defaultProfile ] ++ lib.remove defaultProfile (lib.attrNames distro.profiles);

  # Some harnesses are unfree (Claude Code), so the launchers need a package
  # set that allows them: kolu's own nixpkgs and overlays, re-instantiated with
  # `allowUnfree`. That is a SECOND evaluation of nixpkgs (kolu's set does not
  # allow unfree), paid only when the bundle or the updater configs are forced —
  # `default`, `padi-agent` and `agent-distro-bundle`, never the dev shell. Node
  # and the runtime tree are free, so the updater's store paths are the same
  # either way.
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
  # profile's directory is agent-distro's bundle as is — the harness commands,
  # `share/agent-distro/versions`, and `bin/agent-distro`, the picker over that
  # profile — the very store path a host's updater lands as `current`.
  manifest = pkgs.writeText "agent-distro.json" (builtins.toJSON {
    default = defaultProfile;
    profiles = map
      (name:
        let dir = "${launchers.${name}.bundle}";
        in {
          inherit name dir;
          bin = "${dir}/bin";
          # The store hash of the profile directory a terminal pins.
          hash = builtins.substring 0 32 (builtins.baseNameOf dir);
        })
      profileNames;
  });

  bundle = pkgs.runCommand "agent-distro-bundle" { } ''
    mkdir -p "$out/share/kolu"
    cp ${manifest} "$out/share/kolu/agent-distro.json"
  '';

  # The updater a host runs to fetch a profile's bundle from the binary cache.
  # `mkUpdater` writes an absolute state directory into its config at build
  # time, but a host's state home is only known on that host — so the config
  # is built against a placeholder home that padi replaces with the host's real
  # `$XDG_STATE_HOME` (or `~/.local/state`) before running it. The directory
  # under that home is agent-distro's own `stateDirectory`, so a host that also
  # runs agent-distro's Home Manager module for the same profile shares its
  # `current` rather than keeping a second one.
  flakeRef = "github:juspay/agent-distro";
  stateHomePlaceholder = "@KOLU_XDG_STATE_HOME@";
  updaterFor = name:
    let
      u = distro.lib.mkUpdater {
        pkgs = pkgsUnfree;
        # Read only for its `runtime` (the Node and source tree the updater
        # runs on), so it never forces a harness build.
        bundle = launchers.${name}.bundle;
        flake = flakeRef;
        profile = name;
        stateDirectory = distro.lib.stateDirectory {
          xdgStateHome = stateHomePlaceholder;
          flake = flakeRef;
          profile = name;
        };
        history = "${stateHomePlaceholder}/agent-distro/history.log";
        # The host's own Nix, found on padi's PATH: the bundle lands in the
        # host's store, through the host's own substituter settings.
        nix = "nix";
        substituters.${distro.lib.cache.url} = distro.lib.cache.publicKey;
      };
      # `mkUpdater`'s `command` ENDS with its own (build-time) config path; padi
      # runs the updater with a host-concrete copy of that config instead, so
      # the baked command is the command minus its last argument. Asserted, so
      # an upstream change to `command`'s shape fails this build rather than a
      # host's download.
      command =
        assert lib.assertMsg (lib.last u.command == "${u.config}")
          "agent-distro's mkUpdater command no longer ends with its config path; packages/agent-distro/default.nix strips it";
        lib.init u.command;
    in
    {
      inherit name command;
      config = "${u.config}";
    };

  updater = pkgs.writeText "kolu-agent-distro-updater.json" (builtins.toJSON {
    inherit stateHomePlaceholder;
    # Listing order: the default first.
    profiles = map updaterFor profileNames;
  });

  pluginDir = builtins.path {
    path = pluginSrc;
    name = "kolu-agent-plugin";
  };
  # The env names a wrapper bakes (padi's `agentDistro/bake.ts` reads them).
  env = {
    bundle = "KOLU_AGENT_DISTRO_BUNDLE";
    updater = "KOLU_AGENT_DISTRO_UPDATER";
    pluginDir = "KOLU_AGENT_PLUGIN_DIR";
  };

  # The `--set` flags that bake the agents onto a wrapper. Both arms bake the
  # updater listing and the plugin dir; only the arm a user runs locally bakes
  # the floor — a remote host must download its agents, never receive them
  # over ssh.
  bakeArgs = { floor }: lib.concatStringsSep " " (
    lib.optional floor ''--set ${env.bundle} "${bundle}"''
    ++ [
      ''--set ${env.updater} "${updater}"''
      ''--set ${env.pluginDir} "${pluginDir}"''
    ]
  );

  # The proof a wrapper runs on the bake it RESOLVED (after sourcing its own
  # composed wrapper): a broken bake fails the build that would ship it, not a
  # user's spawn. It reads only the manifest and the updater listing — never a
  # directory layout by hand. Needs `jq` on PATH.
  proof = { floor }: ''
    echo "resolved ${env.updater}=''${${env.updater}:-}"
    echo "resolved ${env.pluginDir}=''${${env.pluginDir}:-}"
    if [ ! -f "''${${env.pluginDir}:-}/plugin.json" ]; then
      echo "FAIL: ${env.pluginDir} has no plugin.json — every harness would launch without kolu's plugin." >&2
      exit 1
    fi
    first=$(jq -r '.profiles[0].name' "''$${env.updater}")
    if [ "$first" != ${defaultProfile} ]; then
      echo "FAIL: the updater listing's first profile is '$first', not kolu's default '${defaultProfile}' (packages/agent-distro/defaults.json)." >&2
      exit 1
    fi
    for f in $(jq -r '.profiles[] | (.command[], .config)' "''$${env.updater}"); do
      if [ ! -e "$f" ]; then
        echo "FAIL: the agent-distro updater listing names '$f', which does not exist — a host could never fetch its agents." >&2
        exit 1
      fi
    done
    for c in $(jq -r '.profiles[].config' "''$${env.updater}"); do
      if ! jq -e --arg p ${lib.escapeShellArg stateHomePlaceholder} '.state | startswith($p)' "$c" >/dev/null; then
        echo "FAIL: $c does not keep its state under the host-home placeholder — every host would use the build machine's home." >&2
        exit 1
      fi
    done
  '' + (if floor then ''
    # The floor: present, described by its manifest, and every profile it
    # names really there with its harnesses and its own picker, which lists
    # exactly that profile.
    echo "resolved ${env.bundle}=''${${env.bundle}:-}"
    m="''${${env.bundle}:-}/share/kolu/agent-distro.json"
    if [ ! -f "$m" ]; then
      echo "FAIL: ${env.bundle} has no manifest at share/kolu/agent-distro.json." >&2
      exit 1
    fi
    if [ "$(jq -r '.default' "$m")" != ${defaultProfile} ]; then
      echo "FAIL: the floor manifest's default is not kolu's default '${defaultProfile}'." >&2
      exit 1
    fi
    if [ "$(jq -c '[.profiles[].name]' "$m")" != "$(jq -c '[.profiles[].name]' "''$${env.updater}")" ]; then
      echo "FAIL: the floor manifest and the updater listing name different profiles — Settings would offer a profile padi refuses." >&2
      exit 1
    fi
    for p in $(jq -r '.profiles[].name' "$m"); do
      dir=$(jq -r --arg p "$p" '.profiles[] | select(.name == $p) | .dir' "$m")
      bin=$(jq -r --arg p "$p" '.profiles[] | select(.name == $p) | .bin' "$m")
      hash=$(jq -r --arg p "$p" '.profiles[] | select(.name == $p) | .hash' "$m")
      if [ ! -d "$dir" ] || [ "$bin" != "$dir/bin" ] || [ "$(basename "$dir" | cut -c1-32)" != "$hash" ]; then
        echo "FAIL: the floor manifest's entry for '$p' does not describe a real profile directory ($dir, $bin, $hash)." >&2
        exit 1
      fi
      if [ ! -x "$bin/agent-distro" ]; then
        echo "FAIL: the floor's '$p' profile has no picker at $bin/agent-distro." >&2
        exit 1
      fi
      listing=$("$bin/agent-distro" --list --json)
      if [ "$(jq -c '[.profiles[].name]' <<<"$listing")" != "[\"$p\"]" ]; then
        echo "FAIL: the floor's '$p' picker does not list exactly '$p'." >&2
        exit 1
      fi
      for h in $(jq -r '.profiles[0].harnesses[].name' <<<"$listing"); do
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
  '');
in
{
  inherit bundle updater pluginDir defaultProfile bakeArgs proof;
}
