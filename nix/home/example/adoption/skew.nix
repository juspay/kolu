# B3.3 — the NEGATIVE adoption path: a contract-skewed KAVAL is RECYCLED, not
# adopted, and the session is preserved for restore. Post-W2.2 cutover.
#
# The skew this injects is a `PTY_HOST_CONTRACT_VERSION` bump (via the root
# default.nix `contractVersionOverride` — a `postPatch` sed of the source constant,
# guarded by a grep). That is KAVAL's wire, so post-cutover the skew lives at the
# **padi ↔ kaval** boundary — padi's own `adoptOrEnsure` policy, which RECYCLES an
# incompatible survivor (kill + fresh spawn), the opposite of the kolu-server ↔ padi
# `adopt-or-spawn-or-refuse` policy that never kills a padi. (A kolu-server ↔ padi
# *surface* skew — REFUSE, gate unchanged — is a different axis with no build seam
# yet; see README.)
#
# Reaching that boundary needs care post-cutover: a plain binder swap (stop old kolu,
# start the contract-bumped `kolu-new`) merely ADOPTS the surviving OLD padi — its
# `padiSurface` version is unchanged, so kolu-new connects happily and never touches
# the old kaval. The bumped kaval contract only bites once kolu-new's OWN (contract-9.0)
# padi is the one running. So the lifecycle DRAINS the adopted old padi via the frozen
# control core (`daemon.restart`): the old padi persists its session + exits, and
# kolu-new's reconnect loop spawns a FRESH padi from its own contract-9.0 closure.
# That padi runs its kaval binding, meets the surviving kaval (contract 5.0), the
# handshake skews (`pty-host contract skew`), and it RECYCLES the kaval — kill + a
# fresh contract-9.0 kaval. The PTYs die (the kaval was killed), but padi already
# persisted the session on drain, so a restore is still offered.
#
# Asserts: the KAVAL gate pid CHANGED (recycled, fresh kaval), padi logged the
# pty-host contract skew (in padi's OWN transient unit — grepped via `journalctl
# --user` broadly, NOT `-u kolu-new`, since padi is not a kolu unit), AND the saved
# session still holds the terminal (preserved for restore). A regression that wrongly
# adopted the skewed kaval would leave its gate unchanged → the poll times out red.
#
# Only the distinguishing data lives here; lib.nix owns the shared scaffold.
{ pkgs, kolu, system, port, lib, ... }:
let
  inherit (lib) gateHelpers configFile openTerminal daemonRestart;

  # The OK/FAIL files each script writes and mkAdoptionTest asserts (as root).
  # Declared once so the script's write path and the assertion's read path can
  # never drift apart.
  seedResultFile = "/tmp/skew-seed-result";
  verifyResultFile = "/tmp/skew-verify-result";

  # The "newer" kolu: same source, but its daemon's wire-contract constant is
  # bumped so its padi's kaval binding rejects (and recycles) the older kaval's
  # handshake. Build it exactly the way kolu's own flake builds packages.default —
  # kolu's pinned nixpkgs at an explicit `system` — so the only difference from the
  # running (old) kolu is the contract bump, and so importing default.nix stays pure
  # (its `pkgs` default reaches `builtins.currentSystem`, which flakes ban).
  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = "skew-test";
    contractVersionOverride = "9.0";
  }).default;

  # Seed: open a terminal on the OLD (compatible) stack and wait until padi's
  # session is SAVED to disk — so we can later prove it was PRESERVED across the
  # skew-recycle. Records the OLD kaval's gate pid + the terminal id.
  seed = pkgs.writeShellScript "kolu-skew-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(skew-seed): $*" > ${seedResultFile}; exit 1; }
    ${gateHelpers}

    ${openTerminal}

    # wait for padi's autosave to persist the session (so 'preserved' is meaningful).
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

  # Verify (after the bumped server boots AND the adopted old padi is drained).
  # POLL until the skewed kaval has been cleanly recycled WITH the session preserved
  # — never a single-shot read. A recycle gives a NEW kaval gate pid; padi logs the
  # pty-host contract skew; and the saved session still holds the terminal. A wrong
  # adoption keeps the kaval gate, never logs a skew → times out, writing FAIL.
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
      #
      # padi logs the skew under its OWN `systemd-run --user` transient unit (NOT a
      # kolu unit), so this greps the whole user journal, not `-u kolu-new`.
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

  # The "newer" (contract-bumped) kolu, as a manual user service on the SAME
  # port — started only after the old server is stopped, so it inherits the
  # surviving padi's socket namespace and adopts it (its padiSurface is unchanged);
  # the kaval skew then bites when the drain respawns kolu-new's own padi.
  nodeExtra = {
    systemd.user.services.kolu-new = {
      description = "kolu (contract-bumped) — the newer build for the skew test";
      serviceConfig = {
        ExecStart = "${koluNew}/bin/kolu web --bind 127.0.0.1 --port ${port}";
        Restart = "no";
      };
      # deliberately NOT wantedBy anything — the testScript starts it by hand.
    };
  };

  # Stop the OLD server (padi + kaval survive in their own transient cgroups), start
  # the NEW (contract-bumped) server on the SAME port (it ADOPTS the surviving OLD
  # padi — same digest → same socket — whose padiSurface is unchanged), then DRAIN
  # that padi via the frozen control core: kolu-new respawns a FRESH contract-9.0
  # padi that meets the surviving kaval (contract 5.0), the handshake skews, and it
  # recycles the kaval.
  lifecycleSteps = ''
    ${lib.systemctlUser "stop kolu"}
    ${lib.systemctlUser "start kolu-new"}
    ${lib.waitForListener}
    # Drain the adopted old padi so kolu-new's OWN (contract-9.0) padi comes up
    # against the surviving old kaval — the only no-kill way to reach the skew.
    # `wait_until_succeeds` (not `succeed`) rides out the boot race: kolu-new binds
    # padi asynchronously after its port opens, so the drain RPC returns "padi not
    # bound" until the bind lands — retry until the first drain lands (then it stops).
    machine.wait_until_succeeds("timeout 30 ${daemonRestart}", timeout=120)'';
}
