{ pkgs, kolu, system, port, kavalTui, lib, ... }:
let
  inherit (lib) jq gateHelpers configFile openTerminal rpc;

  seedResultFile = "/tmp/padi-upgrade-seed-result";
  verifyResultFile = "/tmp/padi-upgrade-verify-result";

  nonce = "KOLU_PADI_UPGRADE_PROBE_7Vw2mQ";

  overrideBuildId =
    "facefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeed";

  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = "padi-upgrade-test";
    padiBuildIdOverride = overrideBuildId;
  }).default;

  seed = pkgs.writeShellScript "kolu-padi-upgrade-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(padi-upgrade-seed): $*" > ${seedResultFile}; exit 1; }
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

    # confirm the output reached the scrollback before the redeploy. Plain `grep`
    # (output discarded), NOT `grep -q`: under `pipefail`, `-q` exits on the first
    # match and SIGPIPEs the `snapshot` producer, so the pipeline can report 141 on a
    # real match. Plain grep drains the producer, leaving grep's own status.
    seen=""
    for _ in $(seq 1 60); do
      ${kavalTui} snapshot "$id" 2>/dev/null | grep "${nonce}" >/dev/null && { seen=1; break; }
      sleep 1
    done
    [ -n "$seen" ] || fail "command output never reached the scrollback pre-redeploy"

    for _ in $(seq 1 30); do
      grep -q "$id" "$HOME/${configFile}" 2>/dev/null && break
      sleep 1
    done
    grep -q "$id" "$HOME/${configFile}" 2>/dev/null \
      || fail "session for $id never saved to disk ($HOME/${configFile})"

    padi_gate_pid > /tmp/padi-upgrade-padi-gate
    kaval_gate_pid > /tmp/padi-upgrade-kaval-gate
    [ -s /tmp/padi-upgrade-padi-gate ] || fail "could not read the padi gate pid"
    [ -s /tmp/padi-upgrade-kaval-gate ] || fail "could not read the kaval gate pid"
    echo "$id"  > /tmp/padi-upgrade-id
    echo "$pid" > /tmp/padi-upgrade-pid
    echo OK > ${seedResultFile}
  '';

  verify = pkgs.writeShellScript "kolu-padi-upgrade-verify" ''
    set -uo pipefail
    ${gateHelpers}
    id=$(cat /tmp/padi-upgrade-id); pid=$(cat /tmp/padi-upgrade-pid)
    oldpadi=$(cat /tmp/padi-upgrade-padi-gate); oldkaval=$(cat /tmp/padi-upgrade-kaval-gate)
    want="${overrideBuildId}"

    newpadi=""; newkaval=""; newpid=""; bcline=""; brun=""; bexp=""; parklogs=""
    for _ in $(seq 1 90); do
      newpadi=$(padi_gate_pid)
      newkaval=$(kaval_gate_pid)
      newpid=$(${kavalTui} list --json 2>/dev/null \
               | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      # The binder's build-change breadcrumb, logged by kolu-new's server process when
      # it drains the build-mismatched survivor: `padi build change on boot: running=<X>
      # expected=<Y>`. Grep `journalctl --user` broadly (the server logs under its own
      # unit, but stay unit-name-agnostic). Plain `grep -o` (drains the pipe, prints
      # every match), NOT `grep -q`: under `pipefail` `-q` SIGPIPEs journalctl. Take the
      # LATEST such line.
      bcline=$(journalctl --user --no-pager 2>/dev/null \
               | grep -o 'padi build change on boot: running=[0-9a-f]* expected=[0-9a-f]*' | tail -1)
      brun=$(echo "$bcline" | sed -n 's/.*running=\([0-9a-f]*\) .*/\1/p')
      bexp=$(echo "$bcline" | sed -n 's/.*expected=\([0-9a-f]*\)$/\1/p')
      # NO restore card: a park breadcrumb (`session-trace park: seeded`) means the
      # session came back cold. `grep -c` returns a COUNT (integer test below); a FILE
      # grep / a count grep is safe under pipefail (no producer to SIGPIPE).
      parklogs=$(journalctl --user --no-pager 2>/dev/null | grep -c "session-trace park: seeded")
      if [ -n "$newpadi" ] && [ -n "$oldpadi" ] && [ "$newpadi" != "$oldpadi" ] \
         && [ -n "$newkaval" ] && [ "$newkaval" = "$oldkaval" ] \
         && [ "$newpid" = "$pid" ] \
         && ${kavalTui} snapshot "$id" 2>/dev/null | grep "${nonce}" >/dev/null \
         && grep -q "$id" "$HOME/${configFile}" 2>/dev/null \
         && [ "$parklogs" -eq 0 ] \
         && [ -n "$bexp" ] && [ "$bexp" = "$want" ] \
         && [ -n "$brun" ] && [ "$brun" != "$bexp" ]; then
        echo "OK padi-build change converged: padi gate $oldpadi -> $newpadi (RESTARTED); kaval gate $oldkaval UNCHANGED (kept); PTY $id (pid $pid) + scrollback (${nonce}) survived; session warm, no restore card; running=$brun != expected=$bexp (== override)" \
          > ${verifyResultFile}
        exit 0
      fi
      sleep 1
    done
    sessionSeen=no; grep -q "$id" "$HOME/${configFile}" 2>/dev/null && sessionSeen=yes
    {
      echo "FAIL(padi-upgrade-verify): the padi-build change did NOT restart padi (kaval-preserving) within 90s."
      echo "  padi gate pid:  $oldpadi -> $newpadi (must CHANGE — a build change drains + respawns padi; UNCHANGED = the #1670 bug: old build adopted)"
      echo "  kaval gate pid: $oldkaval -> $newkaval (must be UNCHANGED — kaval + PTYs survive the padi replacement)"
      echo "  pty $id pid:    $pid -> [$newpid] (must still be listed — same PTY)"
      echo "  session $id in $HOME/${configFile}: $sessionSeen (must be yes — warm)"
      echo "  park logs (session-trace park: seeded): $parklogs (must be 0 — a park is the restore card)"
      echo "  build-change line: [$bcline]"
      echo "  expected (must == override $want): [$bexp]"
      echo "  running (must be non-empty and != expected): [$brun]"
      echo "  list: $(${kavalTui} list --json 2>&1 | tr -d '\n' | head -c 300)"
    } > ${verifyResultFile}
    exit 1
  '';
in
lib.mkAdoptionTest {
  name = "kolu-adoption-padi-upgrade";
  inherit seed verify;
  seedResult = { file = seedResultFile; label = "padi-upgrade-seed"; };
  verifyResult = verifyResultFile;

  nodeExtra = {
    systemd.user.services.kolu-new = {
      description = "kolu (padi-build-bumped) — the newer build for the padi-upgrade test";
      serviceConfig = {
        ExecStart = "${koluNew}/bin/kolu web --bind 127.0.0.1 --port ${port}";
        Restart = "no";
      };
    };
  };

  lifecycleSteps = ''
    ${lib.systemctlUser "stop kolu"}
    ${lib.systemctlUser "start kolu-new"}
    ${lib.waitForListener}'';
}
