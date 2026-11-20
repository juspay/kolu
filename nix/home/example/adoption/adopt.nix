{ pkgs, kavalTui, lib, ... }:
let
  inherit (lib) jq gateHelpers openTerminal rpc;

  seedResultFile = "/tmp/seed-result";
  verifyResultFile = "/tmp/verify-result";

  nonce = "KOLU_ADOPT_PROBE_4Qx9zt";

  seed = pkgs.writeShellScript "kolu-adopt-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(seed): $*" > ${seedResultFile}; exit 1; }
    ${gateHelpers}

    ${openTerminal}

    pid=""
    for _ in $(seq 1 60); do
      pid=$(${kavalTui} list --json 2>/dev/null \
            | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      [ -n "$pid" ] && [ "$pid" != null ] && [ "$pid" != 0 ] && break
      sleep 1
    done
    [ -n "$pid" ] && [ "$pid" != 0 ] \
      || fail "PTY for $id never went live (last list: $(${kavalTui} list --json 2>&1 | tr -d '\n' | head -c 300))"

    body=$(${jq} -nc --arg id "$id" '{mapKey:"local",input:{id:$id,data:"echo ${nonce}\r"}}') \
      || fail "jq failed to build the sendInput request body"
    sendErr=$(${rpc { tag = "surface/padi/lifecycle/sendInput"; }} "$body" 2>&1) \
      || fail "lifecycle.sendInput RPC errored: $(printf '%s' "$sendErr" | tr '\n' ' ' | tail -c 400)"

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

    padi_gate_pid > /tmp/adopt-padi-gate
    kaval_gate_pid > /tmp/adopt-kaval-gate
    [ -s /tmp/adopt-padi-gate ] || fail "could not read the padi gate pid"
    [ -s /tmp/adopt-kaval-gate ] || fail "could not read the kaval gate pid"
    echo "$id"  > /tmp/adopt-id
    echo "$pid" > /tmp/adopt-pid
    echo OK > ${seedResultFile}
  '';

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

  lifecycleSteps = ''
    ${lib.systemctlUser "restart kolu"}
    ${lib.waitForListener}'';
}
