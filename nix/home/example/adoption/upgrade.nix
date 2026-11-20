{ pkgs, port, kavalTui, kavalBin, lib, ... }:
let
  inherit (lib)
    jq rpc survivalVmNode runAsAlice assertResult systemctlUser waitForListener;
  pkgsLib = pkgs.lib;

  seedResultFile = "/tmp/upgrade-seed-result";
  adoptResultFile = "/tmp/upgrade-adopt-result";
  convergeResultFile = "/tmp/upgrade-converge-result";
  rebootResultFile = "/tmp/upgrade-reboot-result";

  legacyStateDir = "/home/alice/.config/kolu";

  padiStateConf = "/home/alice/.local/state/padi/config.json";

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

  seed = pkgs.writeShellScript "kolu-upgrade-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(seed): $*" > ${seedResultFile}; exit 1; }
    ${layout}

    systemd-run --user --unit=legacy-kaval \
      --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" --setenv=HOME="$HOME" \
      ${kavalBin} --socket "$PORT_SOCK" >/dev/null 2>&1 \
      || fail "systemd-run of the legacy port kaval failed"
    for _ in $(seq 1 60); do [ -S "$PORT_SOCK" ] && [ -f "$PORT_GATE" ] && break; sleep 1; done
    [ -S "$PORT_SOCK" ] || fail "legacy kaval socket never came up at $PORT_SOCK"

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

    mkdir -p ${legacyStateDir}
    ${jq} -nc --arg id "$id" \
      '{session:{terminals:[{id:$id,state:"active",location:{kind:"local"},cwd:"/home/alice",git:null,pr:{kind:"absent"},lastActivityAt:0}],activeTerminalId:$id,savedAt:1700000000000}}' \
      > ${legacyStateDir}/config.json || fail "writing the legacy config.json failed"

    echo "$id"  > /tmp/upgrade-id
    echo "$pid" > /tmp/upgrade-pid
    port_gate_pid > /tmp/upgrade-port-gate
    [ -s /tmp/upgrade-port-gate ] || fail "could not read the legacy port kaval gate pid"
    echo OK > ${seedResultFile}
  '';

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

  verifyReboot = pkgs.writeShellScript "kolu-upgrade-verify-reboot" ''
    set -uo pipefail
    ${layout}
    restored=""
    for _ in $(seq 1 60); do
      digests=$(digest_kaval_gates)
      parklogs=$(journalctl --user --no-pager 2>/dev/null | grep -c "session-trace park: seeded")
      saved_n=$(${jq} '.session.terminals | length' ${padiStateConf} 2>/dev/null || echo 0)
      if [ -n "$digests" ] && [ ! -e "$PORT_GATE" ] \
         && ! timeout 5 ${kavalTui} list --socket "$PORT_SOCK" >/dev/null 2>&1 \
         && [ "$parklogs" -ge 1 ] && [ "$saved_n" -ge 1 ]; then
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

  recycleKaval = rpc {
    tag = "surface/padi/lifecycle/recycleKaval";
    payload = ''{"mapKey":"local"}'';
    timeoutMs = 90000;
    python = true;
  };

  koluServiceOverride = {
    Install.WantedBy = pkgsLib.mkForce [ ];
    Service.Environment = [ "KOLU_STATE_DIR=${legacyStateDir}" ];
  };

  bootThenAdopt = ''
    machine.wait_for_unit("multi-user.target")
    machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)

    ${runAsAlice seed}
    ${assertResult seedResultFile "upgrade seed"}

    ${systemctlUser "start kolu"}
    ${waitForListener}

    ${runAsAlice verifyAdopt}
    print(machine.succeed(
        "grep -q '^OK' ${adoptResultFile} && cat ${adoptResultFile} || { echo 'adopt result:'; cat ${adoptResultFile}; false; }"
    ))'';
in
{
  adoption-upgrade = pkgs.testers.nixosTest {
    name = "kolu-adoption-upgrade";
    nodes.machine = survivalVmNode {
      home-manager.users.alice.systemd.user.services.kolu = koluServiceOverride;
    };
    testScript = ''
      ${bootThenAdopt}

      machine.wait_until_succeeds("timeout 90 ${recycleKaval}", timeout=180)
      ${runAsAlice verifyConverge}
      print(machine.succeed(
          "grep -q '^OK' ${convergeResultFile} && cat ${convergeResultFile} || { echo 'converge result:'; cat ${convergeResultFile}; false; }"
      ))
    '';
  };

  # `virtualisation.fileSystems` is applied with
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

      machine.shutdown()
      machine.start()
      machine.wait_for_unit("multi-user.target")
      machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)

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
