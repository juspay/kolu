# agent-distro (https://github.com/juspay/agent-distro), consumed from its npins
# pin and built with kolu's own nixpkgs: the coding agents (`claude`, `codex`,
# `omp`, `opencode`, `opencode2`, `pi`) a kolu terminal gets on its PATH.
#
# Everything here is agent-distro's own library — its validated `profiles`, its
# `mkLaunchers`, `mkPicker`, `mkUpdater`, `stateDirectory` and `cache` — read off
# its flake outputs with kolu's nixpkgs standing in for the flake's own input
# (the same "one nixpkgs for every harness" move agent-distro's
# lib/flake-source.nix makes for its upstreams). Kolu adds a layout and a
# default; it re-implements nothing.
#
# Three values leave this file, each baked onto a wrapper in default.nix:
#
#   * `bundle` — the LOCAL FLOOR (`KOLU_AGENT_DISTRO_BUNDLE`): every profile's
#     launchers, so switching profile on the machine running kolu is instant
#     and offline. Layout:
#         bin/agent-distro            the picker, `vanilla` first — the one
#                                     `--list --json` kolu-server reads
#         profiles/<name>/bin/…       that profile's harnesses + a picker
#                                     defaulting to it
#   * `updater` — per-profile updater configs (`KOLU_AGENT_DISTRO_UPDATER`): how
#     a host fetches a profile's bundle from the binary cache into its own store
#     (agent-distro's `lib.mkUpdater`), and where that host keeps `current`.
#     Baked on BOTH arms; a remote host (no floor) runs it on first use.
#   * `pluginDir` — this kolu's `agent-plugin` (`KOLU_AGENT_PLUGIN_DIR`), handed
#     to every harness at launch through `AGENT_DISTRO_PLUGINS`, so kolu's MCP
#     plugin is loaded in every profile without agent-distro pinning kolu.
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
  # so it defaults to plain upstream. kolu-common's `DEFAULT_PREFERENCES` names
  # the same profile; the `default` wrapper's proof checks it is this one.
  defaultProfile = "vanilla";
  profileNames =
    assert lib.assertMsg (distro.profiles ? ${defaultProfile})
      "agent-distro has no '${defaultProfile}' profile; kolu's default must be one it ships";
    [ defaultProfile ] ++ lib.remove defaultProfile (lib.attrNames distro.profiles);

  # Some harnesses are unfree (Claude Code), so the launchers need a package
  # set that allows them. Node and the runtime tree are free, so the updater's
  # store paths are the same either way.
  pkgsUnfree = import pkgs.path {
    inherit (pkgs.stdenv.hostPlatform) system;
    config.allowUnfree = true;
  };

  launchers = lib.genAttrs profileNames (name:
    distro.lib.mkLaunchers {
      pkgs = pkgsUnfree;
      profile = distro.profiles.${name};
    });

  # A picker over every profile, defaulting to `default`.
  pickerFor = default: distro.lib.mkPicker {
    pkgs = pkgsUnfree;
    inherit default;
    profiles = lib.genAttrs profileNames (name: {
      profile = distro.profiles.${name};
      launchers = launchers.${name};
    });
  };

  # One profile's terminal-facing directory: its bundle (the harness commands
  # and `share/agent-distro/versions`) plus a picker that defaults to it.
  profileBundle = name: pkgs.symlinkJoin {
    name = "agent-distro-${name}-kolu";
    paths = [ launchers.${name}.bundle (pickerFor name) ];
  };

  bundle = pkgs.runCommand "agent-distro-bundle" { } ''
    mkdir -p "$out/bin" "$out/profiles"
    ln -s ${lib.getExe (pickerFor defaultProfile)} "$out/bin/agent-distro"
    ${lib.concatMapStrings (name: ''
      ln -s ${profileBundle name} "$out/profiles/${name}"
    '') profileNames}
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
    in
    {
      inherit name;
      inherit (u) command;
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
in
{
  inherit bundle updater pluginDir defaultProfile profileNames stateHomePlaceholder;
}
