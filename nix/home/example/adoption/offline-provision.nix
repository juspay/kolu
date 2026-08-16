# I1 (juspay/kolu#2101) — the inverse of deploy #2, as a VM test.
#
# THE CLAIM. With substitution DISABLED on a fresh deploy of the artifact, a
# remote-host connect provisions and converges having consulted no cache and
# asked no host to realise anything from source. Pre-fix — the same fixture with
# the module's agent attachment reverted — the very same connect reproduces the
# production incident's narration, `no local copy of the agent to ship — the
# host will realise it from source`.
#
# TWO NODES, because the incident is a TWO-STORE fact:
#   machine   — the binder. The deployed generation (the same `nixosModule` the
#               other adoption tests boot), kolu running as alice's user service.
#   agenthost — the remote. sshd + nix + a writable store, nothing else. root's
#               `authorized_keys` gets alice's key at runtime, so the ssh user is
#               in the target's `trusted-users` and the closure copy is accepted.
#
# WHY THE SHIP IS THE STEP UNDER TEST. `stageAgentClosure`
# (packages/surface-remote/src/nixCopy.ts) asks the BINDER's store for local
# validity first; only a locally-valid closure is shippable, and shipping is the
# only step that moves binaries. So "is the agent in the binder's store" is the
# ONE lever between a connect that copies and a connect that compiles on someone
# else's machine — and it is exactly the lever the module now pins by carrying
# the closures in the generation. In a NixOS VM a node's nix db is registered
# from its SYSTEM closure, so the pre/post difference lands with no test-side
# help at all: post-fix `padi-agent` is in that closure and `nix-store
# --check-validity` says valid; pre-fix the bits may sit on the shared host store
# but are UNREGISTERED, which IS the incident's "not valid locally" state.
#
# SUBSTITUTION IS ASSERTED, NOT INHERITED. NixOS VM tests have no network, so
# "no cache" would be true here by accident. An accident is not a fixture: both
# nodes force `nix.settings.substituters = []` and the script CHECKS the
# effective value before it dials, so the property this test is named for is one
# the test actually states.
#
# WHAT THIS TEST DOES *NOT* CLAIM — the honest edge. I1 guarantees the CLOSURE,
# not the EVALUATION. Resolving WHICH agent derivation a host needs stays lazy by
# the F6 decision (packages/server/src/padi/remotePadiBinding.ts's
# `makeResolvePadiDrv`), and that evaluation reads the pinned sources npins
# fetches — which a real binder has because it built kolu, and which a VM's nix db
# does not know about because they are in no runtime closure. So
# `virtualisation.additionalPaths` registers exactly those eval inputs, on BOTH
# arms, held constant. The only difference between the red run and the green one
# is whether the generation carries the closure.
{ pkgs, kolu, lib, ... }:
let
  nixLib = pkgs.lib;

  # The remote. `root` deliberately: the ssh user must be in the target's
  # `trusted-users` for `nix copy --to ssh-ng://` to accept unsigned paths out of
  # the binder's own store, and root is the one account NixOS trusts with no
  # nix.conf edit. A non-root ssh user is a DIFFERENT (and real) failure mode,
  # narrated by `shipAgentClosure` with its own remedy — not what this proves.
  target = "root@agenthost";
  # `encodeHostKey { kind = "remote"; target = …; }` — kolu-common/hostKey.ts.
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

  # The proof that the ship actually happened — `shipAgentClosure`'s success
  # narration, same file.
  shipLine = "agent closure shipped";

  # The EVAL inputs, DERIVED from kolu's own npins manifest rather than listed: a
  # hand-written list would silently stop covering a newly added pin, and the
  # test would then fail as an unexplained eval error rather than as a missing
  # pin. See the header — this is scaffolding for the F6 lazy-eval half, and it
  # is deliberately identical on both arms.
  koluSources = import "${kolu}/npins";
  evalInputs = map (name: koluSources.${name})
    (builtins.attrNames
      (builtins.fromJSON (builtins.readFile "${kolu}/npins/sources.json")).pins);

  # Shared by both nodes: no substituters (the property under test), and the
  # `nix-command`/`flakes` features every provisioning invocation needs — kolu
  # shells out to `nix eval`, `nix copy` and `nix build`, none of which exist
  # without them, and NixOS does not enable them by default.
  offlineNix = {
    nix.settings = {
      substituters = nixLib.mkForce [ ];
      trusted-public-keys = nixLib.mkForce [ ];
      experimental-features = [ "nix-command" "flakes" ];
    };
  };

  # A shell-quoted `grep -qF` over alice's whole user journal — where kolu's
  # session progress lines land (`makeSession`'s `emit` → the pino logger
  # kolu-server passes it, stdout of her user unit).
  journalHas = needle:
    "journalctl _UID=1000 --no-pager | grep -qF ${nixLib.escapeShellArg needle}";

  # One `machine.fail` per incident line, joined flush-left so the interpolation
  # lands at the testScript's own (post-strip) column. Each keeps its own line so
  # a red names WHICH half of the incident came back.
  assertNoIncident = nixLib.concatMapStringsSep "\n"
    (line: ''machine.fail("${journalHas line}")'')
    incidentLines;
