# B3.3 — kolu-server restart adoption end-to-end (NixOS VM test), post-W2.2 cutover.
#
# The headline B3.3 promise: terminals survive a kolu-server restart. Post-cutover
# the survivor is now TWO daemons — kolu-server binds a separate **padi** process
# (its own `systemd-run --user` transient unit) that owns/supervises **kaval** (a
# further transient unit beneath it). A `systemctl --user restart kolu` restarts the
# BINDER only; padi + kaval live on in their own cgroups. On reboot kolu-server runs
# the `adopt-or-spawn-or-refuse` policy and ADOPTS the surviving padi — never
# respawns it — so padi's registry (and the live PTYs kaval holds) stay warm. This
# is the ONE path the Playwright e2e harness can't reach (no systemd, one server per
# worker → the non-survivable detached spawn); a NixOS VM has real systemd, so the
# production `systemd-run --user` survival path (the #1031 cgroup-v2 lesson) works.
#
# What it proves, end to end:
#   1. open a terminal over the oRPC HTTP API (no browser),
#   2. run a command in it whose UNIQUE output we record,
#   3. `systemctl --user restart kolu` (the server only — padi + kaval live),
#   4. the SAME padi (its gate pid), the SAME kaval (its gate pid), the SAME PTY
#      (id + pid), the command's output in the scrollback, AND kolu-server's own
#      "adopted a surviving daemon" reconcile log all survived → adoption of the
#      running padi, not a fresh respawn.
#
# WHICH gate proves adoption changed at the cutover: pre-W2.2 the "same daemon" was
# kaval, read from `kaval-<port>/kaval.pid`. Now kolu-server adopts PADI, so the
# load-bearing gate is padi's (`padi-<digest>/padi.pid`); kaval's gate is asserted
# UNCHANGED too (kaval never even notices a binder restart). A recycle would change
# padi's gate, drop the PTY, and never log the adoption — so it can never satisfy the
# AND-chain and the poll times out red.
#
# NB: the pre-cutover currency assertion ("kaval currency on adopt: running==expected"
# under `kolu`) is GONE from this path — that line is emitted by PADI at a PADI
# reattach (packages/padi/src/terminalEndpoint/reattach.ts), which does NOT re-run on
# a mere binder restart (padi is adopted, not rebooted). The no-op-deploy-no-nudge
# proof rides the currency VM probe's own padi-reattach, not this one.
#
# Only the distinguishing data lives here; lib.nix owns the shared scaffold.
{ pkgs, kavalTui, lib, ... }:
let
  inherit (lib) jq gateHelpers openTerminal rpc;

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
  # scrollback BEFORE the restart; record the survivors' identity (terminal
  # id+pid, padi gate pid, kaval gate pid) for the verify phase. Writes OK / FAIL
  # to /tmp/seed-result.
  seed = pkgs.writeShellScript "kolu-adopt-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(seed): $*" > ${seedResultFile}; exit 1; }
    ${gateHelpers}

    # 1) create a terminal via the app contract's padiSurface lifecycle.create RPC.
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
    #    is correct). The payload is a RUNTIME value (it carries `$id`), so it is
    #    passed as the call's trailing positional rather than baked into the
    #    `rpc` helper — `kolu-rpc` reads its positionals independently of the flag.
    body=$(${jq} -nc --arg id "$id" '{mapKey:"local",input:{id:$id,data:"echo ${nonce}\r"}}') \
      || fail "jq failed to build the sendInput request body"
    sendErr=$(${rpc { tag = "surface/padi/lifecycle/sendInput"; }} "$body" 2>&1) \
      || fail "lifecycle.sendInput RPC errored: $(printf '%s' "$sendErr" | tr '\n' ' ' | tail -c 400)"

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

    # 5) record the survivors' identity for the verify phase: padi's gate (the
    #    daemon kolu-server adopts) AND kaval's gate (survives untouched beneath it).
    padi_gate_pid > /tmp/adopt-padi-gate
    kaval_gate_pid > /tmp/adopt-kaval-gate
    [ -s /tmp/adopt-padi-gate ] || fail "could not read the padi gate pid"
    [ -s /tmp/adopt-kaval-gate ] || fail "could not read the kaval gate pid"
    echo "$id"  > /tmp/adopt-id
    echo "$pid" > /tmp/adopt-pid
    echo OK > ${seedResultFile}
  '';

  # Verify (after the server restart). POLL until adoption is FULLY confirmed —
  # never a single-shot read, which could pass on a transient mid-recycle state.
  # All FIVE must hold at once: the SAME padi (gate pid unchanged), the SAME kaval
  # (gate pid unchanged), the SAME PTY (id+pid still listed), its scrollback (the
  # command output), AND kolu-server's own "adopted a surviving daemon" log (the
  # binder adopted the running padi). A recycle changes padi's gate, drops the PTY,
  # and never logs the adoption — so it can NEVER satisfy these and the loop times
  # out, writing FAIL. Writes OK / FAIL to /tmp/verify-result.
  verify = pkgs.writeShellScript "kolu-adopt-verify" ''
    set -uo pipefail
    ${gateHelpers}
    id=$(cat /tmp/adopt-id); pid=$(cat /tmp/adopt-pid)
    padigate=$(cat /tmp/adopt-padi-gate); kavalgate=$(cat /tmp/adopt-kaval-gate)

    newpadi=""; newkaval=""; newpid=""
    for _ in $(seq 1 60); do
      newpadi=$(padi_gate_pid)
      newkaval=$(kaval_gate_pid)
      newpid=$(${kavalTui} list --json 2>/dev/null \
               | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      # Plain `grep` (output discarded), NOT `grep -q`, in these pipes: under
      # `pipefail`, `-q` exits on the first match and SIGPIPEs the producer, so the
      # pipeline can report 141 on a real match and the poll would never confirm.
      # Plain grep drains the producer, leaving grep's own match/no-match status.
      # kolu-server logs the padi adoption under its own `kolu` unit
      # (packages/surface-daemon-supervisor/src/endpoint.ts: "adopted a surviving
      # daemon (its PTYs are preserved)").
      if [ "$newpadi" = "$padigate" ] && [ "$newkaval" = "$kavalgate" ] \
         && [ "$newpid" = "$pid" ] \
         && ${kavalTui} snapshot "$id" 2>/dev/null | grep "${nonce}" >/dev/null \
         && journalctl --user -u kolu --no-pager 2>/dev/null \
              | grep "adopted a surviving daemon" >/dev/null; then
        echo "OK terminal $id (pid $pid) + scrollback (marker ${nonce}) survived; same padi $padigate; same kaval $kavalgate; kolu-server adopted the running padi" \
          > ${verifyResultFile}
        exit 0
      fi
      sleep 1
    done
    {
      echo "FAIL(verify): adoption not confirmed within 60s — a recycle, not an adoption."
      echo "  padi gate pid: $padigate -> $newpadi (must be unchanged — kolu-server adopts the running padi)"
      echo "  kaval gate pid: $kavalgate -> $newkaval (must be unchanged — kaval never notices a binder restart)"
      echo "  pty $id pid: $pid -> [$newpid] (must still be listed)"
      echo "  list: $(${kavalTui} list --json 2>&1 | tr -d '\n' | head -c 300)"
      echo "  adoption logs: $(journalctl --user -u kolu --no-pager 2>/dev/null | grep -c 'adopted a surviving daemon' || echo 0)"
    } > ${verifyResultFile}
    exit 1
  '';
in
lib.mkAdoptionTest {
  name = "kolu-adoption";
  inherit seed verify;
  seedResult = { file = seedResultFile; label = "seed result"; };
  verifyResult = verifyResultFile;

  # Restart ONLY the server. padi lives in its own `systemd-run --user` transient
  # cgroup (and kaval in a further one beneath it), so both outlive this — the very
  # thing adoption then reattaches to.
  lifecycleSteps = ''
    ${lib.systemctlUser "restart kolu"}
    ${lib.waitForListener}'';
}
