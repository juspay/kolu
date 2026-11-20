{ pkgs, kolu, system, port, lib, ... }:
let
  inherit (lib) gateHelpers configFile openTerminal daemonRestart;

  seedResultFile = "/tmp/currency-seed-result";
  verifyResultFile = "/tmp/currency-verify-result";

  overrideStaleKey =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = "currency-test";
    kavalBuildIdOverride = overrideStaleKey;
  }).default;

  seed = pkgs.writeShellScript "kolu-currency-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(currency-seed): $*" > ${seedResultFile}; exit 1; }
    ${gateHelpers}

    ${openTerminal}

    for _ in $(seq 1 30); do
      grep -q "$id" "$HOME/${configFile}" 2>/dev/null && break
      sleep 1
    done
    grep -q "$id" "$HOME/${configFile}" 2>/dev/null \
      || fail "session for $id never saved to disk ($HOME/${configFile})"

    kaval_gate_pid > /tmp/currency-kaval-gate
    [ -s /tmp/currency-kaval-gate ] || fail "could not read kaval gate pid"
    echo "$id" > /tmp/currency-id
    echo OK > ${seedResultFile}
  '';

  verify = pkgs.writeShellScript "kolu-currency-verify" ''
    set -uo pipefail
    ${gateHelpers}
    id=$(cat /tmp/currency-id); oldkaval=$(cat /tmp/currency-kaval-gate)
    want="${overrideStaleKey}"

    newkaval=""; curline=""; crun=""; cexp=""
    for _ in $(seq 1 90); do
      newkaval=$(kaval_gate_pid)
      # broadly (NOT -u kolu). Plain `grep -o` (drains the pipe, prints every match),
      # NOT `grep -q`: under `pipefail`, `-q` exits on the first match and SIGPIPEs
      # journalctl, so the pipeline could report 141 on a real match; `grep -o` reads
      # to EOF, leaving the pipeline status clean. Take the LATEST such line.
      curline=$(journalctl --user --no-pager 2>/dev/null \
                | grep -o 'kaval currency on adopt: running=[0-9a-f]* expected=[0-9a-f]*' | tail -1)
      crun=$(echo "$curline" | sed -n 's/.*running=\([0-9a-f]*\) .*/\1/p')
      cexp=$(echo "$curline" | sed -n 's/.*expected=\([0-9a-f]*\)$/\1/p')
      # (A plain `grep -q` on a FILE — not a pipe — is safe: no producer to SIGPIPE.)
      if [ -n "$newkaval" ] && [ "$newkaval" = "$oldkaval" ] \
         && grep -q "$id" "$HOME/${configFile}" 2>/dev/null \
         && [ -n "$cexp" ] && [ "$cexp" = "$want" ] \
         && [ -n "$crun" ] && [ "$crun" != "$cexp" ]; then
        echo "OK build-skew adopted + update available: kaval gate $oldkaval UNCHANGED (adopted, not recycled); session for $id intact; running=$crun != expected=$cexp (== override)" \
          > ${verifyResultFile}
        exit 0
      fi
      sleep 1
    done
    sessionSeen=no; grep -q "$id" "$HOME/${configFile}" 2>/dev/null && sessionSeen=yes
    {
      echo "FAIL(currency-verify): the build-skewed kaval was not adopted-with-update-available across the padi respawn."
      echo "  kaval gate pid: $oldkaval -> $newkaval (must be UNCHANGED — adopted, not recycled)"
      echo "  session $id in $HOME/${configFile}: $sessionSeen (must be yes)"
      echo "  currency line: [$curline]"
      echo "  expected (must == override $want): [$cexp]"
      echo "  running (must be non-empty and != expected): [$crun]"
    } > ${verifyResultFile}
    exit 1
  '';
in
lib.mkAdoptionTest {
  name = "kolu-adoption-currency";
  inherit seed verify;
  seedResult = { file = seedResultFile; label = "currency-seed"; };
  verifyResult = verifyResultFile;

  nodeExtra = {
    systemd.user.services.kolu-new = {
      description = "kolu (build-bumped) — the newer build for the currency test";
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
