{ pkgs, kolu, generation }:
let
  inherit (pkgs) lib;
  system = pkgs.stdenv.hostPlatform.system;

  expose =
    (builtins.fromJSON
      (builtins.readFile "${kolu}/nix/agent-packages.json")).expose;

  agents = map
    (name: {
      inherit name;
      path = kolu.packages.${system}.${name};
    })
    expose;

  closure = pkgs.closureInfo { rootPaths = [ generation ]; };

  probes = lib.concatMapStrings
    (agent: ''
      if grep -qxF '${agent.path}' "${closure}/store-paths"; then
        echo "  ok      ${agent.name} ${agent.path}"
      else
        echo "  MISSING ${agent.name} ${agent.path}" >&2
        missing="''${missing}${agent.name} "
      fi
    '')
    agents;
  remedy = pkgs.writeText "kolu-agent-closure-containment-remedy" ''

    A host running this generation would have to find those closures somewhere
    else at connect time — a binary cache, or a source realise on the target
    over ssh. That is the production incident I1 exists to abolish
    (juspay/kolu#2101; packages/surface-remote/src/nixCopy.ts narrates it as
    "no declared cache had the agent closure — realising from source instead"
    and "no local copy of the agent to ship — the host will realise it from
    source").

    The carrier is `services.kolu.agentPackages` in nix/home/module.nix,
    anchored on the service definition as `KOLU_BAKED_AGENT_CLOSURES`. Either
    that reference was removed, or the flake wrapper's default no longer maps
    over nix/agent-packages.json's `expose`.
  '';
in
assert lib.assertMsg (agents != [ ])
  "nix/agent-packages.json exposes no agent packages — this check would pass by asking nothing";
pkgs.runCommand "kolu-agent-closure-containment" { } ''
  echo "generation: ${generation}"
  echo "agent closures that must be carried by it:"
  missing=""
  ${probes}
  if [ -n "$missing" ]; then
    echo >&2
    echo "FAIL: the deployed generation does not carry: $missing" >&2
    cat ${remedy} >&2
    exit 1
  fi
  echo "every exposed agent closure is carried by the deployed generation"
  touch $out
''
