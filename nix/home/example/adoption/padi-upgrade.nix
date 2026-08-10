# #1670 — a padi-BUILD change on redeploy RESTARTS padi automatically, at the next
# server boot, keeping kaval + its PTYs alive. Post-W2.2 cutover.
#
# The bug (found dogfooding on zest): W2.2's convergence keys on the padiSurface
# CONTRACT version only. A redeploy that changes padi's SOURCE CLOSURE but NOT its
# wire contract (the common case — most padi changes are same-contract) has no
# convergence path: the freshly-booted kolu-server ADOPTS the running OLD-build padi
# and the new padi code silently never takes effect. There is no manual padi-restart
# to fall back on either (the in-app "Restart" recycles kaval, not padi), so short of
# a crash / host reboot / manual ssh kill, the old build runs forever.
#
# The fix (drain-on-build-mismatch, ONCE, at binder boot): when the control-core
# `hello`'s build id differs from the binder's own baked `PADI_BUILD_ID`, the binder
# drains the survivor over the frozen control core (padi persists + exits; its kaval +
# PTYs survive) and spawns its OWN build — the padi gate pid CHANGES, the surviving
# kaval is re-adopted (gate UNCHANGED), the session stays warm.
#
# This arm is the reproduction. UNLIKE currency.nix it does NOT manually drain: the
# AUTOMATIC build-mismatch drain during kolu-new's boot is the thing under test. It
# stops the old server, starts the build-bumped `kolu-new` on the same port, and then
# asserts kolu-new converged the daemon ON ITS OWN.
#
# `PADI_BUILD_ID` is a nix-injected value (not a source constant), so the "newer" kolu
# is a second build with `padiBuildIdOverride` set — the cheap skew (only the wrapper
# `--set` changes; koluNew shares the kolu/padi closures, so the ONLY difference from
# the running old stack is padi's baked build id). This exercises the REAL binder-boot
# path, not a unit shim.
#
# RED on master (no build-axis convergence → kolu-new ADOPTS the old padi → padi gate
# UNCHANGED → the poll times out red). GREEN once the drain-on-build-mismatch policy
# lands (padi gate CHANGES, kaval gate UNCHANGED, session warm, no restore card).
#
# Asserts, all at once, after kolu-new boots:
#   - padi gate pid CHANGED       — the build change drained + respawned padi;
#   - kaval gate pid UNCHANGED    — kaval (and its PTYs) outlived the padi replacement;
#   - the SAME PTY (id + pid)      — the terminal survived, its scrollback nonce intact;
#   - the session record is warm   — the id is still on disk, NO restore card;
#   - NO parked records           — `session-trace park: seeded` count is 0;
#   - the binder's build-change breadcrumb shows the skew — `padi build change on boot:
#     running=<X> expected=<Y>` with expected == the override and running != expected
#     (kolu-new is provably a padi build ahead of the drained survivor).
#
# lib.nix owns the shared scaffold; only the distinguishing data lives here.
{ pkgs, kolu, system, port, kavalTui, lib, ... }:
let
  inherit (lib) jq gateHelpers configFile openTerminal rpc;

  # The OK/FAIL files each script writes and mkAdoptionTest asserts (as root).
  seedResultFile = "/tmp/padi-upgrade-seed-result";
  verifyResultFile = "/tmp/padi-upgrade-verify-result";

  # A unique marker only WE send into the terminal — a freshly-respawned PTY could
  # never contain it, so its survival in the scrollback proves the PTY (in kaval)
  # outlived the padi replacement, not merely a matching pid.
  nonce = "KOLU_PADI_UPGRADE_PROBE_7Vw2mQ";

  # A fixed, obviously-fake 64-char hex build id for kolu-new's padi — distinct from
  # the real source-closure hash the DEFAULT-built old padi reports, so kolu-new is
  # provably a padi build AHEAD of the survivor while the wire contract is unchanged
  # (so the binder DRAINS on the build mismatch, not a contract skew). Hex so it reads
  # as a real staleKey.
  overrideBuildId =
    "facefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeed";

  # The "newer" kolu: same wire contract, but PADI_BUILD_ID forced to the override —
  # so the padi kolu-new WOULD spawn differs from the surviving default-built one,
  # while padiSurface is unchanged (so it converges by DRAINING, not by a contract
  # recycle). Built exactly the way kolu's own flake builds packages.default (kolu's
  # pinned nixpkgs at an explicit `system`) so the ONLY difference from the running
  # (old) kolu is padi's build id, and so importing default.nix stays pure.
  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = "padi-upgrade-test";
    padiBuildIdOverride = overrideBuildId;
  }).default;

  # Seed: open a terminal on the OLD (default-built) stack, run a command whose UNIQUE
  # output we re-check after the redeploy, and wait until padi's session is SAVED — so
  # kolu-new has a record to reconcile. Records the OLD padi + kaval gate pids and the
  # PTY id+pid to prove padi RESTARTED while kaval + the PTY were KEPT.
  seed = pkgs.writeShellScript "kolu-padi-upgrade-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(padi-upgrade-seed): $*" > ${seedResultFile}; exit 1; }
    ${gateHelpers}

    ${openTerminal}

    # wait for the PTY to go live on the daemon (a real pid in the list).
    pid=""
    for _ in $(seq 1 60); do
      pid=$(${kavalTui} list --json 2>/dev/null \
            | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      [ -n "$pid" ] && [ "$pid" != null ] && [ "$pid" != 0 ] && break
      sleep 1
    done
    [ -n "$pid" ] && [ "$pid" != 0 ] \
      || fail "PTY for $id never went live (last list: $(${kavalTui} list --json 2>&1 | tr -d '\n' | head -c 300))"

    # run a command whose UNIQUE output we re-check after the redeploy (\r is Enter;
    # jq builds the body so the escaping is correct). The payload carries `$id`, a
    # RUNTIME value, so it rides the call's trailing positional (adopt.nix note).
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

    # wait for padi's autosave to persist (so the redeploy has a saved record to keep).
    for _ in $(seq 1 30); do
      grep -q "$id" "$HOME/${configFile}" 2>/dev/null && break
      sleep 1
    done
    grep -q "$id" "$HOME/${configFile}" 2>/dev/null \
      || fail "session for $id never saved to disk ($HOME/${configFile})"

    # record the survivors' identity for the verify phase: padi's gate (must CHANGE —
    # padi is drained + respawned) AND kaval's gate (must be UNCHANGED — kaval + PTYs
    # survive beneath the replaced padi).
    padi_gate_pid > /tmp/padi-upgrade-padi-gate
    kaval_gate_pid > /tmp/padi-upgrade-kaval-gate
    [ -s /tmp/padi-upgrade-padi-gate ] || fail "could not read the padi gate pid"
    [ -s /tmp/padi-upgrade-kaval-gate ] || fail "could not read the kaval gate pid"
    echo "$id"  > /tmp/padi-upgrade-id
    echo "$pid" > /tmp/padi-upgrade-pid
    echo OK > ${seedResultFile}
  '';

  # Verify (after the build-bumped server boots and — the behavior under test —
  # AUTOMATICALLY drains the old padi and respawns its own). POLL until every
  # invariant holds at once; never a single-shot read. A regression that ADOPTED the
  # old padi (the master bug) leaves the padi gate UNCHANGED → the loop times out red.
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
      # RESTART half: padi's gate pid CHANGED (drained + respawned) while kaval's gate
      # UNCHANGED (kaval + PTYs kept) and the SAME PTY (id+pid) is still listed with its
      # scrollback nonce. WARM half: the session record is still on disk and NOTHING
      # parked. SKEW half: the breadcrumb shows expected == the override and running !=
      # expected (kolu-new is provably a padi build ahead of the drained survivor).
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

  # The "newer" (padi-build-bumped) kolu, as a manual user service on the SAME port —
  # started only after the old server is stopped, so it dials the surviving OLD padi
  # and (once the fix lands) drains it on the build mismatch, respawning its own padi.
  nodeExtra = {
    systemd.user.services.kolu-new = {
      description = "kolu (padi-build-bumped) — the newer build for the padi-upgrade test";
      serviceConfig = {
        ExecStart = "${koluNew}/bin/kolu web --bind 127.0.0.1 --port ${port}";
        Restart = "no";
      };
      # deliberately NOT wantedBy anything — the testScript starts it by hand.
    };
  };

  # Stop the OLD server (padi + kaval survive), start the NEW (padi-build-bumped)
  # server on the SAME port, and then just wait for its listener. NO manual drain:
  # kolu-new's boot must converge the daemon ON ITS OWN — dial the surviving old padi,
  # notice the build mismatch (hello build id != its baked PADI_BUILD_ID), drain it
  # over the frozen control core, and respawn its own build. That automatic
  # convergence is exactly the behavior this arm exists to prove.
  lifecycleSteps = ''
    ${lib.systemctlUser "stop kolu"}
    ${lib.systemctlUser "start kolu-new"}
    ${lib.waitForListener}'';
}
