# W2.2 UPGRADE-migration adoption VM tests — the pre-W2.2 → W2.2 cutover path.
#
# The bug these reproduce: pre-W2.2 kolu-server keyed its kaval by the LISTEN PORT
# (`kaval-<port>/`, a survivable daemon). W2.2 keys by a DIGEST of padi's state-root
# (`kaval-<digest>/`). On the first W2.2 boot the new padi looks only at its
# digest-keyed gate — finds nothing — and SPAWNS A FRESH kaval, LEAKING the running
# pre-W2.2 port-keyed kaval that still holds the live PTYs. The product invariant (the
# adoption promise): PTYs survive a deploy; kaval recycles ONLY on a pty-host CONTRACT
# skew — an upgrade is just another deploy. So a W2.2 padi must ADOPT the surviving
# port-keyed kaval, not leak it — and the legacy keying must retire (converge to
# digest) AND be BOUNDED (a host reboot wipes any residue for good).
#
# The flow INVERTS the other adoption tests': instead of letting kolu auto-start and
# seeding a terminal through it, each test stands up a LEGACY port-keyed kaval (a live
# marker PTY + a long-running fake "agent") and the matching pre-W2.2 `config.json`
# FIRST — the exact pre-upgrade world — and only THEN starts W2.2 kolu (the "upgrade"
# moment; auto-start is cleared in `nodeExtra`).
#
# TWO checks (both from ARM 1's adopted state, via DISTINCT destructive paths that
# can't share one VM):
#   `adoption-upgrade`        — ARM 1 (adopt-on-upgrade) then ARM 2 (convergence): a
#     Restart-kaval recycle respawns DIGEST-keyed and retires the legacy port ref.
#   `adoption-upgrade-reboot` — ARM 1 (adopt-on-upgrade) then ARM 3 (reboot bound): a
#     host reboot proves the legacy residue is MORTAL — kaval holds PTY fds + its gate
#     lives in boot-wiped `$XDG_RUNTIME_DIR` tmpfs, so the reboot kills the process and
#     wipes the gate; padi then finds NO legacy survivor and spawns DIGEST-keyed, and
#     the saved session (persisted on padi's state-root, which a real host keeps across
#     a reboot) takes the CORRECT degraded-restore path (parked, not adopted).
#
# Only the distinguishing data lives here; lib.nix owns the shared scaffold.
{ pkgs, port, kavalTui, kavalBin, lib, ... }:
let
  inherit (lib)
    jq rpc survivalVmNode runAsAlice assertResult systemctlUser waitForListener;
  pkgsLib = pkgs.lib;

  seedResultFile = "/tmp/upgrade-seed-result";
  adoptResultFile = "/tmp/upgrade-adopt-result";
  convergeResultFile = "/tmp/upgrade-converge-result";
  rebootResultFile = "/tmp/upgrade-reboot-result";

  # Where the legacy (pre-W2.2) kolu-server config lived — the one-shot import source.
  # kolu-server forwards `$KOLU_STATE_DIR` to padi (`padiBinding.ts` `daemonEnv`), and
  # padi's `importLegacyConfigOnce` reads `<dir>/config.json` (packages/padi/src/
  # importLegacy.ts). Set on the kolu service below so the saved session — whose active
  # terminal id MATCHES the port kaval's live PTY — carries across on the first boot.
  legacyStateDir = "/home/alice/.config/kolu";

  # padi's default state-root persisted session file (where the adopted+converged
  # session is saved). On the reboot check this sits on a PERSISTENT disk so it survives
  # the reboot — the "session restores" half of the bounded-migration theorem.
  padiStateConf = "/home/alice/.local/state/padi/config.json";

  # A unique marker only WE send into the terminal — a freshly-respawned PTY could
  # never contain it, so its survival in the port kaval's scrollback is proof the PTY
  # was ADOPTED, not re-spawned.
  nonce = "KOLU_UPGRADE_PROBE_7Kp2wz";

  # Shared shell helpers: the port-keyed (legacy) vs digest-keyed (W2.2) kaval layout.
  # `$XDG_RUNTIME_DIR` is a SHELL var (no `{}` → NOT nix-interpolated); `${port}` IS
  # nix (→ the listen port). A DIGEST kaval is any `kaval-*` dir that is NOT the port
  # one — its `kaval.pid` is the "padi spawned a fresh kaval-<digest>" signal.
  layout = ''
    PORT_DIR="$XDG_RUNTIME_DIR/kaval-${port}"
    PORT_SOCK="$PORT_DIR/pty-host.sock"
    PORT_GATE="$PORT_DIR/kaval.pid"

    # The legacy port kaval's gate-holder pid (empty if absent — no crash on the glob).
    port_gate_pid() { [ -f "$PORT_GATE" ] && cat "$PORT_GATE" 2>/dev/null; return 0; }

    # Every DIGEST-keyed kaval gate path — a `kaval-*/kaval.pid` whose dir is NOT the
    # port one. Non-empty ⇒ padi spawned a fresh kaval-<digest>. A no-match glob is
    # skipped by the `[ -f ]` guard, so an absent daemon prints nothing.
    digest_kaval_gates() {
      local g
      for g in "$XDG_RUNTIME_DIR"/kaval-*/kaval.pid; do
        [ -f "$g" ] || continue
        [ "$g" = "$PORT_GATE" ] && continue
        echo "$g"
      done
    }
  '';

  # SEED (as alice, BEFORE kolu ever runs): stand up a pre-W2.2 PORT-keyed kaval
  # holding a LIVE marker PTY + a long-running fake "agent", and drop the matching
  # legacy `config.json` — the exact pre-upgrade world a W2.2 boot must ADOPT.
  seed = pkgs.writeShellScript "kolu-upgrade-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(seed): $*" > ${seedResultFile}; exit 1; }
    ${layout}

    # 1) Stand up the LEGACY port-keyed kaval as a transient user unit, so it OUTLIVES
    #    this seed shell and is independent of kolu — the survivable pre-W2.2 daemon
    #    (production spawned kaval under `systemd-run --user` too). `--socket` pins the
    #    port-keyed rendezvous; the gate/rc dirs are its siblings (daemonMain.ts).
    systemd-run --user --unit=legacy-kaval \
      --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" --setenv=HOME="$HOME" \
      ${kavalBin} --socket "$PORT_SOCK" >/dev/null 2>&1 \
      || fail "systemd-run of the legacy port kaval failed"
    for _ in $(seq 1 60); do [ -S "$PORT_SOCK" ] && [ -f "$PORT_GATE" ] && break; sleep 1; done
    [ -S "$PORT_SOCK" ] || fail "legacy kaval socket never came up at $PORT_SOCK"

    # 2) Create a shell PTY (the client mints a UUID id) and capture its id + pid.
    out=$(${kavalTui} create --socket "$PORT_SOCK" --json 2>/dev/null) \
      || fail "kaval-tui create failed"
    id=$(printf '%s' "$out" | ${jq} -r '.id')
    pid=$(printf '%s' "$out" | ${jq} -r '.pid')
    { [ -n "$id" ] && [ "$id" != null ]; } || fail "create returned no id (out: $out)"

    # 3) Drop the marker into the scrollback (\r via a separate --key Enter, exactly as
    #    the client sends it), then launch a long-running fake "agent" so the PTY has a
    #    live foreground process to preserve. Plain `grep` (NOT `grep -q`) under
    #    `pipefail`: `-q` SIGPIPEs the snapshot producer on first match → a spurious 141.
    ${kavalTui} send --socket "$PORT_SOCK" "$id" 'echo ${nonce}' >/dev/null || fail "send echo failed"
    ${kavalTui} send --socket "$PORT_SOCK" "$id" --key Enter >/dev/null || fail "send Enter failed"
    seen=""
    for _ in $(seq 1 60); do
      ${kavalTui} snapshot --socket "$PORT_SOCK" "$id" 2>/dev/null | grep "${nonce}" >/dev/null && { seen=1; break; }
      sleep 1
    done
    [ -n "$seen" ] || fail "marker never reached the legacy kaval scrollback"
    ${kavalTui} send --socket "$PORT_SOCK" "$id" 'sleep 100000' >/dev/null || fail "send fake-agent failed"
    ${kavalTui} send --socket "$PORT_SOCK" "$id" --key Enter >/dev/null || fail "send Enter (agent) failed"

    # 4) The pre-W2.2 legacy config.json — a saved session whose ONE active terminal's
    #    id MATCHES the live port-kaval PTY, so padi's boot reconcile ADOPTS the record
    #    onto the live PTY (the import+adopt marriage → NO restore card), never PARKS
    #    it. A current-schema SavedSession blob (importLegacyConfigOnce seeds it verbatim
    #    — kolu-server's ladder already migrated it): active arm = persisted snapshot
    #    (cwd/git/pr) + authored (location + memory) + state + id.
    mkdir -p ${legacyStateDir}
    ${jq} -nc --arg id "$id" \
      '{session:{terminals:[{id:$id,state:"active",location:{kind:"local"},cwd:"/home/alice",git:null,pr:{kind:"absent"},lastActivityAt:0}],activeTerminalId:$id,savedAt:1700000000000}}' \
      > ${legacyStateDir}/config.json || fail "writing the legacy config.json failed"

    # 5) Record the survivors for the verify phases (on /tmp — fine for arms 1/2; ARM 3's
    #    verify reads padi's state-root + journal instead, since /tmp is boot-wiped).
    echo "$id"  > /tmp/upgrade-id
    echo "$pid" > /tmp/upgrade-pid
    port_gate_pid > /tmp/upgrade-port-gate
    [ -s /tmp/upgrade-port-gate ] || fail "could not read the legacy port kaval gate pid"
    echo OK > ${seedResultFile}
  '';

  # VERIFY ARM 1 (adopt-on-upgrade). POLL until adoption is FULLY confirmed — never a
  # single-shot read (which could pass on a transient mid-boot state). ALL must hold at
  # once: NO fresh kaval-<digest> daemon, the port gate pid UNCHANGED (same process
  # adopted, not respawned), the marker PTY (id+pid) ALIVE in the port kaval with the
  # marker in its scrollback, padi's OWN "adopted a surviving daemon" log, and NO park
  # (no restore card). Current code spawns a fresh digest daemon and parks → it can
  # satisfy neither the digest nor the adopt/park conditions and times out RED.
  verifyAdopt = pkgs.writeShellScript "kolu-upgrade-verify-adopt" ''
    set -uo pipefail
    ${layout}
    id=$(cat /tmp/upgrade-id); pid=$(cat /tmp/upgrade-pid)
    portgate=$(cat /tmp/upgrade-port-gate)

    livepid=""; newportgate=""; digests=""
    for _ in $(seq 1 60); do
      newportgate=$(port_gate_pid)
      digests=$(digest_kaval_gates)
      livepid=$(${kavalTui} list --socket "$PORT_SOCK" --json 2>/dev/null \
                | ${jq} -r --arg id "$id" '.[] | select(.id==$id) | .pid' 2>/dev/null || echo "")
      # padi logs the kaval adoption in its OWN transient unit (the spine's "adopted a
      # surviving daemon (its PTYs are preserved)"), and a no-survivor boot logs
      # "session-trace park: seeded N parked" (the restore card). Read broadly with
      # `journalctl --user` (padi is NOT the `kolu` unit — currency.nix note).
      adoptlogs=$(journalctl --user --no-pager 2>/dev/null | grep -c "adopted a surviving daemon")
      parklogs=$(journalctl --user --no-pager 2>/dev/null | grep -c "session-trace park: seeded")
      if [ -z "$digests" ] \
         && [ "$newportgate" = "$portgate" ] \
         && [ "$livepid" = "$pid" ] \
         && ${kavalTui} snapshot --socket "$PORT_SOCK" "$id" 2>/dev/null | grep "${nonce}" >/dev/null \
         && [ "$adoptlogs" -ge 1 ] \
         && [ "$parklogs" -eq 0 ]; then
        echo "OK adopted the legacy port kaval: marker PTY $id (pid $pid, marker ${nonce}) survived in kaval-${port}; port gate $portgate unchanged; NO kaval-<digest> spawned; padi adopted; NO restore card (imported record reconciled onto the live PTY)" \
          > ${adoptResultFile}
        exit 0
      fi
      sleep 1
    done
    {
      echo "FAIL(adopt): the legacy port kaval was NOT adopted within the poll — a leak-spawn, not an adoption."
      echo "  fresh kaval-<digest> gates: [$(digest_kaval_gates | tr '\n' ' ')] (must be EMPTY)"
      echo "  port gate pid: $portgate -> [$newportgate] (must be unchanged — same process adopted)"
      echo "  marker PTY $id pid: $pid -> [$livepid] (must still be listed in the port kaval)"
      echo "  adoption logs: $(journalctl --user --no-pager 2>/dev/null | grep -c 'adopted a surviving daemon') (must be >= 1)"
      echo "  park logs: $(journalctl --user --no-pager 2>/dev/null | grep -c 'session-trace park: seeded') (must be 0 — a park is the restore card)"
      echo "  kaval dirs: $(ls -d "$XDG_RUNTIME_DIR"/kaval-* 2>/dev/null | tr '\n' ' ')"
    } > ${adoptResultFile}
    exit 1
  '';

  # VERIFY ARM 2 (convergence). After the Restart-kaval recycle the respawn is
  # DIGEST-keyed (a kaval-<digest> daemon now exists) AND the legacy port ref is GONE
  # (its socket no longer accepts a dial) — the bounded migration completes and the
  # legacy keying is retired for good.
  verifyConverge = pkgs.writeShellScript "kolu-upgrade-verify-converge" ''
    set -uo pipefail
    ${layout}
    digests=""
    for _ in $(seq 1 60); do
      digests=$(digest_kaval_gates)
      if [ -n "$digests" ] && ! timeout 5 ${kavalTui} list --socket "$PORT_SOCK" >/dev/null 2>&1; then
        echo "OK converged: kaval respawned DIGEST-keyed [$(echo $digests | tr '\n' ' ')]; the legacy port kaval (kaval-${port}) is gone" \
          > ${convergeResultFile}
        exit 0
      fi
      sleep 1
    done
    {
      echo "FAIL(converge): the recycle did not converge to a digest-keyed kaval with the legacy ref gone."
      echo "  digest gates: [$(digest_kaval_gates | tr '\n' ' ')] (must be non-empty)"
      echo "  port kaval still dial-able: $(timeout 5 ${kavalTui} list --socket "$PORT_SOCK" >/dev/null 2>&1 && echo YES || echo no) (must be no)"
      echo "  kaval dirs: $(ls -d "$XDG_RUNTIME_DIR"/kaval-* 2>/dev/null | tr '\n' ' ')"
    } > ${convergeResultFile}
    exit 1
  '';

  # VERIFY ARM 3 (reboot bound). After a HOST REBOOT (from ARM 1's adopted-legacy
  # state): the legacy port kaval residue is MORTAL — its process died and its
  # gate/socket (in `$XDG_RUNTIME_DIR` tmpfs) was boot-wiped — so padi finds NO legacy
  # survivor and spawns DIGEST-keyed; AND the saved session (persisted on padi's
  # state-root, which SURVIVES the reboot) takes the CORRECT degraded-restore path
  # (padi PARKS it — nothing live to adopt), and a restore brings the marker record
  # back as a live terminal in the fresh digest kaval.
  verifyReboot = pkgs.writeShellScript "kolu-upgrade-verify-reboot" ''
    set -uo pipefail
    ${layout}
    restored=""
    for _ in $(seq 1 60); do
      digests=$(digest_kaval_gates)
      parklogs=$(journalctl --user --no-pager 2>/dev/null | grep -c "session-trace park: seeded")
      saved_n=$(${jq} '.session.terminals | length' ${padiStateConf} 2>/dev/null || echo 0)
      # (a) a DIGEST kaval is up AND the legacy PORT residue is GONE (gate absent — tmpfs
      #     wiped — and no process answers its socket). (b) padi PARKED the SURVIVED saved
      #     session (degraded restore — nothing live to adopt), and it still holds the record.
      if [ -n "$digests" ] && [ ! -e "$PORT_GATE" ] \
         && ! timeout 5 ${kavalTui} list --socket "$PORT_SOCK" >/dev/null 2>&1 \
         && [ "$parklogs" -ge 1 ] && [ "$saved_n" -ge 1 ]; then
        # Drive the restore: the marker RECORD comes back as a live terminal (a NEW PTY —
        # the old one died in the reboot) in the fresh digest kaval.
        ${rpc {
          tag = "surface/padi/session/restore";
          payload = ''{"mapKey":"local","input":{}}'';
          timeoutMs = 60000;
        }} >/dev/null || { sleep 1; continue; }
        DIGEST_SOCK=$(ls -d "$XDG_RUNTIME_DIR"/kaval-*/pty-host.sock 2>/dev/null | grep -v "/kaval-${port}/" | head -1)
        live_n=$(${kavalTui} list --socket "$DIGEST_SOCK" --json 2>/dev/null | ${jq} 'length' 2>/dev/null || echo 0)
        if [ "$live_n" -ge 1 ]; then restored=1; break; fi
      fi
      sleep 1
    done
    [ -n "$restored" ] && {
      echo "OK reboot-bounded: NO legacy kaval-${port} residue survived (its gate/socket in tmpfs was boot-wiped + its process died); padi spawned DIGEST-keyed [$(digest_kaval_gates | tr '\n' ' ')]; the saved session survived on the persistent state-root and took the DEGRADED restore path (PARKED, not adopted — the live kaval genuinely died); restore brought the marker record back as a live terminal in the fresh digest kaval" \
        > ${rebootResultFile}
      exit 0
    }
    {
      echo "FAIL(reboot): the reboot did not leave a clean digest-keyed + degraded-restore state."
      echo "  digest gates: [$(digest_kaval_gates | tr '\n' ' ')] (must be non-empty — padi spawned digest)"
      echo "  legacy port gate $PORT_GATE exists: $([ -e "$PORT_GATE" ] && echo YES || echo no) (must be no — tmpfs boot-wiped)"
      echo "  port kaval dial-able: $(timeout 5 ${kavalTui} list --socket "$PORT_SOCK" >/dev/null 2>&1 && echo YES || echo no) (must be no — process died)"
      echo "  park logs: $(journalctl --user --no-pager 2>/dev/null | grep -c 'session-trace park: seeded') (must be >=1 — the degraded restore path)"
      echo "  saved terminals on the state-root: $(${jq} '.session.terminals | length' ${padiStateConf} 2>/dev/null || echo unreadable) (must be >=1 — the session survived the reboot)"
      echo "  kaval dirs: $(ls -d "$XDG_RUNTIME_DIR"/kaval-* 2>/dev/null | tr '\n' ' ')"
    } > ${rebootResultFile}
    exit 1
  '';

  # The Restart-kaval RPC (`padiSurface.procedures.lifecycle.recycleKaval`, now served
  # through the padi host MAP): capture → drain → recycle (kill the adopted kaval + spawn
  # fresh, DIGEST-keyed) → park. `recycleKaval` itself takes NO input, but W4 folds every
  # entry-member input into the map envelope `{ mapKey, input }`, so the wire input is now
  # the NON-void object `{ mapKey: "local" }` — the `input` field stays ABSENT (the fold
  # preserves recycleKaval's own void input, which accepts a missing field); the pre-map
  # bare `{}` fails the map's `{ mapKey, input }` parse. Single-host VM ⇒ mapKey is always
  # LOCAL_HOST "local". Unlike the shell-context calls (openTerminal / session.restore),
  # recycleKaval is inlined DIRECTLY into the Python testScript
  # (`wait_until_succeeds("… ${recycleKaval} …")`), so `python = true` — see lib.nix's
  # `rpc` for why the payload's quotes must be `\"`-escaped there.
  recycleKaval = rpc {
    tag = "surface/padi/lifecycle/recycleKaval";
    payload = ''{"mapKey":"local"}'';
    timeoutMs = 90000;
    python = true;
  };

  # The kolu service overrides both checks share: do NOT auto-start (the seed stands up
  # the LEGACY port kaval FIRST, then the testScript starts kolu by hand — the "upgrade"
  # moment; clearing WantedBy keeps the unit INSTALLED but off the boot path, the same
  # manual-start precedent skew.nix's kolu-new service sets), and point kolu-server at
  # the legacy config dir so it forwards `$KOLU_STATE_DIR` to padi (the one-shot import).
  koluServiceOverride = {
    Install.WantedBy = pkgsLib.mkForce [ ];
    Service.Environment = [ "KOLU_STATE_DIR=${legacyStateDir}" ];
  };

  # The shared prologue both checks run: boot, seed the pre-W2.2 world, start W2.2 kolu,
  # and confirm ARM 1 (padi adopted the legacy port kaval) — the adopted state both
  # arms 2 and 3 then take their DISTINCT destructive path from.
  bootThenAdopt = ''
    machine.wait_for_unit("multi-user.target")
    machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)

    # Seed the pre-W2.2 world: a live PORT-keyed kaval + matching legacy config, BEFORE
    # kolu ever runs. Assert the result file as root (machinectl swallows exit codes).
    ${runAsAlice seed}
    ${assertResult seedResultFile "upgrade seed"}

    # THE UPGRADE: start the W2.2 kolu-server. It binds padi, which must ADOPT the
    # surviving legacy port kaval — not spawn a fresh kaval-<digest> and leak it.
    ${systemctlUser "start kolu"}
    ${waitForListener}

    # ARM 1 — adopt-on-upgrade (RED on current code). POLL, then assert as root.
    ${runAsAlice verifyAdopt}
    print(machine.succeed(
        "grep -q '^OK' ${adoptResultFile} && cat ${adoptResultFile} || { echo 'adopt result:'; cat ${adoptResultFile}; false; }"
    ))'';
