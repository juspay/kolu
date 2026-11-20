{ pkgs, home-manager, nixosModule, port, kavalTui, koluRpc }:
let
  jq = "${pkgs.jq}/bin/jq";

  # A no-match glob echoes empty (the loop's `[ -f ]` fails on the literal
  # pattern), so an absent daemon reads as "" — never a crash on the glob literal.
  gateHelpers = ''
    padi_gate_pid() {
      local g
      for g in "$XDG_RUNTIME_DIR"/padi-*/padi.pid; do
        [ -f "$g" ] && { cat "$g" 2>/dev/null; return 0; }
      done
      return 0
    }
    kaval_gate_pid() {
      local g
      for g in "$XDG_RUNTIME_DIR"/kaval-*/kaval.pid; do
        [ -f "$g" ] && { cat "$g" 2>/dev/null; return 0; }
      done
      return 0
    }
  '';

  configFile = ".local/state/padi/config.json";

  # `python = true` is for the call sites INLINED into the testScript's Python
  # DOUBLE-quoted `machine.succeed("…")` strings (unlike the seed/verify scripts,
  # which run as alice via machinectl): a literal `"` would close that string early,
  # so the payload's quotes are ESCAPED as `\"`. A nix `''` string passes `\"`
  # through verbatim, Python reads it as an escaped quote, and the shell's OUTER
  # single-quotes keep the `"` literal for the CLI. The RPC surface is
  # unauthenticated loopback (packages/server/src/index.ts), so a root call to
  # 127.0.0.1 reaches alice's server.
  rpc = { tag, payload ? null, timeoutMs ? 30000, python ? false }:
    let
      escaped =
        if python
        then builtins.replaceStrings [ ''"'' ] [ ''\"'' ] payload
        else payload;
      quoted = if payload == null then "" else " '${escaped}'";
    in
    "${koluRpc} http://127.0.0.1:${port} ${tag}${quoted} --timeout-ms ${toString timeoutMs}";

  daemonRestart = rpc { tag = "daemon/restart"; };

  mapCall = { mapKey, input ? null }:
    builtins.toJSON
      ({ inherit mapKey; } // pkgs.lib.optionalAttrs (input != null) { inherit input; });

  openTerminal = ''
    id=""; rpcerr="(no attempt made)"
    for _ in $(seq 1 30); do
      out=$(${rpc { tag = "surface/padi/lifecycle/create"; payload = mapCall { mapKey = "local"; input = { placement = { kind = "toplevel"; }; }; }; }} 2>&1) \
        && id=$(printf '%s' "$out" | ${jq} -r '.id') \
        && [ -n "$id" ] && [ "$id" != null ] && break
      rpcerr=$out; id=""
      sleep 1
    done
    [ -n "$id" ] && [ "$id" != null ] \
      || fail "lifecycle.create never landed in 30 tries; last error: $(printf '%s' "$rpcerr" | tr '\n' ' ' | tail -c 400)"
  '';

  # MEMORY IS PART OF THE FIXTURE, not a tuning knob: nixpkgs' VM default is
  # 1024 MB and these guests boot with `panic_on_oom`, so a guest that runs out
  # does not fail an assertion — the kernel panics, the driver's shell pipe
  # breaks, and the lane reports `BrokenPipeError` from
  # `test_driver/machine/__init__.py` with nothing about kolu in it.
  survivalVmNode = nodeExtra: { ... }: {
    imports = [
      home-manager.nixosModules.home-manager
      nixosModule
      { virtualisation.memorySize = pkgs.lib.mkDefault 4096; }
      nodeExtra
    ];
    services.getty.autologinUser = "alice";
    users.users.alice.linger = true;
  };

  # IMPORTANT — `machinectl shell` does NOT propagate the run command's exit
  # status: it returns 0 once the session opens, whatever the command did. So the
  # seed/verify scripts (run AS alice, for her XDG_RUNTIME_DIR / DBUS / journal)
  # record their verdict in a RESULT FILE, and the testScript asserts that file as
  # ROOT (whose exit status the driver DOES see). Without this, every assertion
  # would be silently ignored and the test could never fail.
  #
  # `</dev/null` is load-bearing — machinectl forwards stdin to the session PTY and
  # the driver's pipe never EOFs, so without it a hung attempt hangs the whole
  # lane; the in-guest `timeout 180` is the belt to that suspender.
  runAsAlice = script:
    ''machine.succeed("timeout 180 machinectl -q shell alice@.host ${script} </dev/null")'';

  assertResult = file: label:
    ''machine.succeed("grep -qx OK ${file} || { echo '${label}:'; cat ${file}; false; }")'';

  systemctlUser = args:
    ''machine.succeed("machinectl -q shell alice@.host /run/current-system/sw/bin/systemctl --user ${args} </dev/null")'';

  listenerBudgetSeconds = 360;

  # Poll until kolu's HTTP listener binds. systemd reports kolu "active" before
  # the port is open.
  waitForListener = ''
    try:
        machine.wait_until_succeeds(
            "curl --fail --silent http://127.0.0.1:${port}/ > /dev/null",
            timeout=${toString listenerBudgetSeconds},
        )
    except Exception:
        machine.log("kolu's HTTP listener never bound — dumping alice's user journal")
        _, journal = machine.execute(
            "journalctl _UID=1000 --no-pager --lines=400 2>&1 || true"
        )
        machine.log(journal)
        _, units = machine.execute(
            "systemctl --user --machine=alice@.host list-units --all --no-pager 2>&1 || true"
        )
        machine.log(units)
        raise
  '';

  bootPoll = ''
    machine.wait_for_unit("multi-user.target")
    machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)
    ${waitForListener}'';
in
{
  inherit jq gateHelpers configFile openTerminal daemonRestart rpc mapCall;

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

        ${runAsAlice seed}
        ${assertResult seedResult.file seedResult.label}

        ${lifecycleSteps}

        ${runAsAlice verify}
        print(machine.succeed(
            "grep -q '^OK' ${verifyResult} && cat ${verifyResult} || { echo 'verify result:'; cat ${verifyResult}; false; }"
        ))
      '';
    };

  inherit systemctlUser waitForListener;

  inherit survivalVmNode runAsAlice assertResult bootPoll;
}
