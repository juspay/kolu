{ pkgs, kolu, system, port, lib, ... }:
let
  inherit (lib) gateHelpers configFile openTerminal daemonRestart;

  seedResultFile = "/tmp/skew-seed-result";
  verifyResultFile = "/tmp/skew-verify-result";

  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = "skew-test";
    contractVersionOverride = "4242.0";
  }).default;

  seed = pkgs.writeShellScript "kolu-skew-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(skew-seed): $*" > ${seedResultFile}; exit 1; }
    ${gateHelpers}

    ${openTerminal}

    for _ in $(seq 1 30); do
      grep -q "$id" "$HOME/${configFile}" 2>/dev/null && break
      sleep 1
    done
    grep -q "$id" "$HOME/${configFile}" 2>/dev/null \
      || fail "session for $id never saved to disk ($HOME/${configFile})"

    kaval_gate_pid > /tmp/skew-kaval-gate
    [ -s /tmp/skew-kaval-gate ] || fail "could not read kaval gate pid"
    echo "$id" > /tmp/skew-id
    echo OK > ${seedResultFile}
  '';

  verify = pkgs.writeShellScript "kolu-skew-verify" ''
    set -uo pipefail
    ${gateHelpers}
    id=$(cat /tmp/skew-id); oldkaval=$(cat /tmp/skew-kaval-gate)

    newkaval=""
    for _ in $(seq 1 90); do
      newkaval=$(kaval_gate_pid)
      # Boolean conditions, NOT count arithmetic: `grep -c` prints `0` AND exits 1
      # on a miss, so `grep -c ... || echo 0` over a PIPE yields `0\n0` — which a
      # `[ -ge 1 ]` test then chokes on (`integer expected`) on every poll until
      # the condition holds. A plain match-predicate `grep` is the clean test.
      #
      # NB: grep WITHOUT `-q` (output to /dev/null), not `grep -q`: under
      # `pipefail`, `-q` exits on the first match and SIGPIPEs `journalctl`, so the
      # pipeline reports 141 even on a real match and the poll would never succeed.
      # Plain grep drains all of journalctl, so the pipeline status is grep's own
      # match/no-match (0/1) — what we actually want to test here.
      if [ -n "$newkaval" ] && [ "$newkaval" != "$oldkaval" ] \
         && journalctl --user --no-pager 2>/dev/null | grep "pty-host contract skew" >/dev/null \
         && grep -q "$id" "$HOME/${configFile}" 2>/dev/null; then
        echo "OK skew-recycled: kaval gate $oldkaval->$newkaval; pty-host contract skew logged; session for $id preserved" \
          > ${verifyResultFile}
        exit 0
      fi
      sleep 1
    done
    # Final-state recheck for the FAIL diagnostic — same drain-the-pipe `grep`
    # (no `-q`) as the poll above, for the same pipefail/SIGPIPE reason.
    skewSeen=no; journalctl --user --no-pager 2>/dev/null | grep "pty-host contract skew" >/dev/null && skewSeen=yes
    sessionSeen=no; grep -q "$id" "$HOME/${configFile}" 2>/dev/null && sessionSeen=yes
    {
      echo "FAIL(skew-verify): the skewed kaval was not cleanly recycled with the session preserved."
      echo "  kaval gate pid: $oldkaval -> $newkaval (must CHANGE — the survivor is recycled, not adopted)"
      echo "  'pty-host contract skew' logged: $skewSeen (must be yes)"
      echo "  session $id in $HOME/${configFile}: $sessionSeen (must be yes — preserved for restore)"
    } > ${verifyResultFile}
    exit 1
  '';
in
lib.mkAdoptionTest {
  name = "kolu-adoption-skew";
  inherit seed verify;
  seedResult = { file = seedResultFile; label = "skew-seed"; };
  verifyResult = verifyResultFile;

  nodeExtra = {
    systemd.user.services.kolu-new = {
      description = "kolu (contract-bumped) — the newer build for the skew test";
      serviceConfig = {
        ExecStart = "${koluNew}/bin/kolu web --bind 127.0.0.1 --port ${port}";
        Restart = "no";
      };
    };
  };

  lifecycleSteps = ''
    ${lib.systemctlUser "stop kolu"}
    ${lib.systemctlUser "start kolu-new"}
    ${lib.waitForListener}
    machine.wait_until_succeeds("timeout 30 ${daemonRestart}", timeout=120)'';
}
