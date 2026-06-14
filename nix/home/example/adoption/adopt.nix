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
#
# Only the distinguishing data lives here; lib.nix owns the shared scaffold.
{ pkgs, port, kavalTui, lib, ... }:
let
  inherit (lib) jq curl ns gateFile openTerminal;

  # The OK/FAIL files each script writes and mkAdoptionTest asserts (as root).
  # Declared once so the script's write path and the assertion's read path can
  # never drift apart.
  seedResultFile = "/tmp/seed-result";
  verifyResultFile = "/tmp/verify-result";

  # A unique marker only WE send into the terminal — a freshly-respawned PTY could
  # never contain it, so its survival in the scrollback is the headline proof of
  # adoption, stronger than a merely-matching pid.
  nonce = "KOLU_ADOPT_PROBE_4Qx9zt";

  # Seed: open a terminal, run a command, confirm its output reached the
  # scrollback BEFORE the restart; record the survivor's identity (terminal
  # id+pid, daemon gate pid) for the verify phase. Writes OK / FAIL to
  # /tmp/seed-result.
  seed = pkgs.writeShellScript "kolu-adopt-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(seed): $*" > ${seedResultFile}; exit 1; }
    ns="${ns}"

    # 1) create a terminal via the app contract's terminal.create RPC.
    ${openTerminal}

    # 2) wait for the PTY to go live on the daemon (a real pid in the list).
    pid=""
    for _ in $(seq 1 60); do
      pid=$(${kavalTui} list --json 2>/dev/null \
            | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      [ -n "$pid" ] && [ "$pid" != null ] && [ "$pid" != 0 ] && break
      sleep 1
    done
    # On timeout, dump the last list so a CI failure is diagnosable, not silent.
    [ -n "$pid" ] && [ "$pid" != 0 ] \
      || fail "PTY for $id never went live (last list: $(${kavalTui} list --json 2>&1 | tr -d '\n' | head -c 300))"

    # 3) run a command whose UNIQUE output we re-check after the restart (\r is
    #    Enter, exactly as the client sends it; jq builds the body so the escaping
    #    is correct).
    body=$(${jq} -nc --arg id "$id" '{json:{id:$id,data:"echo ${nonce}\r"}}') \
      || fail "jq failed to build the sendInput request body"
    ${curl} -fsS -X POST "http://127.0.0.1:${port}/rpc/terminal/sendInput" \
      -H 'content-type: application/json' -d "$body" >/dev/null \
      || fail "terminal.sendInput RPC errored"

    # 4) confirm the output reached the scrollback before we restart.
    #    Plain `grep` (output discarded), NOT `grep -q`: under `pipefail`, `-q`
    #    exits on the first match and SIGPIPEs the `snapshot` producer, so the
    #    pipeline can report 141 even on a real match. Plain grep drains the
    #    producer, so the pipeline status is grep's own match/no-match.
    seen=""
    for _ in $(seq 1 60); do
      ${kavalTui} snapshot "$id" 2>/dev/null | grep "${nonce}" >/dev/null && { seen=1; break; }
      sleep 1
    done
    [ -n "$seen" ] || fail "command output never reached the scrollback pre-restart"

    # 5) record the survivor identity for the verify phase.
    cat "$ns/${gateFile}" > /tmp/adopt-gate || fail "could not read the daemon gate pid"
    echo "$id"  > /tmp/adopt-id
    echo "$pid" > /tmp/adopt-pid
    echo OK > ${seedResultFile}
  '';

  # Verify (after the server restart). POLL until adoption is FULLY confirmed —
  # never a single-shot read, which could pass on a transient mid-recycle state
  # (the race the mutation check exposed). All FIVE must hold at once: the SAME
  # daemon (gate pid unchanged), the SAME PTY (id+pid still listed), its
  # scrollback (the command output), kolu's own reconcile log, AND no update
  # pending (B3.4 — running == expected, since this is the same build: the #1034
  # no-op-deploy-no-nudge proof). A recycle changes the gate, drops the PTY, and
  # never logs an adoption — so it can NEVER satisfy these and the loop times out,
  # writing FAIL. Writes OK / FAIL to /tmp/verify-result.
  verify = pkgs.writeShellScript "kolu-adopt-verify" ''
    set -uo pipefail
    ns="${ns}"
    id=$(cat /tmp/adopt-id); pid=$(cat /tmp/adopt-pid); gate=$(cat /tmp/adopt-gate)

    newgate=""; newpid=""; crun=""; cexp=""
    for _ in $(seq 1 60); do
      newgate=$(cat "$ns/${gateFile}" 2>/dev/null || echo "")
      newpid=$(${kavalTui} list --json 2>/dev/null \
               | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      # B3.4 — the no-op-deploy-no-nudge proof (#1034 over-prompting): this restart
      # is the SAME build, so the adopt-time currency log must show running ==
      # expected (the rail stays silent). Same drain-the-pipe `grep -o` for the
      # pipefail/SIGPIPE reason below; parse the last `running=<X> expected=<Y>`.
      curline=$(journalctl --user -u kolu --no-pager 2>/dev/null \
                | grep -o 'kaval currency on adopt: running=[0-9a-f]* expected=[0-9a-f]*' | tail -1)
      crun=$(echo "$curline" | sed -n 's/.*running=\([0-9a-f]*\) .*/\1/p')
      cexp=$(echo "$curline" | sed -n 's/.*expected=\([0-9a-f]*\)$/\1/p')
      # Plain `grep` (output discarded), NOT `grep -q`, in these pipes: under
      # `pipefail`, `-q` exits on the first match and SIGPIPEs the producer, so the
      # pipeline can report 141 on a real match and the poll would never confirm.
      # Plain grep drains the producer, leaving grep's own match/no-match status.
      if [ "$newgate" = "$gate" ] && [ "$newpid" = "$pid" ] \
         && ${kavalTui} snapshot "$id" 2>/dev/null | grep "${nonce}" >/dev/null \
         && journalctl --user -u kolu --no-pager 2>/dev/null \
              | grep "adopted surviving terminals after restart" >/dev/null \
         && [ -n "$crun" ] && [ "$crun" = "$cexp" ]; then
        echo "OK terminal $id (pid $pid) + scrollback (marker ${nonce}) survived; same daemon $gate; kolu reconciled it; no update pending (running=$crun == expected)" \
          > ${verifyResultFile}
        exit 0
      fi
      sleep 1
    done
    {
      echo "FAIL(verify): adoption not confirmed within 60s — a recycle, not an adoption."
      echo "  daemon gate pid: $gate -> $newgate (must be unchanged)"
      echo "  pty $id pid: $pid -> [$newpid] (must still be listed)"
      echo "  currency: running=[$crun] expected=[$cexp] (must be equal — no nudge on a same-build redeploy)"
      echo "  list: $(${kavalTui} list --json 2>&1 | tr -d '\n' | head -c 300)"
      echo "  adoption logs: $(journalctl --user -u kolu --no-pager 2>/dev/null | grep -c 'adopted surviving' || echo 0)"
    } > ${verifyResultFile}
    exit 1
  '';
in
lib.mkAdoptionTest {
  name = "kolu-adoption";
  inherit seed verify;
  seedResult = { file = seedResultFile; label = "seed result"; };
  verifyResult = verifyResultFile;

  # Restart ONLY the server. The kaval daemon lives in its own
  # `systemd-run --user` transient cgroup, so it outlives this — the very thing
  # adoption then reattaches to.
  lifecycleSteps = ''
    ${lib.systemctlUser "restart kolu"}
    ${lib.waitForListener}'';
}
