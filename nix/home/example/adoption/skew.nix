# B3.3 — the NEGATIVE adoption path: a contract-skewed survivor is RECYCLED, not
# adopted, and the session is preserved for restore.
#
# When a redeploy DOES change kaval's wire (a `PTY_HOST_CONTRACT_VERSION` bump),
# the surviving old daemon is incompatible. `adoptOrEnsure` must NOT adopt it —
# the handshake skews (`DaemonContractSkewError`), so it recycles the survivor
# (kill + fresh spawn). The terminals don't survive (the daemon was killed), but
# the saved session is left untouched so the user is offered a restore.
#
# There is no env seam for the contract version (it's a source constant), so the
# "newer kolu" is a second build with `contractVersionOverride` set (see the root
# default.nix). The test boots the normal kolu (old), seeds a terminal + a saved
# session on its daemon, stops it (the daemon survives), then starts the bumped
# kolu on the SAME port — which finds the survivor, skews, and recycles it.
#
# Asserts: the daemon gate pid CHANGED (recycled, fresh daemon), kolu logged the
# contract skew, AND the saved session still holds the terminal (preserved for
# restore). A regression that wrongly adopted the skewed daemon would leave the
# gate unchanged → the poll times out red.
{ pkgs, kolu, home-manager, nixosModule, system }:
let
  jq = "${pkgs.jq}/bin/jq";
  curl = "${pkgs.curl}/bin/curl";
  port = "7681";

  # The "newer" kolu: same source, but its daemon's wire-contract constant is
  # bumped so its server rejects (and recycles) the older daemon's handshake.
  # Build it exactly the way kolu's own flake builds packages.default — kolu's
  # pinned nixpkgs at an explicit `system` — so the only difference from the
  # running (old) kolu is the contract bump, and so importing default.nix stays
  # pure (its `pkgs` default reaches `builtins.currentSystem`, which flakes ban).
  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = "skew-test";
    contractVersionOverride = "9.0";
  }).default;

  # Seed: open a terminal on the OLD (compatible) daemon and wait until its
  # session is SAVED to disk — so we can later prove it was PRESERVED across the
  # skew-recycle. Records the OLD daemon's gate pid + the terminal id.
  seed = pkgs.writeShellScript "kolu-skew-seed" ''
    set -uo pipefail
    fail() { echo "FAIL(skew-seed): $*" > /tmp/skew-seed-result; exit 1; }
    ns="$XDG_RUNTIME_DIR/kaval-${port}"

    id=$(${curl} -fsS -X POST "http://127.0.0.1:${port}/rpc/terminal/create" \
           -H 'content-type: application/json' -d '{"json":{}}' \
         | ${jq} -r '.json.id') || fail "terminal.create RPC errored"
    [ -n "$id" ] && [ "$id" != null ] || fail "terminal.create returned no id"

    # wait for the autosave to persist the session (so 'preserved' is meaningful).
    for _ in $(seq 1 30); do
      grep -q "$id" "$HOME/.config/kolu/config.json" 2>/dev/null && break
      sleep 1
    done
    grep -q "$id" "$HOME/.config/kolu/config.json" 2>/dev/null \
      || fail "session for $id never saved to disk"

    cat "$ns/kaval.pid" > /tmp/skew-gate || fail "could not read daemon gate pid"
    echo "$id" > /tmp/skew-id
    echo OK > /tmp/skew-seed-result
  '';

  # Verify (after the bumped server boots). POLL until the skewed survivor has
  # been cleanly recycled WITH the session preserved — never a single-shot read.
  # A recycle gives a NEW gate pid; the server logs the contract skew; and the
  # saved session still holds the terminal. A wrong adoption keeps the gate, never
  # logs a skew → times out, writing FAIL.
  verify = pkgs.writeShellScript "kolu-skew-verify" ''
    set -uo pipefail
    ns="$XDG_RUNTIME_DIR/kaval-${port}"
    id=$(cat /tmp/skew-id); oldgate=$(cat /tmp/skew-gate)

    newgate=""
    for _ in $(seq 1 90); do
      newgate=$(cat "$ns/kaval.pid" 2>/dev/null || echo "")
      skewlog=$(journalctl --user -u kolu-new --no-pager 2>/dev/null | grep -c "contract skew" || echo 0)
      sess=$(grep -c "$id" "$HOME/.config/kolu/config.json" 2>/dev/null || echo 0)
      if [ -n "$newgate" ] && [ "$newgate" != "$oldgate" ] \
         && [ "$skewlog" -ge 1 ] && [ "$sess" -ge 1 ]; then
        echo "OK skew-recycled: daemon gate $oldgate->$newgate; contract skew logged; session for $id preserved" \
          > /tmp/skew-verify-result
        exit 0
      fi
      sleep 1
    done
    {
      echo "FAIL(skew-verify): the skewed survivor was not cleanly recycled with the session preserved."
      echo "  daemon gate pid: $oldgate -> $newgate (must CHANGE — the survivor is recycled, not adopted)"
      echo "  kolu-new 'contract skew' log count: $(journalctl --user -u kolu-new --no-pager 2>/dev/null | grep -c 'contract skew' || echo 0) (must be >= 1)"
      echo "  session $id in config.json: $(grep -c "$id" "$HOME/.config/kolu/config.json" 2>/dev/null || echo 0) (must be >= 1 — preserved for restore)"
    } > /tmp/skew-verify-result
    exit 1
  '';
