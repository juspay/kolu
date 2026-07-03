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
# UNCHANGED (ADOPTED, not recycled — the inverse of skew.nix) AND the terminal's PTY
# is still live. A regression that recycled the compatible kaval would CHANGE its gate
# → the poll times out red.
#
# ⚠️ DEFERRED — the B3.4 currency NUDGE half (the adopt-time `running != expected`
# breadcrumb) is NOT asserted here, because it is currently UNREACHABLE through padi:
# padi computes `expectedKaval` from its OWN `process.env.KAVAL_BUILD_ID`
# (packages/padi/src/terminalEndpoint/reattach.ts:257 → kaval's `currentBuildId`),
# but padi's nix wrapper bakes no `KAVAL_BUILD_ID` (default.nix `padi` runCommand) and
# the binder's `daemonEnv` (packages/server/src/padiBinding.ts) does not forward it —
# so under systemd-run padi's `expected` is the empty string and the nudge predicate
# (`running != expected`, expected non-empty) can never hold. The nudge is a real
# product gap the cutover opened; restore this assertion once padi carries the
# expected-kaval build id (bake it on padi's wrapper, or forward it in `daemonEnv`).
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
  # UNCHANGED) and the terminal is still live — never a single-shot read. A recycle
  # would CHANGE the kaval gate → the loop times out, writing FAIL.
  verify = pkgs.writeShellScript "kolu-currency-verify" ''
    set -uo pipefail
    ${gateHelpers}
    id=$(cat /tmp/currency-id); oldkaval=$(cat /tmp/currency-kaval-gate)

    newkaval=""
    for _ in $(seq 1 90); do
      newkaval=$(kaval_gate_pid)
      # The surviving kaval must be ADOPTED across kolu-new's padi respawn: its gate
      # pid is UNCHANGED (a recycle would kill+respawn it → new pid) and its session
      # record is still present. (grep without `-q` over the config would be fine
      # here, but a plain `grep -q` on a FILE — not a pipe — is safe: no producer to
      # SIGPIPE. The pipe-SIGPIPE hazard only applies to journalctl|grep chains.)
      if [ -n "$newkaval" ] && [ "$newkaval" = "$oldkaval" ] \
         && grep -q "$id" "$HOME/${configFile}" 2>/dev/null; then
        echo "OK build-skew adopted: kaval gate $oldkaval UNCHANGED (adopted, not recycled) across kolu-new's padi respawn; session for $id intact" \
          > ${verifyResultFile}
        exit 0
      fi
      sleep 1
    done
    sessionSeen=no; grep -q "$id" "$HOME/${configFile}" 2>/dev/null && sessionSeen=yes
    {
      echo "FAIL(currency-verify): the build-skewed kaval was not adopted across the padi respawn."
      echo "  kaval gate pid: $oldkaval -> $newkaval (must be UNCHANGED — adopted, not recycled)"
      echo "  session $id in $HOME/${configFile}: $sessionSeen (must be yes)"
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
        ExecStart = "${koluNew}/bin/kolu --host 127.0.0.1 --port ${port}";
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
