# W2.2 UPGRADE-migration adoption VM test — the pre-W2.2 → W2.2 cutover path.
#
# The bug this reproduces: pre-W2.2 kolu-server keyed its kaval by the LISTEN PORT
# (`kaval-<port>/`, a survivable daemon). W2.2 keys by a DIGEST of padi's state-root
# (`kaval-<digest>/`). On the first W2.2 boot the new padi looks only at its
# digest-keyed gate — finds nothing — and SPAWNS A FRESH kaval, LEAKING the running
# pre-W2.2 port-keyed kaval that still holds the live PTYs. The product invariant
# (the adoption promise): PTYs survive a deploy; kaval recycles ONLY on a pty-host
# CONTRACT skew — an upgrade is just another deploy. So a W2.2 padi must ADOPT the
# surviving port-keyed kaval, not leak it.
#
# This test's flow INVERTS the other adoption tests: instead of letting kolu
# auto-start and seeding a terminal through it, it stands up a LEGACY port-keyed
# kaval (with a live marker PTY + a long-running fake "agent") and the matching
# pre-W2.2 `config.json` FIRST — the exact pre-upgrade world — and only THEN starts
# the W2.2 kolu (the "upgrade" moment). kolu auto-start is cleared in `nodeExtra`.
#
# TWO arms, run sequentially in ONE VM (arm 2 builds on arm 1's adopted state):
#   ARM 1 (adopt-on-upgrade)  — RED on current code: the marker PTY survives (same
#     id+pid) inside the ADOPTED port kaval, the port gate is UNCHANGED (same process,
#     not respawned), NO fresh kaval-<digest> daemon is spawned, padi logs the
#     adoption, and NO restore card shows (the imported record reconciles onto the
#     adopted live PTY). A leak-spawn spawns a digest daemon and parks → times out RED.
#   ARM 2 (convergence)        — a Restart-kaval recycle respawns DIGEST-keyed and the
#     legacy port ref is GONE, pinning the bounded migration.
#
# Only the distinguishing data lives here; lib.nix owns the shared scaffold.
{ pkgs, port, kavalTui, kavalBin, lib, ... }:
let
  inherit (lib)
    jq curl survivalVmNode runAsAlice assertResult systemctlUser waitForListener;

  seedResultFile = "/tmp/upgrade-seed-result";
  adoptResultFile = "/tmp/upgrade-adopt-result";
  convergeResultFile = "/tmp/upgrade-converge-result";

  # Where the legacy (pre-W2.2) kolu-server config lived — the one-shot import source.
  # kolu-server forwards `$KOLU_STATE_DIR` to padi (`padiBinding.ts` `daemonEnv`), and
  # padi's `importLegacyConfigOnce` reads `<dir>/config.json` (packages/padi/src/
  # importLegacy.ts). Set on the kolu service below so the saved session — whose active
  # terminal id MATCHES the port kaval's live PTY — carries across on the first boot.
  legacyStateDir = "/home/alice/.config/kolu";

  # A unique marker only WE send into the terminal — a freshly-respawned PTY could
  # never contain it, so its survival in the port kaval's scrollback is proof the PTY
  # was ADOPTED, not re-spawned.
  nonce = "KOLU_UPGRADE_PROBE_7Kp2wz";

  # Shared shell helpers: the port-keyed (legacy) vs digest-keyed (W2.2) kaval layout.
  # `$XDG_RUNTIME_DIR` is a SHELL var (no `{}` → NOT nix-interpolated); `${port}` IS
  # nix (→ the listen port). A DIGEST kaval is any `kaval-*` dir that is NOT the port
  # one — its `kaval.pid` is the "padi spawned a fresh kaval-<digest>" leak signal.
  layout = ''
    PORT_DIR="$XDG_RUNTIME_DIR/kaval-${port}"
    PORT_SOCK="$PORT_DIR/pty-host.sock"
    PORT_GATE="$PORT_DIR/kaval.pid"

    # The legacy port kaval's gate-holder pid (empty if absent — no crash on the glob).
    port_gate_pid() { [ -f "$PORT_GATE" ] && cat "$PORT_GATE" 2>/dev/null; return 0; }

    # Every DIGEST-keyed kaval gate path — a `kaval-*/kaval.pid` whose dir is NOT the
    # port one. Non-empty ⇒ padi spawned a fresh kaval-<digest> (the leak). A no-match
    # glob is skipped by the `[ -f ]` guard, so an absent daemon prints nothing.
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

    # 5) Record the survivors for the verify phases.
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

  # The Restart-kaval RPC (`padiSurface.procedures.lifecycle.recycleKaval`): capture →
  # drain → recycle (kill the adopted kaval + spawn fresh, DIGEST-keyed) → park.
  # `recycleKaval` takes NO input — the surface compiles its `{}` spec to `z.void()`, so
  # the oRPC body must DESERIALIZE to `undefined`: an EMPTY envelope `{}` (no `json`
  # key) does, whereas `{"json":{}}` deserializes to an OBJECT and is rejected
  # ("expected void, received object"). Unlike lib.nix's `daemonRestart` (a top-level
  # `oc.output(z.void())` with no `.input()`, whose lenient default accepts `{"json":{}}`),
  # a re-served surface procedure validates strictly. No `"` in `{}` → no escaping needed.
  # Unauthenticated loopback.
  recycleKaval = ''${curl} -fsS --max-time 90 -X POST 'http://127.0.0.1:${port}/rpc/surface/padi/lifecycle/recycleKaval' -H 'content-type: application/json' -d '{}' >/dev/null'';

in
pkgs.testers.nixosTest {
  name = "kolu-adoption-upgrade";
  nodes.machine = survivalVmNode {
    # Do NOT auto-start kolu: the seed must stand up the LEGACY port kaval FIRST, then
    # the testScript starts kolu by hand (the "upgrade" moment). Clearing WantedBy
    # keeps the unit INSTALLED (startable by hand) but off the boot path — the same
    # manual-start precedent skew.nix's kolu-new service sets.
    home-manager.users.alice.systemd.user.services.kolu = {
      Install.WantedBy = pkgs.lib.mkForce [ ];
      # Point kolu-server at the legacy config dir so it forwards `$KOLU_STATE_DIR` to
      # padi and the one-shot import carries the pre-W2.2 saved session across. The
      # default example config sets no service Environment, so this is a clean add.
      Service.Environment = [ "KOLU_STATE_DIR=${legacyStateDir}" ];
    };
  };
  testScript = ''
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
    ))

    # ARM 2 — convergence: a Restart-kaval recycle respawns DIGEST-keyed and retires the
    # legacy port ref (the bounded migration). `wait_until_succeeds` rides out the boot
    # race; the recycle blocks until the fresh kaval connects.
    machine.wait_until_succeeds("timeout 90 ${recycleKaval}", timeout=180)
    ${runAsAlice verifyConverge}
    print(machine.succeed(
        "grep -q '^OK' ${convergeResultFile} && cat ${convergeResultFile} || { echo 'converge result:'; cat ${convergeResultFile}; false; }"
    ))
  '';
}
