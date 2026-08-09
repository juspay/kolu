# B3.4 — a BUILD-skewed (but wire-COMPATIBLE) kaval is ADOPTED, not recycled.
# Post-W2.2 cutover.
#
# When a redeploy changes kaval's SOURCE CLOSURE (a new build) but NOT its wire
# contract, the surviving kaval is still compatible — padi's `adoptOrEnsure` ADOPTS
# it (the PTYs survive), the deliberate OPPOSITE of skew.nix's contract-skew recycle.
# Post-cutover this lives at the padi ↔ kaval boundary, reached the same way skew.nix
# reaches it: stop the old server, start the build-bumped `kolu-new` (which ADOPTS the
# surviving old padi), then DRAIN that padi via the frozen control core so kolu-new
# spawns a FRESH padi from its own closure. That padi meets the surviving kaval; the
# wire contract is UNCHANGED, so it ADOPTS the kaval (gate UNCHANGED) rather than
# recycling it — proving a build difference alone never costs the terminals their
# lives, and that kaval outlives a padi replacement.
#
# `KAVAL_BUILD_ID` is a nix-injected value (not a source constant), so the "newer
# kolu" is a second build with `kavalBuildIdOverride` set — the cheap skew (only the
# wrapper `--set` changes; koluNew shares the kolu closure).
#
# Asserts: after the drain respawns kolu-new's padi, the surviving kaval's gate pid is
# UNCHANGED (ADOPTED, not recycled — the inverse of skew.nix), the session record is
# intact, AND the B3.4 currency NUDGE fires — padi's adopt-time breadcrumb `kaval
# currency on adopt: running=<X> expected=<Y>` shows running != expected with expected
# == the override (kolu-new is provably a build AHEAD of the adopted survivor, so the
# rail's "update available" nudge fires). A regression that recycled the compatible
# kaval would CHANGE its gate, and one that lost the build-skew signal would not match
# the override → the poll times out red.
#
# The nudge reads padi's `expectedKaval` (padi's own baked KAVAL_BUILD_ID, via
# packages/padi/src/terminalEndpoint/reattach.ts:257 → kaval's `currentBuildId`)
# against the adopted kaval's REPORTED running staleKey. Padi now CARRIES that expected
# id: its nix wrapper bakes `KAVAL_BUILD_ID` / `KAVAL_COMMIT_HASH` (default.nix `padi`
# runCommand) and the binder's `daemonEnv` forwards them for the from-source/dev path
# (packages/server/src/padiBinding.ts) — the product gap this test earlier DEFERRED,
# fixed in 56e0431a9. The breadcrumb lands in padi's OWN systemd-run --user transient
# unit, so the verify greps `journalctl --user` broadly, NOT `-u kolu`.
# lib.nix owns the shared scaffold; only the distinguishing data lives here.
{ pkgs, kolu, system, port, lib, ... }:
let
  inherit (lib) gateHelpers configFile openTerminal daemonRestart;

  # The OK/FAIL files each script writes and mkAdoptionTest asserts (as root).
  seedResultFile = "/tmp/currency-seed-result";
  verifyResultFile = "/tmp/currency-verify-result";

  # A fixed, obviously-fake 64-char hex staleKey for kolu-new's kaval — distinct
  # from the real source hash the DEFAULT-built old kaval reports, so kolu-new is
  # provably a build AHEAD of the survivor while the wire contract is unchanged (so
  # it ADOPTS, not recycles). Hex so it reads as a real build id.
  overrideStaleKey =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

  # The "newer" kolu: same wire contract, but KAVAL_BUILD_ID forced to the override
  # — so the kaval kolu-new WOULD spawn differs from the surviving default-built one,
  # while the contract is unchanged (so it adopts). Built exactly the way kolu's own
  # flake builds packages.default (kolu's pinned nixpkgs at an explicit `system`) so
  # the ONLY difference from the running (old) kolu is the build id, and so importing
  # default.nix stays pure (its `pkgs` default reaches `builtins.currentSystem`, which
  # flakes ban).
  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = "currency-test";
    kavalBuildIdOverride = overrideStaleKey;
  }).default;

  # Seed: open a terminal on the OLD (default-built) stack and wait until padi's
  # session is SAVED — so kolu-new has a record to reconcile when it adopts. Records
  # the OLD kaval's gate pid + the terminal id (to prove the SAME kaval is adopted).
  seed = pkgs.writeShellScript "kolu-currency-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(currency-seed): $*" > ${seedResultFile}; exit 1; }
    ${gateHelpers}

    ${openTerminal}

    # wait for padi's autosave to persist (so adoption has a saved record).
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

  # Verify (after the build-bumped server boots AND its padi is respawned by the
  # drain). POLL until kolu-new's fresh padi has ADOPTED the surviving kaval (gate
  # UNCHANGED), the session is intact, AND the adopt-time currency breadcrumb shows the
  # build-skew (running != expected, expected == the override) — never a single-shot
  # read. A recycle would CHANGE the kaval gate; a lost build-skew signal would not
  # match the override → the loop times out, writing FAIL.
  verify = pkgs.writeShellScript "kolu-currency-verify" ''
    set -uo pipefail
    ${gateHelpers}
    id=$(cat /tmp/currency-id); oldkaval=$(cat /tmp/currency-kaval-gate)
    want="${overrideStaleKey}"

    newkaval=""; curline=""; crun=""; cexp=""
    for _ in $(seq 1 90); do
      newkaval=$(kaval_gate_pid)
      # The adopt-time currency breadcrumb kolu-new's padi logs when it adopts the
      # surviving kaval: `kaval currency on adopt: running=<X> expected=<Y>`. It lands
      # in padi's OWN systemd-run --user transient unit, so grep `journalctl --user`
      # broadly (NOT -u kolu). Plain `grep -o` (drains the pipe, prints every match),
      # NOT `grep -q`: under `pipefail`, `-q` exits on the first match and SIGPIPEs
      # journalctl, so the pipeline could report 141 on a real match; `grep -o` reads
      # to EOF, leaving the pipeline status clean. Take the LATEST such line.
      curline=$(journalctl --user --no-pager 2>/dev/null \
                | grep -o 'kaval currency on adopt: running=[0-9a-f]* expected=[0-9a-f]*' | tail -1)
      crun=$(echo "$curline" | sed -n 's/.*running=\([0-9a-f]*\) .*/\1/p')
      cexp=$(echo "$curline" | sed -n 's/.*expected=\([0-9a-f]*\)$/\1/p')
      # ADOPT half: the surviving kaval is ADOPTED across kolu-new's padi respawn —
      # gate pid UNCHANGED (a recycle → new pid) and the session record still present.
      # (A plain `grep -q` on a FILE — not a pipe — is safe: no producer to SIGPIPE.)
      # NUDGE half (B3.4): the breadcrumb shows the build-skew — expected == the
      # override (the build-id reached padi's expectedKaval) and running != expected
      # (the adopted survivor is a build behind → "update available" fires).
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

  # The "newer" (build-bumped) kolu, as a manual user service on the SAME port —
  # started only after the old server is stopped, so it ADOPTS the surviving old padi;
  # the drain then respawns kolu-new's own padi, which ADOPTS the compatible kaval.
  nodeExtra = {
    systemd.user.services.kolu-new = {
      description = "kolu (build-bumped) — the newer build for the currency test";
      serviceConfig = {
        ExecStart = "${koluNew}/bin/kolu web --bind 127.0.0.1 --port ${port}";
        Restart = "no";
      };
      # deliberately NOT wantedBy anything — the testScript starts it by hand.
    };
  };

  # Stop the OLD server (padi + kaval survive), start the NEW (build-bumped) server on
  # the SAME port (it ADOPTS the surviving OLD padi), then DRAIN that padi via the
  # frozen control core: kolu-new respawns a FRESH padi that meets the surviving kaval
  # — the wire contract is UNCHANGED (only the build id differs), so it ADOPTS it.
  lifecycleSteps = ''
    ${lib.systemctlUser "stop kolu"}
    ${lib.systemctlUser "start kolu-new"}
    ${lib.waitForListener}
    # Drain the adopted old padi so kolu-new's OWN padi comes up against the surviving
    # kaval and adopts it (compatible wire) — the same reach skew.nix uses to recycle.
    # `wait_until_succeeds` rides out the boot race (kolu-new binds padi asynchronously
    # after its port opens; the drain RPC returns "padi not bound" until it lands).
    machine.wait_until_succeeds("timeout 30 ${daemonRestart}", timeout=120)'';
}
