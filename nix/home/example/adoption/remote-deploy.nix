# A DEPLOY replaces a REMOTE host's padi under its terminals, and an idle agent
# the person had already read must not come back as a fresh finish.
#
# THE CLAIM. On a remote host whose saved session lists a SLEEPING terminal
# first and a terminal with an idle agent after it, a kolu deploy on the binder
# replaces the remote padi (kaval and the PTYs stay), and every SETTLED urgency
# frame the new remote padi publishes lists the agent in `finishedIds` — never
# in `lingerIds`, never in no list. A `linger` frame followed by a `finished`
# one is a brand-new finish: every connected page marks the row unread and
# plays the sound.
#
# TWO NODES — the binder and the remote of `remoteHost.nix`.
#
# THE DEPLOY. `koluNew` is the deployed build with a different padi build id
# (`padiBuildIdOverride`) and the SAME `commitHash`. The commit hash is written
# into the agent flake source a remote is provisioned from, so keeping it makes
# that source — and the `padi-agent` closure the remote already holds — the
# same store path as before: nothing new has to ship to an offline remote. The
# remote padi therefore keeps reporting the build it was shipped with, while the
# new binder bakes the override; it sees a build mismatch on its first dial and
# drains the remote padi (persist + exit; kaval and the PTYs survive). That is
# the path a real deploy takes on a remote host. The binder's drain budget gives
# up after three drains and adopts what is running — the test reads the FIRST
# replacement, which is the one every deploy makes.
#
# THE READ. The remote padi's own `urgency` cell, followed on agenthost through
# its unix socket (`kolu surface get urgency --follow`, from the shipped
# `padi-agent` closure), each frame stamped with the gate pid of the padi it was
# read from. Read on the remote rather than through the new binder because the
# binder's mirror holds a cell's last value across a padi restart: a frame read
# there cannot be told apart from the old padi's.
#
# THE AGENT. A Claude Code session the way the e2e harness's "on the noted
# terminal" arrangement writes one: a session file keyed to the terminal's
# shell pid (the foreground pid of an idle shell) and a transcript whose last
# turn ended. padi reads both under root's `~/.claude` on the remote.
#
# `users.users.root.linger` on the remote: the survival precondition the binder
# node already has for alice (lib.nix). Without it, root's runtime dir — where
# the remote padi's and kaval's sockets live — is removed when the old binder's
# ssh session closes, and the deploy would test a fresh spawn, not a survivor.
{ pkgs, kolu, system, port, lib, ... }:
let
  nixLib = pkgs.lib;
  inherit (lib) jq;

  remote = import ./remoteHost.nix { inherit pkgs kolu lib; };
  inherit (remote) mapKey;

  # The build-bumped kolu. Built the way kolu's own flake builds
  # `packages.default` (its pinned nixpkgs, its `nix/commit-hash.nix`), so the
  # ONLY difference from the deployed kolu is padi's build id. Unlike
  # `padi-upgrade.nix` it keeps the deployed commit hash — see the header.
  koluPkgs = import "${kolu}/nix/nixpkgs.nix" { inherit system; };
  koluNew = (import "${kolu}/default.nix" {
    pkgs = koluPkgs;
    commitHash = import "${kolu}/nix/commit-hash.nix" kolu;
    padiBuildIdOverride =
      "facefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeed";
  }).default;

  # The `kolu` CLI the remote is provisioned with.
  remoteKolu = "${kolu.packages.${system}.padi-agent}/bin/kolu";

  # The agent's files — see the header. `cwd` only names the transcript's
  # project dir (`/` and `.` become `-`, packages/integrations/claude-code).
  sessionId = "remote-deploy-session";
  agentCwd = "/tmp/remote-deploy-agent";
  projectDir = "/root/.claude/projects/-tmp-remote-deploy-agent";
  transcript = pkgs.writeText "remote-deploy-transcript.jsonl"
    (nixLib.concatMapStrings (entry: builtins.toJSON entry + "\n") [
      {
        type = "user";
        uuid = "u1";
        timestamp = "2026-01-01T00:00:00.000Z";
        message = { role = "user"; content = [{ type = "text"; text = "hello"; }]; };
      }
      {
        type = "assistant";
        uuid = "a1";
        timestamp = "2026-01-01T00:00:01.000Z";
        message = {
          model = "claude-opus-4-6";
          role = "assistant";
          stop_reason = "end_turn";
          content = [{ type = "text"; text = "Done!"; }];
        };
      }
    ]);

  # The pid in a daemon's gate on the remote (`padi` or `kaval`), or nothing.
  # root's runtime home is `/run/user/0` under linger; `/tmp` is the
  # no-XDG fallback (packages/surface-daemon/src/daemonHome.ts).
  gatePid = pkgs.writeShellScript "remote-gate-pid" ''
    export PATH=${nixLib.makeBinPath [ pkgs.coreutils pkgs.findutils ]}
    gate=$(find /run/user/0 /tmp -maxdepth 2 -name "$1.pid" 2>/dev/null | head -n1)
    [ -n "$gate" ] && cat "$gate"
    exit 0
  '';

  # Follow the remote padi's `urgency`, re-dialling whichever padi holds the
  # socket, one line per frame: `<ms> <padi gate pid> <frame json>`.
  followUrgency = pkgs.writeShellScript "remote-follow-urgency" ''
    export PATH=${nixLib.makeBinPath [ pkgs.coreutils pkgs.findutils ]}
    export HOME=/root
    while true; do
      sock=$(find /run/user/0 /tmp -maxdepth 2 -name padi.sock 2>/dev/null | head -n1)
      if [ -n "$sock" ]; then
        pid=$(cat "$(dirname "$sock")/padi.pid" 2>/dev/null || echo none)
        ${remoteKolu} surface get urgency --follow --socket "$sock" \
          2>>/tmp/remote-urgency.err \
          | while IFS= read -r frame; do
              echo "$(date +%s%3N) $pid $frame"
            done >> /tmp/remote-urgency.log
      fi
      sleep 0.2
    done
  '';

  createCmd = lib.rpc {
    tag = "surface/padi/lifecycle/create";
    payload = ''{"mapKey":"${mapKey}","input":{"placement":{"kind":"toplevel"}}}'';
    python = true;
  };
  sleepCmd = lib.rpc { tag = "surface/padi/lifecycle/sleep"; };
