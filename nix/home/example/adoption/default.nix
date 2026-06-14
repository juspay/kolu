# B3.3 — kaval adoption end-to-end (NixOS VM test).
#
# The headline B3.3 promise: terminals survive a kolu-server restart when the
# kaval daemon outlives it. This is the ONE path the Playwright e2e harness can't
# reach — it has no systemd and runs one server per worker, forcing the
# non-survivable detached spawn. A NixOS VM has real systemd, so the production
# `systemd-run --user` survival path (the #1031 cgroup-v2 lesson the
# survivable-spawn driver encodes) actually works here.
#
# What it proves, end to end:
#   1. open a terminal over the oRPC HTTP API (no browser),
#   2. run a command in it whose UNIQUE output we record,
#   3. `systemctl --user restart kolu` (the server only — the kaval transient
#      unit, in its own cgroup, lives),
#   4. the SAME daemon (gate pid), the SAME PTY (id + pid), the command's output
#      in the scrollback, AND kolu's own reconcile all survived → adoption, not a
#      fresh respawn.
#
# Verified on a pu box, and falsified by reverting the boot to always-recycle
# (which makes step 4 time out red — proving the assertions actually bite).
{ pkgs, kolu, home-manager, nixosModule, system }:
let
  kavalTui = "${kolu.packages.${system}.kaval-tui}/bin/kaval-tui";
  jq = "${pkgs.jq}/bin/jq";
  curl = "${pkgs.curl}/bin/curl";

  # A unique marker only WE send into the terminal — a freshly-respawned PTY could
  # never contain it, so its survival in the scrollback is the headline proof of
  # adoption, stronger than a merely-matching pid.
  nonce = "KOLU_ADOPT_PROBE_4Qx9zt";

  # The kolu user service listens here (the module default).
  port = "7681";

  # IMPORTANT — `machinectl shell` does NOT propagate the run command's exit
  # status: it returns 0 once the session opens, whatever the command did. So
  # these scripts (run AS alice, for her XDG_RUNTIME_DIR / DBUS / journal) record
  # their verdict in a RESULT FILE, and the testScript asserts that file as ROOT
  # (whose exit status the driver DOES see). Without this, every assertion would
  # be silently ignored and the test could never fail — the trap the mutation
  # check caught during authoring.

  # Seed: open a terminal, run a command, confirm its output reached the
  # scrollback BEFORE the restart; record the survivor's identity (terminal
  # id+pid, daemon gate pid) for the verify phase. Writes OK / FAIL to
  # /tmp/seed-result.
  seed = pkgs.writeShellScript "kolu-adopt-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(seed): $*" > /tmp/seed-result; exit 1; }
    ns="$XDG_RUNTIME_DIR/kaval-${port}"

    # 1) create a terminal via the app contract's terminal.create RPC.
    id=$(${curl} -fsS -X POST "http://127.0.0.1:${port}/rpc/terminal/create" \
           -H 'content-type: application/json' -d '{"json":{}}' \
         | ${jq} -r '.json.id') || fail "terminal.create RPC errored"
    [ -n "$id" ] && [ "$id" != null ] || fail "terminal.create returned no id"

    # 2) wait for the PTY to go live on the daemon (a real pid in the list).
    pid=""
    for _ in $(seq 1 60); do
      pid=$(${kavalTui} list --json 2>/dev/null \
            | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      [ -n "$pid" ] && [ "$pid" != null ] && [ "$pid" != 0 ] && break
      sleep 1
    done
    [ -n "$pid" ] && [ "$pid" != 0 ] || fail "PTY for $id never went live"

    # 3) run a command whose UNIQUE output we re-check after the restart (\r is
    #    Enter, exactly as the client sends it; jq builds the body so the escaping
    #    is correct).
    body=$(${jq} -nc --arg id "$id" '{json:{id:$id,data:"echo ${nonce}\r"}}')
    ${curl} -fsS -X POST "http://127.0.0.1:${port}/rpc/terminal/sendInput" \
      -H 'content-type: application/json' -d "$body" >/dev/null \
      || fail "terminal.sendInput RPC errored"

    # 4) confirm the output reached the scrollback before we restart.
    seen=""
    for _ in $(seq 1 60); do
      ${kavalTui} snapshot "$id" 2>/dev/null | grep -q "${nonce}" && { seen=1; break; }
      sleep 1
    done
    [ -n "$seen" ] || fail "command output never reached the scrollback pre-restart"

    # 5) record the survivor identity for the verify phase.
    cat "$ns/kaval.pid" > /tmp/adopt-gate || fail "could not read the daemon gate pid"
    echo "$id"  > /tmp/adopt-id
    echo "$pid" > /tmp/adopt-pid
    echo OK > /tmp/seed-result
  '';

  # Verify (after the server restart). POLL until adoption is FULLY confirmed —
  # never a single-shot read, which could pass on a transient mid-recycle state
  # (the race the mutation check exposed). All four must hold at once: the SAME
  # daemon (gate pid unchanged), the SAME PTY (id+pid still listed), its
  # scrollback (the command output), AND kolu's own reconcile log. A recycle
  # changes the gate, drops the PTY, and never logs an adoption — so it can NEVER
  # satisfy these and the loop times out, writing FAIL. Writes OK / FAIL to
  # /tmp/verify-result.
  verify = pkgs.writeShellScript "kolu-adopt-verify" ''
    set -uo pipefail
    ns="$XDG_RUNTIME_DIR/kaval-${port}"
    id=$(cat /tmp/adopt-id); pid=$(cat /tmp/adopt-pid); gate=$(cat /tmp/adopt-gate)

    newgate=""; newpid=""
    for _ in $(seq 1 60); do
      newgate=$(cat "$ns/kaval.pid" 2>/dev/null || echo "")
      newpid=$(${kavalTui} list --json 2>/dev/null \
               | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      if [ "$newgate" = "$gate" ] && [ "$newpid" = "$pid" ] \
         && ${kavalTui} snapshot "$id" 2>/dev/null | grep -q "${nonce}" \
         && journalctl --user -u kolu --no-pager 2>/dev/null \
              | grep -q "adopted surviving terminals after restart"; then
        echo "OK terminal $id (pid $pid) + scrollback (marker ${nonce}) survived; same daemon $gate; kolu reconciled it" \
          > /tmp/verify-result
        exit 0
      fi
      sleep 1
    done
    {
      echo "FAIL(verify): adoption not confirmed within 60s — a recycle, not an adoption."
      echo "  daemon gate pid: $gate -> $newgate (must be unchanged)"
      echo "  pty $id pid: $pid -> [$newpid] (must still be listed)"
      echo "  list: $(${kavalTui} list --json 2>&1 | tr -d '\n' | head -c 300)"
      echo "  adoption logs: $(journalctl --user -u kolu --no-pager 2>/dev/null | grep -c 'adopted surviving' || echo 0)"
    } > /tmp/verify-result
    exit 1
  '';
in
pkgs.testers.nixosTest {
  name = "kolu-adoption";

  nodes.machine = { ... }: {
    imports = [
      home-manager.nixosModules.home-manager
      nixosModule
    ];
    services.getty.autologinUser = "alice";
    # Linger keeps alice's user manager — and the kaval `systemd-run --user`
    # transient unit it owns — running across `systemctl --user restart kolu`.
    # This is the production survival precondition (the #1031 cgroup-v2 lesson the
    # survivable-spawn driver encodes): without it the daemon would die with the
    # restart and the test would silently exercise a FRESH spawn, not adoption.
    # The default KillMode (control-group) is left as-is on purpose — it is
    # exactly the hazard `systemd-run` escapes; do not add one.
    users.users.alice.linger = true;
  };

  testScript = ''
    machine.wait_for_unit("multi-user.target")
    machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)
    # systemd reports kolu "active" before its HTTP listener binds; 180s headroom
    # for hosts without KVM (qemu TCG inflates node startup ~10x).
    machine.wait_until_succeeds(
        "curl --fail --silent http://127.0.0.1:${port}/ > /dev/null",
        timeout=180,
    )

    # Seed: open a terminal over the oRPC API, run a command, confirm its output
    # is in the scrollback. The script runs as alice via machinectl (whose exit
    # code is swallowed), so we assert its result file as root. `</dev/null` is
    # load-bearing — machinectl forwards stdin to the session PTY and the driver's
    # pipe never EOFs.
    machine.succeed("timeout 180 machinectl -q shell alice@.host ${seed} </dev/null")
    machine.succeed("grep -qx OK /tmp/seed-result || { echo 'seed result:'; cat /tmp/seed-result; false; }")

    # Restart ONLY the server. The kaval daemon lives in its own
    # `systemd-run --user` transient cgroup, so it outlives this — the very thing
    # adoption then reattaches to.
    machine.succeed(
        "machinectl -q shell alice@.host /run/current-system/sw/bin/systemctl --user restart kolu </dev/null"
    )
    machine.wait_until_succeeds(
        "curl --fail --silent http://127.0.0.1:${port}/ > /dev/null",
        timeout=180,
    )

    # Verify: the SAME daemon, the SAME PTY, the command's UNIQUE output, and
    # kolu's reconcile all survived — adoption, not a fresh respawn. Same
    # machinectl-exit caveat → assert the result file as root, printing it.
    machine.succeed("timeout 180 machinectl -q shell alice@.host ${verify} </dev/null")
    print(machine.succeed(
        "grep -q '^OK' /tmp/verify-result && cat /tmp/verify-result || { echo 'verify result:'; cat /tmp/verify-result; false; }"
    ))
  '';
}
