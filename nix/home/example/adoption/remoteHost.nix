# The two-node REMOTE-HOST fixture — a binder and an ssh+nix remote, offline —
# shared by the checks that dial a second host: `offline-provision.nix` (a
# connect ships the agent closure) and `remote-deploy.nix` (a deploy replaces
# the remote's padi under its terminals).
#
#   machine   — the binder. The deployed generation (the same `nixosModule` the
#               other adoption tests boot), kolu running as alice's user service.
#   agenthost — the remote. sshd + nix + a writable store, nothing else. root's
#               `authorized_keys` gets alice's key at runtime, so the ssh user is
#               in the target's `trusted-users` and the closure copy is accepted.
#
# SUBSTITUTION IS ASSERTED, NOT INHERITED (`offline-provision.nix` checks it).
# NixOS VM tests have no network, so "no cache" would be true here by accident;
# both nodes force `nix.settings.substituters = []`.
#
# THE EVAL INPUTS. Resolving WHICH agent derivation a host needs stays lazy by the
# F6 decision (packages/server/src/padi/remotePadiBinding.ts's
# `makeResolvePadiDrv`), and that evaluation reads the pinned sources npins
# fetches — which a real binder has because it built kolu, and which a VM's nix db
# does not know about because they are in no runtime closure. So
# `virtualisation.additionalPaths` registers exactly those eval inputs on the
# binder.
{ pkgs, kolu, lib }:
let
  nixLib = pkgs.lib;

  # The remote. `root` deliberately: the ssh user must be in the target's
  # `trusted-users` for `nix copy --to ssh-ng://` to accept unsigned paths out of
  # the binder's own store, and root is the one account NixOS trusts with no
  # nix.conf edit. A non-root ssh user is a DIFFERENT (and real) failure mode,
  # narrated by `shipAgentClosure` with its own remedy — not what these prove.
  target = "root@agenthost";
  # `encodeHostKey { kind = "remote"; target = …; }` — kolu-common/hostKey.ts.
  mapKey = "remote:${target}";

  # The EVAL inputs, DERIVED from kolu's own npins manifest rather than listed: a
  # hand-written list would silently stop covering a newly added pin, and the
  # test would then fail as an unexplained eval error rather than as a missing
  # pin.
  koluSources = import "${kolu}/npins";
  evalInputs = map (name: koluSources.${name})
    (builtins.attrNames
      (builtins.fromJSON (builtins.readFile "${kolu}/npins/sources.json")).pins);

  # Shared by both nodes: no substituters, and the `nix-command`/`flakes`
  # features every provisioning invocation needs — kolu shells out to `nix eval`,
  # `nix copy` and `nix build`, none of which exist without them, and NixOS does
  # not enable them by default.
  offlineNix = {
    nix.settings = {
      substituters = nixLib.mkForce [ ];
      trusted-public-keys = nixLib.mkForce [ ];
      experimental-features = [ "nix-command" "flakes" ];
    };
  };
in
{
  inherit mapKey;

  nodes = {
    # The binder — the deployed generation, identical to the other adoption
    # tests' node apart from the offline nix settings, the eval-input
    # registration, and room to evaluate and ship a ~740 MiB closure.
    machine = lib.survivalVmNode (offlineNix // {
      virtualisation = {
        memorySize = 6144;
        cores = 4;
        # The binder WRITES during a dial: nix adds the evaluated `.drv`s and
        # their sources to its store. A read-only store fails the eval, not the
        # claim.
        writableStore = true;
        additionalPaths = evalInputs;
      };
    });

    # The remote — the smallest thing that can receive a closure and run padi out
    # of it.
    # `imports`, not `//`: this node adds its OWN `nix.settings` entry, and a
    # shallow update would silently drop the offline settings it must keep.
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
      # here, for reasons that have nothing to do with these checks: `nix copy
      # --to ssh-ng://` runs `nix-daemon --stdio` on the target, and the proxied
      # connection is NOT credited with the ssh user's trust — measured in this
      # very nixpkgs: the same copy over the older `ssh://` (`nix-store --serve
      # --write`) succeeds as root while `ssh-ng://` refuses; and these paths
      # are unsigned because the outer builder built them rather than fetching
      # them from a signing cache.
      #
      # Signature policy is a DIFFERENT axis from the ones under test. Left as
      # it is, this fixture would measure remote trust configuration and never
      # reach the questions it exists to ask. So the target is told to accept
      # what its operator ships it — which is what `trusted-users` would already
      # mean if `ssh-ng` honoured it.
      nix.settings.require-sigs = false;
      virtualisation = {
        # The copied closure lands in this node's writable overlay, a tmpfs sized
        # from RAM — so the memory budget IS the store budget here.
        memorySize = 8192;
        cores = 2;
        writableStore = true;
      };
    };
  };

  # ssh trust, at runtime — a testScript fragment, after `lib.bootPoll`.
  #
  # NOT declaratively: a home-manager-managed private key is a world-readable
  # store symlink and ssh refuses it. So the identity is generated in place and
  # the nodes are introduced BEFORE any host is added — kolu classifies an
  # unverified host key as a TERMINAL fault, so a dial that raced this setup
  # would settle `failed` and never retry.
  sshTrust = ''
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
    # Prove the hop and the remote's nix work, so a later failure cannot be
    # mis-read as an ssh problem.
    machine.succeed(
        "su -l alice -c 'ssh -o BatchMode=yes ${target} nix config show system'"
    )'';

  # Add the remote host — the dial. A testScript fragment.
  addHost = ''
    machine.succeed(
        "${lib.rpc {
          tag = "hosts/add";
          payload = ''{"host":{"kind":"remote","target":"${target}"}}'';
          python = true;
        }}"
    )'';
}
