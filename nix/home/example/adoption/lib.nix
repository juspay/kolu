# B3.3 — the shared scaffold behind both adoption VM tests.
#
# There is ONE domain concept here: a NixOS-VM adoption probe — boot kolu, seed a
# terminal over the oRPC API on the surviving daemon, do a server lifecycle event
# (restart, or stop+start-a-new-build), then POLL a verify script until an outcome
# holds, asserting via the result-file-as-root pattern. adopt.nix and skew.nix are
# the SAME scaffold with two outcomes; the only differences are their seed/verify
# predicates, the lifecycle steps between them, and (for skew) an extra user
# service. Everything else — the survival VM node, the boot polls, the
# machinectl+result-file run/assert helpers, the jq/curl bindings, and the
# "open a terminal over RPC and return its id" prologue — lives here ONCE.
{ pkgs, home-manager, nixosModule, port, kavalTui }:
let
  jq = "${pkgs.jq}/bin/jq";
  curl = "${pkgs.curl}/bin/curl";

  # Runtime-layout literals the DAEMON actually creates. These are NOT free
  # choices: each must equal what the running process writes, or the poll just
  # times out and is mis-diagnosed as a recycle/adopt failure. Pinned here, once,
  # to their owning source so a rename has exactly one edit site in the test tree.
  nsPrefix = "kaval-"; # packages/kaval/src/socketPath.ts:31 KAVAL_NS_PREFIX + :35 kavalNamespace → `kaval-<port>`
  gateFile = "kaval.pid"; # packages/kaval/src/daemonMain.ts:42
  # The conf store's on-disk file. `Conf` is constructed with no `configName`
  # (packages/server/src/state.ts:146), so it uses the library default
  # `config.json` — NOT `state.json` (the state.ts:4 doc comment is stale).
  configFile = ".config/kolu/config.json";

  # The kaval rendezvous dir for this server instance, as alice's daemon creates it.
  ns = ''$XDG_RUNTIME_DIR/${nsPrefix}${port}'';

  # "Open a terminal over the app's terminal.create RPC and return its id" — the
  # application-contract prologue both seed scripts share. Sets `id` on success;
  # calls the caller-provided `fail` on any error (so each script keeps its own
  # FAIL-tag and result-file path).
  openTerminal = ''
    id=$(${curl} -fsS -X POST "http://127.0.0.1:${port}/rpc/terminal/create" \
           -H 'content-type: application/json' -d '{"json":{}}' \
         | ${jq} -r '.json.id') || fail "terminal.create RPC errored"
    [ -n "$id" ] && [ "$id" != null ] || fail "terminal.create returned no id"
  '';

  # The survival VM node: a NixOS guest with kolu (via home-manager), alice
  # auto-logged-in and lingering so her user manager — and the kaval
  # `systemd-run --user` transient unit it owns — outlives a `systemctl --user
  # restart kolu`. This is the production survival precondition (the #1031
  # cgroup-v2 lesson the survivable-spawn driver encodes): without linger the
  # daemon dies with the restart and the test silently exercises a FRESH spawn,
  # not adoption. The default KillMode (control-group) is left as-is on purpose —
  # it is exactly the hazard `systemd-run` escapes; do not add one.
  # `nodeExtra` lets the skew test add its contract-bumped kolu-new user service.
  survivalVmNode = nodeExtra: { ... }: {
    imports = [
      home-manager.nixosModules.home-manager
      nixosModule
    ];
    services.getty.autologinUser = "alice";
    users.users.alice.linger = true;
  } // nodeExtra;

  # IMPORTANT — `machinectl shell` does NOT propagate the run command's exit
  # status: it returns 0 once the session opens, whatever the command did. So the
  # seed/verify scripts (run AS alice, for her XDG_RUNTIME_DIR / DBUS / journal)
  # record their verdict in a RESULT FILE, and the testScript asserts that file as
  # ROOT (whose exit status the driver DOES see). Without this, every assertion
  # would be silently ignored and the test could never fail.
  #
  # `runAsAlice script` runs `script` (a path to a writeShellScript) as alice.
  # `</dev/null` is load-bearing — machinectl forwards stdin to the session PTY and
  # the driver's pipe never EOFs, so without it a hung attempt hangs the whole
  # lane; the in-guest `timeout 180` is the belt to that suspender.
  runAsAlice = script:
    ''machine.succeed("timeout 180 machinectl -q shell alice@.host ${script} </dev/null")'';

  # `assertResult file label` asserts (as root) that the alice-written result
  # `file` holds exactly `OK`, printing the file on failure for a readable error.
  assertResult = file: label:
    ''machine.succeed("grep -qx OK ${file} || { echo '${label}:'; cat ${file}; false; }")'';

  # A flag-less systemctl --user run as alice (used for the lifecycle events).
  systemctlUser = args:
    ''machine.succeed("machinectl -q shell alice@.host /run/current-system/sw/bin/systemctl --user ${args} </dev/null")'';

  # Poll until kolu's HTTP listener binds. systemd reports kolu "active" before
  # the port is open; 180s headroom for hosts without KVM (qemu TCG inflates node
  # startup ~10x).
  waitForListener = ''
    machine.wait_until_succeeds(
        "curl --fail --silent http://127.0.0.1:${port}/ > /dev/null",
        timeout=180,
    )
  '';

  # The shared boot-poll prologue: multi-user, then alice's user session, then
  # kolu's HTTP listener.
  bootPoll = ''
    machine.wait_for_unit("multi-user.target")
    machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)
    ${waitForListener}'';
in
{
  inherit jq curl ns gateFile configFile openTerminal;

  # mkAdoptionTest: emit the nixosTest for one adoption outcome. Callers supply
  # their two distinguishing pieces of data:
  #   name          — the nixosTest name.
  #   nodeExtra     — extra node config (skew adds systemd.user.services.kolu-new).
  #   seed          — the writeShellScript seeded on the surviving daemon.
  #   seedResult    — its result-file path + a label for the assertion.
  #   lifecycleSteps — the testScript fragment between seed-assert and verify
  #                    (restart for adopt; stop kolu + start kolu-new for skew).
  #   verify        — the writeShellScript run after the lifecycle event.
  #   verifyResult  — its result-file path.
  mkAdoptionTest =
    { name
    , nodeExtra ? { }
    , seed
    , seedResult
    , lifecycleSteps
    , verify
    , verifyResult
    }:
    pkgs.testers.nixosTest {
      inherit name;
      nodes.machine = survivalVmNode nodeExtra;
      testScript = ''
        ${bootPoll}

        # Seed: open a terminal over the oRPC API on the surviving daemon, then
        # record the survivor's identity for the verify phase. Assert the result
        # file as root (machinectl swallows the script's own exit code).
        ${runAsAlice seed}
        ${assertResult seedResult.file seedResult.label}

        ${lifecycleSteps}

        # Verify: POLL until the outcome holds. Same machinectl-exit caveat →
        # assert the result file as root, printing it.
        ${runAsAlice verify}
        print(machine.succeed(
            "grep -q '^OK' ${verifyResult} && cat ${verifyResult} || { echo 'verify result:'; cat ${verifyResult}; false; }"
        ))
      '';
    };

  # Re-exported so adopt.nix's lifecycle (a plain `systemctl --user restart`) and
  # both tests' boot/listener polls can compose without re-spelling them.
  inherit systemctlUser waitForListener;
}