in
pkgs.testers.nixosTest {
  name = "kolu-remote-deploy";

  nodes = {
    machine = { ... }: {
      imports = [ remote.nodes.machine ];
      # The build-bumped kolu, started by hand on the same port once the old
      # server is stopped — as `padi-upgrade.nix` does.
      systemd.user.services.kolu-new = {
        description = "kolu (padi-build-bumped) — the newer build for the remote-deploy test";
        serviceConfig = {
          ExecStart = "${koluNew}/bin/kolu web --bind 127.0.0.1 --port ${port}";
          Restart = "no";
        };
      };
    };
    agenthost = { ... }: {
      imports = [ remote.nodes.agenthost ];
      users.users.root.linger = true;
    };
  };

  testScript = ''
    import json
    import shlex
    import time

    start_all()
    ${lib.bootPoll}

    ${remote.sshTrust}

    # padi reads Claude Code's files under the remote user's home.
    agenthost.succeed("mkdir -p /root/.claude/sessions ${projectDir}")

    ${remote.addHost}

    def frames():
        out = agenthost.succeed("cat /tmp/remote-urgency.log 2>/dev/null || true")
        read = []
        # The last piece after the final newline may be a frame still being written.
        for line in out.split("\n")[:-1]:
            at, pid, body = line.split(" ", 2)
            read.append((int(at), pid, json.loads(body)))
        return read

    def gate(name):
        return agenthost.succeed(f"${gatePid} {name}").strip()

    def timeline(since):
        return "\n".join(
            f"  t={at - since:>7}ms padi={pid} settled={f['settled']} "
            f"linger={f['lingerIds']} finished={f['finishedIds']} "
            f"working={f['workingIds']} asking={f['awaitingIds']}"
            for at, pid, f in frames()
        )

    def wait_for(check, what, timeout, since):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if check():
                return
            time.sleep(1)
        _, err = agenthost.execute("tail -n 40 /tmp/remote-urgency.err 2>&1 || true")
        _, journal = machine.execute(
            "journalctl _UID=1000 --no-pager --lines=300 2>&1 || true"
        )
        machine.log(f"timeline:\n{timeline(since)}\nfollower stderr:\n{err}\nbinder journal:\n{journal}")
        raise Exception(f"timed out after {timeout}s waiting for {what}")

    # ── 1. On the remote: a sleeping terminal first, an idle agent after it ──
    # The first create also waits out the dial: the agent closure ships first.
    sleeper = json.loads(machine.wait_until_succeeds("${createCmd}", timeout=1200))["id"]
    machine.succeed(
        "${sleepCmd} "
        + shlex.quote(json.dumps({"mapKey": "${mapKey}", "input": {"id": sleeper}}))
    )
    created = json.loads(machine.succeed("${createCmd}"))
    agent, shell_pid = created["id"], created["pid"]
    agenthost.succeed("cp ${transcript} ${projectDir}/${sessionId}.jsonl")
    session = {
        "pid": shell_pid,
        "sessionId": "${sessionId}",
        "cwd": "${agentCwd}",
        "startedAt": int(time.time() * 1000),
    }
    agenthost.succeed(
        f"echo {shlex.quote(json.dumps(session))} > /root/.claude/sessions/{shell_pid}.json"
    )

    # The saved session the next remote padi boots from: the sleeper FIRST.
    agenthost.wait_until_succeeds(
        f"${jq} -e --arg s {sleeper} --arg a {agent} "
        "'.session.terminals | (.[0].id == $s and .[0].state == \"sleeping\") "
        "and (map(.id) | index($a) != null)' /root/.local/state/padi/config.json",
        timeout=120,
    )

    # ── 2. Follow the remote padi; it reads the agent finished ───────────────
    agenthost.succeed("systemd-run --unit=remote-urgency ${followUrgency}")
    # The remote's own clock, the one the follower stamps frames with.
    started = int(agenthost.succeed("date +%s%3N"))
    old_padi, old_kaval = gate("padi"), gate("kaval")
    assert old_padi and old_kaval, f"remote gates: padi={old_padi!r} kaval={old_kaval!r}"

    def finished(f):
        return f["settled"] and agent in f["finishedIds"]

    wait_for(
        lambda: any(pid == old_padi and finished(f) for _, pid, f in frames()),
        f"the remote padi to list {agent} finished before the deploy",
        300,
        started,
    )

    # ── 3. Deploy the build-bumped kolu on the binder ────────────────────────
    deployed = int(agenthost.succeed("date +%s%3N"))
    ${lib.systemctlUser "stop kolu"}
    ${lib.systemctlUser "start kolu-new"}
    ${lib.waitForListener}

    def replaced(pid):
        return pid not in (old_padi, "none", "")

    wait_for(
        lambda: replaced(gate("padi"))
        and any(replaced(pid) and finished(f) for _, pid, f in frames()),
        f"a NEW remote padi to list {agent} finished",
        900,
        deployed,
    )

    # The deploy took the path a deploy takes: the remote padi was replaced,
    # its kaval and the agent's shell were not.
    assert gate("kaval") == old_kaval, f"remote kaval {old_kaval} -> {gate('kaval')}"
    agenthost.succeed(f"kill -0 {shell_pid}")

    # ── 4. THE ASSERTION: no settled frame from a new padi re-finishes it ────
    after = [(at, pid, f) for at, pid, f in frames() if replaced(pid)]
    print(f"remote padi {old_padi} -> {gate('padi')}; urgency since the deploy:\n{timeline(deployed)}")
    in_no_list = lambda f: not any(
        agent in f[key] for key in ("finishedIds", "lingerIds", "workingIds", "awaitingIds")
    )
    bad = [
        (at - deployed, pid, f)
        for at, pid, f in after
        if f["settled"] and (agent in f["lingerIds"] or in_no_list(f))
    ]
    assert not bad, f"a new remote padi published {agent} lingering or in no list: {bad}"
  '';
}
