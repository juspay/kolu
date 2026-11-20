{ pkgs, kolu, lib, ... }:
let
  nixLib = pkgs.lib;

  # The remote. `root` deliberately: the ssh user must be in the target's
  # `trusted-users` for `nix copy --to ssh-ng://` to accept unsigned paths out of
  # the binder's own store, and root is the one account NixOS trusts with no
  # nix.conf edit. A non-root ssh user is a DIFFERENT (and real) failure mode,
  # narrated by `shipAgentClosure` with its own remedy — not what this proves.
  target = "root@agenthost";
  mapKey = "remote:${target}";

  # The two narration lines the incident is MADE OF, verbatim from
  # packages/surface-remote/src/nixCopy.ts. Spelled once, asserted absent below.
  # If either is ever reworded this test must be reworded with it — a silently
  # renamed incident string would make the absence assertion pass by matching
  # nothing.
  incidentLines = [
    "no declared cache had the agent closure — realising from source instead"
    "no local copy of the agent to ship — the host will realise it from source"
  ];

  shipLine = "agent closure shipped";

  koluSources = import "${kolu}/npins";
  evalInputs = map (name: koluSources.${name})
    (builtins.attrNames
      (builtins.fromJSON (builtins.readFile "${kolu}/npins/sources.json")).pins);

  offlineNix = {
    nix.settings = {
      substituters = nixLib.mkForce [ ];
      trusted-public-keys = nixLib.mkForce [ ];
      experimental-features = [ "nix-command" "flakes" ];
    };
  };

  journalHas = needle:
    "journalctl _UID=1000 --no-pager | grep -qF ${nixLib.escapeShellArg needle}";

  assertNoIncident = nixLib.concatMapStringsSep "\n"
    (line: ''machine.fail("${journalHas line}")'')
    incidentLines;
in
pkgs.testers.nixosTest {
  name = "kolu-offline-provision";

  nodes = {
    machine = lib.survivalVmNode (offlineNix // {
      virtualisation = {
        memorySize = 6144;
        cores = 4;
        writableStore = true;
        additionalPaths = evalInputs;
      };
    });

    agenthost = { ... }: {
      imports = [ offlineNix ];
      services.openssh = {
        enable = true;
        settings.PermitRootLogin = "prohibit-password";
      };
      # THE ONE FIXTURE KNOB, AND WHY IT IS NOT A CHEAT. A store path is
      # accepted by a target either because the pushing ssh user is in the
      # target's `trusted-users`, or because the NAR carries a signature the
      # target trusts (kolu's own docs name both arms). Neither is available
      # here, for reasons that have nothing to do with I1: `nix copy --to
      # ssh-ng://` runs `nix-daemon --stdio` on the target, and the proxied
      # connection is NOT credited with the ssh user's trust — measured in this
      # very nixpkgs: the same copy over the older `ssh://` (`nix-store --serve
      # --write`) succeeds as root while `ssh-ng://` refuses; and these paths
      # are unsigned because the outer builder built them rather than fetching
      # them from a signing cache.
      #
      # Signature policy is a DIFFERENT axis from the one under test. Left as
      # it is, this fixture would measure remote trust configuration and never
      # reach the question it exists to ask. So the target is told to accept
      # what its operator ships it — which is what `trusted-users` would already
      # mean if `ssh-ng` honoured it — and the assertions stay pinned to whether
      # the binder HAD the closure to ship.
      nix.settings.require-sigs = false;
      virtualisation = {
        memorySize = 8192;
        cores = 2;
        writableStore = true;
      };
    };
  };

  testScript = ''
    start_all()

    for node, node_name in ((machine, "machine"), (agenthost, "agenthost")):
        subs = node.succeed("nix config show substituters").strip()
        assert subs == "", f"{node_name} still has substituters: {subs!r}"

    ${lib.bootPoll}

    # NOT declaratively: a home-manager-managed private key is a world-readable
    # store symlink and ssh refuses it. So the identity is generated in place and
    # the nodes are introduced BEFORE any host is added — kolu classifies an
    # unverified host key as a TERMINAL fault, so a dial that raced this setup
    # would settle `failed` and never retry.
    agenthost.wait_for_open_port(22)

    machine.succeed("su -l alice -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'")
    machine.succeed(
        "su -l alice -c 'ssh-keygen -q -t ed25519 -N \"\" -f ~/.ssh/id_ed25519'"
    )
    pubkey = machine.succeed("cat /home/alice/.ssh/id_ed25519.pub").strip()

    agenthost.succeed("mkdir -p /root/.ssh && chmod 700 /root/.ssh")
    agenthost.succeed(f"echo '{pubkey}' >> /root/.ssh/authorized_keys")
    agenthost.succeed("chmod 600 /root/.ssh/authorized_keys")

    machine.succeed("su -l alice -c 'ssh-keyscan -H agenthost >> ~/.ssh/known_hosts'")
    machine.succeed(
        "su -l alice -c 'ssh -o BatchMode=yes ${target} nix config show system'"
    )

    machine.succeed(
        "${lib.rpc {
          tag = "hosts/add";
          payload = ''{"host":{"kind":"remote","target":"${target}"}}'';
          python = true;
        }}"
    )

    try:
        machine.wait_until_succeeds("${journalHas shipLine}", timeout=900)
    except Exception:
        machine.log("the agent closure was never shipped — dumping alice's user journal")
        _, journal = machine.execute(
            "journalctl _UID=1000 --no-pager --lines=600 2>&1 || true"
        )
        machine.log(journal)
        raise

    ${assertNoIncident}

    machine.wait_until_succeeds(
        "${lib.rpc {
          tag = "surface/padi/lifecycle/create";
          payload = ''{"mapKey":"${mapKey}","input":{"placement":{"kind":"toplevel"}}}'';
          python = true;
        }}",
        timeout=300,
    )

    ${assertNoIncident}
  '';
}