in
pkgs.testers.nixosTest {
  name = "kolu-offline-provision";

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
        # See the header — the lazy drv resolution's pinned sources.
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
        # The copied closure lands in this node's writable overlay, a tmpfs sized
        # from RAM — so the memory budget IS the store budget here.
        memorySize = 8192;
        cores = 2;
        writableStore = true;
      };
    };
  };

  testScript = ''
    start_all()

    # ── 0. STATE the property, do not inherit it ─────────────────────────────
    # A VM test has no network, so "substitution disabled" would hold here
    # whatever the config said. Check the EFFECTIVE value on both nodes, so this
    # fixture is offline by declaration and goes red if someone hands it a
    # substituter back.
    for node, node_name in ((machine, "machine"), (agenthost, "agenthost")):
        subs = node.succeed("nix config show substituters").strip()
        assert subs == "", f"{node_name} still has substituters: {subs!r}"

    ${lib.bootPoll}

    # ── 1. ssh trust, at runtime ─────────────────────────────────────────────
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
    # Prove the hop and the remote's nix work, so a later failure cannot be
    # mis-read as an ssh problem.
    machine.succeed(
        "su -l alice -c 'ssh -o BatchMode=yes ${target} nix config show system'"
    )

    # ── 2. Add the host — the dial ───────────────────────────────────────────
    machine.succeed(
        "${lib.rpc {
          tag = "hosts/add";
          payload = ''{"host":{"kind":"remote","target":"${target}"}}'';
          python = true;
        }}"
    )

    # ── 3. THE ASSERTION: the closure was SHIPPED out of the binder's store ──
    # Post-fix that is the only way the bits can reach the remote — there is no
    # cache to fetch from and the test asserted as much above. Pre-fix it never
    # appears, and the dump below carries the incident narration that took its
    # place: this test's falsification receipt.
    try:
        machine.wait_until_succeeds("${journalHas shipLine}", timeout=900)
    except Exception:
        machine.log("the agent closure was never shipped — dumping alice's user journal")
        _, journal = machine.execute(
            "journalctl _UID=1000 --no-pager --lines=600 2>&1 || true"
        )
        machine.log(journal)
        raise

    # ── 4. ZERO cache traffic, ZERO source realise ───────────────────────────
    ${assertNoIncident}

    # ── 5. CONVERGENCE: a terminal really opens on the remote padi ───────────
    # Not a log line about a connection — the application contract, on the remote
    # host's own map key. Retried, because the dial is still finishing its
    # handshake when the ship completes. `placement` is REQUIRED on the create
    # input and has no default, so the probe states it: one top-level terminal.
    machine.wait_until_succeeds(
        "${lib.rpc {
          tag = "surface/padi/lifecycle/create";
          payload = ''{"mapKey":"${mapKey}","input":{"placement":{"kind":"toplevel"}}}'';
          python = true;
        }}",
        timeout=300,
    )

    # And the incident stayed absent across the WHOLE convergence, not merely at
    # the moment the ship landed.
    ${assertNoIncident}
  '';
}