in
{
  # CHECK A — arms 1 + 2 (adopt then recycle-convergence). A tmpfs root (fast) is fine:
  # nothing here needs state to survive a reboot.
  adoption-upgrade = pkgs.testers.nixosTest {
    name = "kolu-adoption-upgrade";
    nodes.machine = survivalVmNode {
      home-manager.users.alice.systemd.user.services.kolu = koluServiceOverride;
    };
    testScript = ''
      ${bootThenAdopt}

      # ARM 2 — convergence: a Restart-kaval recycle respawns DIGEST-keyed and retires the
      # legacy port ref (the bounded migration). `wait_until_succeeds` rides out the boot
      # race; the recycle blocks until the fresh kaval connects.
      machine.wait_until_succeeds("timeout 90 ${recycleKaval}", timeout=180)
      ${runAsAlice verifyConverge}
      print(machine.succeed(
          "grep -q '^OK' ${convergeResultFile} && cat ${convergeResultFile} || { echo 'converge result:'; cat ${convergeResultFile}; false; }"
      ))
    '';
  };

  # CHECK B — ARM 3 (reboot bound). This one needs padi's state-root to SURVIVE the
  # reboot (the "session restores" half) while `$XDG_RUNTIME_DIR` (/run/user, ALWAYS
  # tmpfs) is boot-wiped (the "residue is mortal" half — the theorem). The suite's
  # tmpfs ROOT would wipe the state-root too, so give THIS node a PERSISTENT qcow2 root
  # that outlives a shutdown+start. `virtualisation.fileSystems` is applied with
  # mkVMOverride (qemu-vm.nix), so it cleanly overrides the shared tmpfs root; the root
  # disk image is created once and re-attached on start, so /home persists.
  adoption-upgrade-reboot = pkgs.testers.nixosTest {
    name = "kolu-adoption-upgrade-reboot";
    nodes.machine = survivalVmNode {
      home-manager.users.alice.systemd.user.services.kolu = koluServiceOverride;
      virtualisation.diskImage = "./kolu-adopt-reboot.qcow2";
      virtualisation.fileSystems."/" = pkgsLib.mkForce {
        device = "/dev/vda";
        fsType = "ext4";
        autoFormat = true;
      };
    };
    testScript = ''
      ${bootThenAdopt}

      # ARM 3 — reboot bound. REBOOT the host (shutdown + start): kaval is mortal — its
      # process dies and its gate/socket in `$XDG_RUNTIME_DIR` tmpfs is boot-wiped —
      # while padi's state-root (persistent /home) survives. `machine.shutdown()` powers
      # the guest off; `machine.start()` re-launches it on the SAME persistent root disk
      # with a FRESH tmpfs `/run`.
      machine.shutdown()
      machine.start()
      machine.wait_for_unit("multi-user.target")
      machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)

      # Post-reboot: start W2.2 kolu again. padi finds NO legacy port kaval (residue
      # wiped) and spawns DIGEST-keyed; the surviving saved session takes the degraded
      # restore path (park, not adopt), and a restore brings the marker record back.
      #
      # `wait_until_succeeds` (not `succeed`) rides out the post-reboot user-session
      # settle. NB: home-manager's profile RE-activation logs a benign "Failed to start
      # Home Manager environment for alice" on this second boot of the PERSISTENT root
      # (the profile generation was already installed on the first boot; a real host
      # never re-activates HM on a reboot). It is inert — the kolu user unit is
      # store-linked (not gated on that service) and padi's state-root is intact — so
      # kolu starts and every assertion below holds regardless.
      machine.wait_until_succeeds(
          "timeout 30 machinectl -q shell alice@.host /run/current-system/sw/bin/systemctl --user start kolu </dev/null",
          timeout=120,
      )
      ${waitForListener}
      ${runAsAlice verifyReboot}
      print(machine.succeed(
          "grep -q '^OK' ${rebootResultFile} && cat ${rebootResultFile} || { echo 'reboot result:'; cat ${rebootResultFile}; false; }"
      ))
    '';
  };
}
