# B3.4 — the currency nudge: a BUILD-skewed (but wire-COMPATIBLE) survivor is
# ADOPTED, and the server detects it is a build behind ("update pending").
#
# When a redeploy changes kaval's SOURCE CLOSURE (a new build) but NOT its wire
# contract, the surviving old daemon is still compatible — `adoptOrEnsure` ADOPTS
# it (the terminals survive), the deliberate OPPOSITE of skew.nix's contract-skew
# recycle. But its reported staleKey differs from the kaval the new server would
# spawn, so the rail's read-site `kavalStale` nudge fires ("update pending") and a
# restart would pick up the new build. This is the reachability the nudge needs:
# a build-behind daemon only EXISTS because adoption (B3.3) kept it alive.
#
# There is no env seam for KAVAL_BUILD_ID — it's a nix-injected value — so the
# "newer kolu" is a second build with `kavalBuildIdOverride` set (the nix-value
# analog of skew.nix's `contractVersionOverride`; see the root default.nix). The
# old kolu is the DEFAULT build (real source hash); kolu-new is built with the
# override, so its `expectedKaval.staleKey` differs from the survivor's reported
# staleKey while the wire contract is unchanged → the survivor is adopted, not
# recycled.
#
# Asserts (under kolu-new, after it adopts the survivor): the daemon gate pid is
# UNCHANGED (adopted, NOT recycled — the inverse of skew.nix), AND the adopt-time
# currency log shows `running != expected` with `expected == the override` (so
# the server surfaced the right `expectedKaval`, the build-id reached the server,
# and the build-skew is detected → the nudge fires). A regression that recycled
# the survivor would CHANGE the gate; one that surfaced the wrong expected would
# not match the override → the poll times out red.
#
# The no-op-deploy-no-nudge half (running == expected → silent, the #1034
# over-prompting proof) rides adopt.nix's positive path; only the distinguishing
# data lives here. lib.nix owns the shared scaffold.
{ pkgs, kolu, system, port, lib, ... }:
let
  inherit (lib) ns gateFile configFile openTerminal;

  # The OK/FAIL files each script writes and mkAdoptionTest asserts (as root).
  seedResultFile = "/tmp/currency-seed-result";
  verifyResultFile = "/tmp/currency-verify-result";

  # A fixed, obviously-fake 64-char hex staleKey for kolu-new's kaval — distinct
  # from the real source hash the DEFAULT-built old daemon reports, so the new
  # server is provably a build AHEAD of the survivor (build-skew) while the wire
  # contract is unchanged (so it adopts, not recycles). Hex so the journal grep
  # (`[0-9a-f]*`) matches it.
  overrideStaleKey =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

  # The "newer" kolu: same wire contract, but KAVAL_BUILD_ID forced to the
  # override — so its server's `expectedKaval` (and the kaval it would spawn)
  # differ from the surviving default-built daemon. Built exactly the way kolu's
  # own flake builds packages.default (kolu's pinned nixpkgs at an explicit
  # `system`) so the ONLY difference from the running (old) kolu is the build id,
  # and so importing default.nix stays pure (its `pkgs` default reaches
  # `builtins.currentSystem`, which flakes ban).
  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = "currency-test";
    kavalBuildIdOverride = overrideStaleKey;
  }).default;

  # Seed: open a terminal on the OLD (default-built) daemon and wait until its
  # session is SAVED — so kolu-new has a record to reconcile when it adopts.
  # Records the OLD daemon's gate pid + the terminal id (to prove the SAME daemon
  # is adopted, gate unchanged).
  seed = pkgs.writeShellScript "kolu-currency-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(currency-seed): $*" > ${seedResultFile}; exit 1; }
    ns="${ns}"

    ${openTerminal}

    # wait for the autosave to persist (so adoption has a saved record).
    for _ in $(seq 1 30); do
      grep -q "$id" "$HOME/${configFile}" 2>/dev/null && break
      sleep 1
    done
    grep -q "$id" "$HOME/${configFile}" 2>/dev/null \
      || fail "session for $id never saved to disk"

    cat "$ns/${gateFile}" > /tmp/currency-gate || fail "could not read daemon gate pid"
    echo "$id" > /tmp/currency-id
    echo OK > ${seedResultFile}
  '';

  # Verify (after the build-bumped server boots). POLL until kolu-new has ADOPTED
  # the survivor (gate UNCHANGED) AND its adopt-time currency log shows the
  # build-skew (running != expected, expected == the override) — never a
  # single-shot read. A recycle would CHANGE the gate; a wrong expected would not
  # equal the override → the loop times out, writing FAIL.
  verify = pkgs.writeShellScript "kolu-currency-verify" ''
    set -uo pipefail
    ns="${ns}"
    oldgate=$(cat /tmp/currency-gate)
    want="${overrideStaleKey}"

    newgate=""; line=""; running=""; expected=""
    for _ in $(seq 1 90); do
      newgate=$(cat "$ns/${gateFile}" 2>/dev/null || echo "")
      # The adopt-time currency log under kolu-new: `running=<X> expected=<Y>`.
      # Plain `grep` (drain the pipe, no `-q`) for the pipefail/SIGPIPE reason
      # skew.nix documents; take the last such line.
      line=$(journalctl --user -u kolu-new --no-pager 2>/dev/null \
             | grep -o 'kaval currency on adopt: running=[0-9a-f]* expected=[0-9a-f]*' | tail -1)
      running=$(echo "$line" | sed -n 's/.*running=\([0-9a-f]*\) .*/\1/p')
      expected=$(echo "$line" | sed -n 's/.*expected=\([0-9a-f]*\)$/\1/p')
      if [ -n "$newgate" ] && [ "$newgate" = "$oldgate" ] \
         && [ -n "$running" ] && [ "$expected" = "$want" ] \
         && [ "$running" != "$expected" ]; then
        echo "OK build-skew adopted: gate $oldgate UNCHANGED (adopted, not recycled); update pending — running=$running != expected=$expected (== override)" \
          > ${verifyResultFile}
        exit 0
      fi
      sleep 1
    done
    {
      echo "FAIL(currency-verify): the build-skewed survivor was not adopted-with-update-pending."
      echo "  daemon gate pid: $oldgate -> $newgate (must be UNCHANGED — adopted, not recycled)"
      echo "  currency log line: [$line]"
      echo "  expected (must == override $want): [$expected]"
      echo "  running (must be non-empty and != expected): [$running]"
    } > ${verifyResultFile}
    exit 1
  '';
in
lib.mkAdoptionTest {
  name = "kolu-adoption-currency";
  inherit seed verify;
  seedResult = { file = seedResultFile; label = "currency-seed"; };
  verifyResult = verifyResultFile;

  # The "newer" (build-bumped) kolu, as a manual user service on the SAME port —
  # started only after the old server is stopped, so it inherits the surviving
  # daemon's socket namespace and ADOPTS it (the wire contract is unchanged).
  nodeExtra = {
    systemd.user.services.kolu-new = {
      description = "kolu (build-bumped) — the newer build for the currency test";
      serviceConfig = {
        ExecStart = "${koluNew}/bin/kolu --host 127.0.0.1 --port ${port}";
        Restart = "no";
      };
      # deliberately NOT wantedBy anything — the testScript starts it by hand.
    };
  };

  # Stop the OLD server (its daemon survives in its own transient cgroup), then
  # start the NEW (build-bumped) server on the SAME port: it finds the surviving
  # daemon, the handshake is COMPATIBLE (only the build id differs), so it ADOPTS
  # it — and detects it is a build behind.
  lifecycleSteps = ''
    ${lib.systemctlUser "stop kolu"}
    ${lib.systemctlUser "start kolu-new"}
    ${lib.waitForListener}'';
}
