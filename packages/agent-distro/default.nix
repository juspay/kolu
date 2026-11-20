{ pkgs, src, pluginSrc, readListing }:
let
  inherit (pkgs) lib;

  distro = (import "${src}/flake.nix").outputs {
    nixpkgs = {
      outPath = pkgs.path;
      inherit lib;
    };
  };

  package = import ./package.nix { inherit pkgs src; };

  manifest = pkgs.writeText "agent-distro.json" (builtins.toJSON {
    dir = "${package}";
    bin = "${package}/bin";
  });

  bundle = pkgs.runCommand "agent-distro-bundle" { } ''
    mkdir -p "$out/share/kolu"
    cp ${manifest} "$out/share/kolu/agent-distro.json"
  '';

  stateHomePlaceholder = "@KOLU_XDG_STATE_HOME@";
  flakeRef = "github:${distro.lib.caIndex.repo}";
  hostState = pkgs.writeText "kolu-agent-distro-state.json" (builtins.toJSON {
    inherit stateHomePlaceholder;
    state = distro.lib.stateDirectory {
      xdgStateHome = stateHomePlaceholder;
      flake = flakeRef;
      profile = "default";
    };
    history = distro.lib.historyFile stateHomePlaceholder;
    landed = "${stateHomePlaceholder}/kolu/agent-distro/landed.json";
  });

  delivery = pkgs.writeText "kolu-agent-distro-delivery.json" (builtins.toJSON {
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
  env = {
    bundle = "KOLU_AGENT_DISTRO_BUNDLE";
    state = "KOLU_AGENT_DISTRO_STATE";
    delivery = "KOLU_AGENT_DISTRO_DELIVERY";
    pluginDir = "KOLU_AGENT_PLUGIN_DIR";
  };

  bakeEnv = { floor }:
    lib.optionalAttrs floor
      {
        ${env.bundle} = "${bundle}";
        ${env.delivery} = "${delivery}";
      } // {
      ${env.state} = "${hostState}";
      ${env.pluginDir} = "${pluginDir}";
    };

  bakeArgs = { floor }: lib.concatStringsSep " "
    (lib.mapAttrsToList (name: value: ''--set ${name} "${value}"'') (bakeEnv { inherit floor; }));

  proof = { floor }: ''
    echo "resolved ${env.state}=''${${env.state}:-}"
    echo "resolved ${env.pluginDir}=''${${env.pluginDir}:-}"
    for f in plugin.json mcp.json skills/kolu/SKILL.md .claude-plugin/plugin.json; do
      if [ ! -f "''${${env.pluginDir}:-}/$f" ]; then
        echo "FAIL: ${env.pluginDir} has no $f — every harness would launch without kolu's plugin." >&2
        exit 1
      fi
    done
    if ! jq -e --arg p ${lib.escapeShellArg stateHomePlaceholder} '(.state | startswith($p)) and (.history | startswith($p)) and (.landed | startswith($p))' "''${${env.state}:-/dev/null}" >/dev/null; then
      echo "FAIL: ${env.state} does not keep its state under the host-home placeholder — every host would use the build machine's home." >&2
      exit 1
    fi
  '' + (if floor then ''
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
