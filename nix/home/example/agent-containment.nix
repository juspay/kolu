# I1 (juspay/kolu#2101) — the by-construction containment proof.
#
# ONE claim: every agent closure a remote may be provisioned with is IN the
# closure of the generation a `services.kolu` deploy installs. If that holds, a
# `--host` connect can never consult a binary cache and can never ask the target
# to realise a daemon from source, because the bits are already in the binder's
# own store and GC-rooted by its current generation.
#
# THE SIBLING TO `ci::agent-flake-nix`, AND THE DIFFERENCE. That recipe proves
# every `expose` attr EVALUATES from the baked agent source — it forces
# `drvPath` and stops. This one proves the same attrs are PRESENT: it forces the
# out-paths and asks `closureInfo` whether the deployed generation reaches them.
# Eval-provable and present are independent failures (the incident was the
# second with the first green), so they are two checks, not one.
#
# The inventory is read from `nix/agent-packages.json`'s `expose` inside the
# kolu input — the same manifest the module's flake wrapper maps over. Reading
# it here rather than restating it is what makes this check able to FAIL: a
# hand-listed set would silently stop covering a newly exposed agent, which is
# precisely the drift the assertion is for.
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

  # `closureInfo` realises the generation and writes the full transitive path
  # set to `store-paths`, one per line — the same question `nix path-info -r`
  # answers, asked at build time so a red is a build failure rather than a
  # recipe nobody runs.
  closure = pkgs.closureInfo { rootPaths = [ generation ]; };

  # One `grep -qxF` per agent, each keeping its OWN failure line, so a red names
  # the attr that went missing instead of reporting "some agent".
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
  # The remedy, as a FILE rather than an in-script heredoc: a heredoc's
  # terminator has to sit at a fixed column, which makes the prose hostage to
  # whatever the nix formatter decides about indentation inside `''` strings.
  # `cat`ing a `writeText` has no such coupling.
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
