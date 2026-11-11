# B3.3 — the shared scaffold behind both adoption VM tests.
#
# There is ONE domain concept here: a NixOS-VM adoption probe — boot kolu, seed a
# terminal over kolu's RPC wire on the surviving daemon, do a server lifecycle event
# (restart, or stop+start-a-new-build), then POLL a verify script until an outcome
# holds, asserting via the result-file-as-root pattern. adopt.nix and skew.nix are
# the SAME scaffold with two outcomes; the only differences are their seed/verify
# predicates, the lifecycle steps between them, and (for skew) an extra user
# service. Everything else — the survival VM node, the boot polls, the
# machinectl+result-file run/assert helpers, the jq + wire-call bindings, and the
# "open a terminal over RPC and return its id" prologue — lives here ONCE.
{ pkgs, home-manager, nixosModule, port, kavalTui, koluRpc }:
let
  jq = "${pkgs.jq}/bin/jq";

  # Runtime-layout literals the DAEMONS actually create. These are NOT free
  # choices: each must equal what a running process writes, or the poll just
  # times out and is mis-diagnosed as a recycle/adopt failure. Pinned here, once,
  # to their owning source so a rename has exactly one edit site in the test tree.
  #
  # W2.2 CUTOVER — the rendezvous is DIGEST-KEYED, not per-port. kolu-server no
  # longer talks to kaval directly; it binds a separate **padi** process that
  # owns/supervises kaval. Both daemons name their runtime dir by a digest of
  # padi's state-root (packages/padi/src/stateRoot.ts: `padiDigest`,
  # `padiSocketPath`/`padiGatePath`, `padiKavalSocketPath`), NOT by the listen
  # port. So the legacy `kaval-<port>/kaval.pid` gate is gone; the gates now live
  # at `$XDG_RUNTIME_DIR/padi-<digest>/padi.pid` and `kaval-<digest>/kaval.pid`.
  # There is exactly ONE padi per user (one state-root → one digest) and one kaval
  # beneath it, so the scripts DISCOVER the gates by GLOB rather than recompute the
  # sha256 digest in shell (packages/server/src/padiBinding.ts resolves the same
  # default state-root the module leaves unoverridden — $HOME/.local/state/padi).
  #
  # `gateHelpers` defines two shell functions the seed/verify scripts source:
  #   padi_gate_pid  — echo the surviving padi's gate pid (empty if no padi).
  #   kaval_gate_pid — echo the surviving kaval's gate pid (empty if no kaval).
  # A no-match glob echoes empty (the loop's `[ -f ]` fails on the literal
  # pattern), so an absent daemon reads as "" — never a crash on the glob literal.
  gateHelpers = ''
    # packages/padi/src/stateRoot.ts: padiRuntimeHome → padi-<digest>/padi.pid
    padi_gate_pid() {
      local g
      for g in "$XDG_RUNTIME_DIR"/padi-*/padi.pid; do
        [ -f "$g" ] && { cat "$g" 2>/dev/null; return 0; }
      done
      return 0
    }
    # packages/kaval: resolveDaemonHome({ app: "kaval", instance }) → kaval-<digest>/kaval.pid
    kaval_gate_pid() {
      local g
      for g in "$XDG_RUNTIME_DIR"/kaval-*/kaval.pid; do
        [ -f "$g" ] && { cat "$g" 2>/dev/null; return 0; }
      done
      return 0
    }
  '';

  # padi's persisted session file. Post-cutover padi (NOT kolu-server) owns the
  # saved layout, and it lives under padi's STATE-ROOT, not kolu's config dir:
  # `Conf` with no `configName` → `config.json`, rooted at the default state-root
  # `$HOME/.local/state/padi` (packages/padi/src/stateRoot.ts:66
  # productionPadiStateRoot; the module sets no KOLU_PADI_STATE_DIR override, and
  # padiBinding.test.ts reads exactly this `<stateRoot>/config.json`).
  configFile = ".local/state/padi/config.json";

  # ONE call on kolu-server's own wire, by TAG.
  #
  # These probes used to reach in with `curl -X POST /rpc/<sibling>/<member>/<verb>`
  # — oRPC's second, request/response HTTP arm. The Effect port DELETED that arm (see
  # the note beside the ws upgrade in `packages/server/src/index.ts`): every call now
  # rides the ONE ndjson socket at `/rpc/ws`, carrying flat, tag-keyed messages. So
  # every POST here answered 404, and each site reported it as its own bounded-poll
  # timeout — which is how a dead route read as "no live upstream link after 30s".
  #
  # A shell cannot speak that socket, so the probes call it through `kolu-rpc`
  # (`packages/server/src/wireCall.ts`), which dials the PRODUCT'S OWN link
  # (`websocketLink`, the one the browser dials) over the group the server actually
  # serves. The payload is the same JSON the HTTP arm posted, minus oRPC's `{"json":
  # …}` envelope; the answer prints as JSON on stdout, so the `jq` readers below are
  # unchanged apart from losing their `.json` prefix.
  #
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

  # `daemon/restart` (packages/server/src/router.ts): it DRAINS the bound padi
  # through the frozen control core — padi persists its session and exits, its kaval
  # + PTYs survive, and kolu-server's reconnect loop re-spawns padi from the RUNNING
  # binder's own closure. This is the ONLY no-kill way to make a freshly-built padi
  # meet a surviving older kaval (the skew/currency probes need it — a plain binder
  # swap merely ADOPTS the old padi, leaving its kaval untouched). A root procedure
  # with NO payload, so there is nothing to quote and it needs no `python` escaping.
  daemonRestart = rpc { tag = "daemon/restart"; };

  # "Open a TOP-LEVEL terminal over the app's padiSurface lifecycle.create RPC and
  # return its id" — the application-contract prologue every seed script shares. The
  # `placement` is REQUIRED on that input and has no default (a create must say
  # whether it is a tile of its own or a split of a named parent); a seed wants one
  # independent terminal, so it says `toplevel`. The root
  # `terminal.*` namespace moved onto `padiSurface` in W1.R, served at the wire tag
  # `surface/padi/lifecycle/create`. Sets `id` on success; calls the
  # caller-provided `fail` on any error (so each script keeps its own FAIL-tag and
  # result-file path).
  # RETRY the create until it lands. kolu-server opens its RPC port BEFORE the
  # local host's padi upstream link is live — in the keyed-map world even the
  # LOCAL host rides `reServeSurface`, which fail-fast-throws
  # `"lifecycle.create invoked with no live upstream link"` during that boot
  # window and expects the CLIENT to retry (the ratified fail-fast contract; see
  # reServeSurface.ts's `forwardProcedure`). The real browser client retries; this
  # seed is a one-shot caller, so it must retry too or it races the link-up and reds
  # spuriously. A failed create throws in `forwardProcedure` BEFORE any upstream
  # side effect, so retrying can't double-create — the first success is the only
  # terminal. Bounded so a genuinely-dead link still fails loudly.
  #
  # The LAST attempt's error is kept and quoted in the failure. Without it the poll
  # can only report its own timeout, and every cause — a warming link, a rejected
  # payload, a route that does not exist — reads as the one hypothesis the message
  # happens to name. That is exactly how the retired HTTP arm's 404 spent a CI run
  # claiming there was no live upstream link.
  openTerminal = ''
    id=""; rpcerr="(no attempt made)"
    for _ in $(seq 1 30); do
      out=$(${rpc { tag = "surface/padi/lifecycle/create"; payload = ''{"mapKey":"local","input":{"placement":{"kind":"toplevel"}}}''; }} 2>&1) \
        && id=$(printf '%s' "$out" | ${jq} -r '.id') \
        && [ -n "$id" ] && [ "$id" != null ] && break
      rpcerr=$out; id=""
      sleep 1
    done
    [ -n "$id" ] && [ "$id" != null ] \
      || fail "lifecycle.create never landed in 30 tries; last error: $(printf '%s' "$rpcerr" | tr '\n' ' ' | tail -c 400)"
  '';

  # The survival VM node: a NixOS guest with kolu (via home-manager), alice
  # auto-logged-in and lingering so her user manager — and the **padi**
  # `systemd-run --user` transient unit kolu-server spawns (which in turn owns
  # kaval's own transient unit) — outlives a `systemctl --user restart kolu`. On a
  # server restart kolu-server ADOPTS that surviving padi (padi holds the registry
  # + live PTYs in kaval). This is the production survival precondition (the #1031
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
  # the port is open.
  #
  # THE BUDGET. 180s was derived for a host without KVM (qemu TCG inflates node
  # startup ~10x) on an OTHERWISE IDLE machine — and CI is neither. Measured on a
  # 16-core box against this very check: 41s idle, 166s with 48 spinning
  # processes competing for cores (4x). A CI runner is a smaller box running the
  # whole pipeline in parallel, so it sits past the far end of that range, which
  # is exactly where the budget was blowing. 360s keeps the ~2x margin over the
  # measured contended case that 180s was meant to have over the idle one.
  #
  # Raising it costs a healthy run NOTHING: `wait_until_succeeds` returns the
  # moment curl succeeds, so this number only ever bounds the FAILING case — and
  # in that case the dump below is what makes the extra wait worth having.
  #
  # ON TIMEOUT, DUMP ALICE'S USER JOURNAL. kolu and padi run as `systemd --user`
  # units, whose journal is NOT forwarded to the VM console — so when this poll
  # blew its budget in CI the whole failure was one line ("timed out") over a
  # console that had said nothing since boot, and the run was undiagnosable after
  # the fact. The processes had plenty to say; nobody was reading it. `_UID=1000`
  # is alice's whole user journal read as root, which is the only side whose exit
  # status the driver sees (see the `machinectl` note above).
  #
  # This never changes a passing run, and turns the next failing one into
  # evidence.
  waitForListener = ''
    try:
        machine.wait_until_succeeds(
            "curl --fail --silent http://127.0.0.1:${port}/ > /dev/null",
            timeout=360,
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

  # The shared boot-poll prologue: multi-user, then alice's user session, then
  # kolu's HTTP listener.
  bootPoll = ''
    machine.wait_for_unit("multi-user.target")
    machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)
    ${waitForListener}'';
in
{
  inherit jq gateHelpers configFile openTerminal daemonRestart rpc;

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

  # Re-exported so upgrade.nix (whose flow differs — stand up a legacy port-keyed
  # kaval FIRST, then start kolu) can compose the SAME survival node, alice-run,
  # result-assert, and boot-poll primitives the two `mkAdoptionTest` outcomes use,
  # without re-spelling the machinectl/result-file discipline.
  inherit survivalVmNode runAsAlice assertResult bootPoll;
}