in
pkgs.testers.nixosTest {
  name = "kolu-adoption-skew";

  nodes.machine = { ... }: {
    imports = [
      home-manager.nixosModules.home-manager
      nixosModule
    ];
    services.getty.autologinUser = "alice";
    users.users.alice.linger = true;

    # The "newer" (contract-bumped) kolu, as a manual user service on the SAME
    # port — started only after the old server is stopped, so it inherits the
    # surviving daemon's socket namespace and skews on the handshake.
    systemd.user.services.kolu-new = {
      description = "kolu (contract-bumped) — the newer build for the skew test";
      serviceConfig = {
        ExecStart = "${koluNew}/bin/kolu --host 127.0.0.1 --port ${port}";
        Restart = "no";
      };
      # deliberately NOT wantedBy anything — the testScript starts it by hand.
    };
  };

  testScript = ''
    machine.wait_for_unit("multi-user.target")
    machine.wait_until_succeeds("systemctl is-active user@1000.service", timeout=90)
    machine.wait_until_succeeds(
        "curl --fail --silent http://127.0.0.1:${port}/ > /dev/null",
        timeout=180,
    )

    # Seed a terminal + a saved session on the OLD (compatible) daemon. Scripts
    # run as alice via machinectl (whose exit code is swallowed), so assert the
    # result file as root.
    machine.succeed("timeout 180 machinectl -q shell alice@.host ${seed} </dev/null")
    machine.succeed("grep -qx OK /tmp/skew-seed-result || { echo 'skew-seed:'; cat /tmp/skew-seed-result; false; }")

    # Stop the OLD server; its daemon survives in its own transient cgroup.
    machine.succeed(
        "machinectl -q shell alice@.host /run/current-system/sw/bin/systemctl --user stop kolu </dev/null"
    )
    # Start the NEW (contract-bumped) server on the SAME port: it finds the
    # surviving daemon, the handshake skews, and it recycles it.
    machine.succeed(
        "machinectl -q shell alice@.host /run/current-system/sw/bin/systemctl --user start kolu-new </dev/null"
    )
    machine.wait_until_succeeds(
        "curl --fail --silent http://127.0.0.1:${port}/ > /dev/null",
        timeout=180,
    )

    # Verify: the survivor was RECYCLED (new gate pid), the skew was logged, and
    # the session is PRESERVED for restore.
    machine.succeed("timeout 180 machinectl -q shell alice@.host ${verify} </dev/null")
    print(machine.succeed(
        "grep -q '^OK' /tmp/skew-verify-result && cat /tmp/skew-verify-result || { echo 'skew-verify:'; cat /tmp/skew-verify-result; false; }"
    ))
  '';
}
