# I1 (juspay/kolu#2101) — the inverse of deploy #2, as a VM test.
#
# THE CLAIM. With substitution DISABLED on a fresh deploy of the artifact, a
# remote-host connect provisions and converges having consulted no cache and
# asked no host to realise anything from source. Pre-fix — the same fixture with
# the module's agent attachment reverted — the very same connect reproduces the
# production incident's narration, `no local copy of the agent to ship — the
# host will realise it from source`.
#
# TWO NODES, because the incident is a TWO-STORE fact — the binder and the
# remote of `remoteHost.nix`, the fixture this shares with `remote-deploy.nix`.
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

  remote = import ./remoteHost.nix { inherit pkgs kolu lib; };
  inherit (remote) mapKey;

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

  inherit (remote) nodes;

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
    ${remote.sshTrust}

    # ── 2. Add the host — the dial ───────────────────────────────────────────
    ${remote.addHost}

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
