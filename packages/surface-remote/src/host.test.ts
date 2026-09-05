/**
 * Coverage for the ssh-argv builders in `./host`. The load-bearing
 * assertion is that the one-shot probe/realise command carries the same
 * dead-peer keepalive as the long-lived agent session: a `nix-store
 * --realise` over ssh is a remote *build*, and without keepalive a host
 * that degrades mid-build wedges the caller's spawn cycle forever (the
 * "stuck copying to remote for eternity" failure this guards against).
 */
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { __resetControlMemo } from "./controlMaster";
import {
  CI_KEEPALIVE,
  namedControlDir,
  socketLeaf,
  sshOpts,
  useControlDir,
} from "./controlDir.testutil";
import {
  buildAgentCommand,
  buildSshProbeCommand,
  looksLikeNetworkError,
  nixSshOpts,
  SSH_COMMON_OPTS,
  sshCommonOpts,
  sshDialOpts,
  sshRefusalOf,
} from "./host";
import {
  DEFAULT_SSH_KEEPALIVE,
  MAX_SSH_KEEPALIVE_TOLERANCE_S,
  type SshKeepalive,
  sshKeepalive,
} from "./keepalive";

// Every spawned-ssh builder appends the P2.8 ControlMaster opts, which mkdir a
// kolu-private control dir out of `$XDG_RUNTIME_DIR`. The shared fixture points
// that at a throwaway private `/tmp` dir per test — and owns the reason why.
useControlDir("kolu-ssh-host-");

/** Assert an ssh argv carries the dead-peer keepalive policy `keepalive` (the
 *  package default unless stated). One invariant ("every non-interactive ssh
 *  this package spawns carries the dial's policy") asserted in one place, so
 *  re-tuning a keepalive value can't leave a second hand-synced block green on
 *  stale numbers. */
function assertKeepAlive(
  rendered: readonly string[] | string,
  keepalive: SshKeepalive = DEFAULT_SSH_KEEPALIVE,
): void {
  const opts = sshOpts(rendered);
  expect(opts.BatchMode).toBe("yes");
  expect(opts.ServerAliveInterval).toBe(String(keepalive.intervalS));
  expect(opts.ServerAliveCountMax).toBe(String(keepalive.countMax));
  // Not part of the tunable policy: the INITIAL handshake bound is fixed.
  expect(opts.ConnectTimeout).toBe("10");
}

describe("buildSshProbeCommand", () => {
  it("runs the command directly for localhost — no ssh wrapper", () => {
    const { command, args } = buildSshProbeCommand(
      "localhost",
      "nix-instantiate",
      "--eval",
    );
    expect(command).toBe("nix-instantiate");
    expect(args).toEqual(["--eval"]);
  });

  it("wraps a remote command in ssh; safe bare words stay unquoted", () => {
    const { command, args } = buildSshProbeCommand(
      "alice@bob.example",
      "nix-store",
      "--realise",
      "/nix/store/x-agent.drv",
    );
    expect(command).toBe("ssh");
    // host then remote argv, after the -o option block. Paths without shell
    // metacharacters remain bare (shellQuoteArg leaves them alone).
    expect(args.slice(-4)).toEqual([
      "alice@bob.example",
      "nix-store",
      "--realise",
      "/nix/store/x-agent.drv",
    ]);
  });

  it("POSIX-quotes remote tokens with shell metacharacters (zsh glob of drv^*)", () => {
    // #1964: `nix build … $drv^*` over ssh hit zsh on macOS as
    // `zsh:1: no matches found: …padi.drv^*` — OpenSSH joins the remote argv
    // into one string the login shell re-parses, so `*` MUST be quoted.
    // Localhost must stay unquoted (direct spawn, no shell).
    const installable =
      "/nix/store/fxc7xkr02fa8nr6zilj36am610sml49v-padi.drv^*";
    const remote = buildSshProbeCommand(
      "zest",
      "nix",
      "build",
      "--print-out-paths",
      "--no-link",
      installable,
    );
    expect(remote.command).toBe("ssh");
    expect(remote.args.at(-1)).toBe(`'${installable}'`); // single-quoted whole token
    expect(remote.args.at(-1)).not.toBe(installable); // not bare

    const local = buildSshProbeCommand(
      "localhost",
      "nix",
      "build",
      "--print-out-paths",
      "--no-link",
      installable,
    );
    expect(local.command).toBe("nix");
    expect(local.args.at(-1)).toBe(installable); // verbatim for spawn
  });

  it("fails fast on a dead peer: keepalive + connect timeout on the realise ssh", () => {
    const { args } = buildSshProbeCommand(
      "host",
      "nix-store",
      "--realise",
      "x",
    );
    // The fix: a degraded host mid-realise must trip ssh's dead-peer
    // detection (~Interval×CountMax) rather than hang forever.
    assertKeepAlive(args);
  });

  it("ends option parsing with `--` before the host (ssh option-injection guard)", () => {
    // The host is handed to ssh as a bare positional. Without a `--`
    // end-of-options marker, a host like `-oProxyCommand=<cmd>` is parsed by
    // ssh as an OPTION and runs <cmd> via /bin/sh — RCE from a hostile host
    // string. The separator makes the host a destination no matter what.
    const evil = "-oProxyCommand=touch /tmp/pwned";
    const { args } = buildSshProbeCommand(evil, "nix-store", "--realise", "x");
    const sep = args.indexOf("--");
    expect(sep).toBeGreaterThanOrEqual(0); // a separator exists
    expect(args[sep + 1]).toBe(evil); // host immediately follows it
    expect(args.slice(0, sep)).not.toContain(evil); // never an option-position token
  });
});

describe("buildAgentCommand", () => {
  it("runs the binary directly for localhost, spawning with EXACTLY the composed env", () => {
    // The localhost arm returns the caller-composed `localEnv` verbatim — the
    // agent runs locally with THIS env, never the caller's ambient `process.env`
    // (#1872 / PR1.5). surface-remote is policy-free: it passes the env through.
    const localEnv = { HOME: "/home/x", PATH: "/usr/bin" };
    const cmd = buildAgentCommand({
      host: "localhost",
      agentPath: "/nix/store/x-agent",
      binary: "my-agent",
      localEnv,
    });
    expect(cmd).toEqual({
      command: "/nix/store/x-agent/bin/my-agent",
      args: ["--stdio"],
      env: localEnv,
    });
  });

  it("wraps a remote agent in ssh with the shared keepalive opts — env undefined (the local ssh client inherits)", () => {
    const { command, args, env } = buildAgentCommand({
      host: "bob.example",
      agentPath: "/nix/store/x-agent",
      binary: "my-agent",
      // Supplied but IGNORED on the ssh arm: that child is the local ssh client,
      // which legitimately inherits the caller's env (SSH_AUTH_SOCK / ~/.ssh).
      localEnv: { HOME: "/home/x", PATH: "/usr/bin" },
    });
    expect(command).toBe("ssh");
    expect(args.slice(-2)).toEqual([
      "/nix/store/x-agent/bin/my-agent",
      "--stdio",
    ]);
    expect(env).toBeUndefined();
    assertKeepAlive(args);
  });

  it("ends option parsing with `--` before the host (ssh option-injection guard)", () => {
    // Same bare-positional sink as buildSshProbeCommand: a `-oProxyCommand=…`
    // host would otherwise be parsed as an ssh option (RCE). `--` forces it to
    // a destination.
    const evil = "-oProxyCommand=touch /tmp/pwned";
    const { args } = buildAgentCommand({
      host: evil,
      agentPath: "/nix/store/x-agent",
      binary: "my-agent",
      localEnv: {},
    });
    const sep = args.indexOf("--");
    expect(sep).toBeGreaterThanOrEqual(0);
    expect(args[sep + 1]).toBe(evil);
    expect(args.slice(0, sep)).not.toContain(evil);
  });

  it("appends extraArgs after --stdio, verbatim for localhost (no shell)", () => {
    const { args } = buildAgentCommand({
      host: "localhost",
      agentPath: "/nix/store/x-agent",
      binary: "pulam",
      extraArgs: ["--kaval", "/run/user/1000/kaval-7692/pty-host.sock"],
      localEnv: {},
    });
    expect(args).toEqual([
      "--stdio",
      "--kaval",
      "/run/user/1000/kaval-7692/pty-host.sock",
    ]);
  });

  it("POSIX-quotes extraArgs for a real remote (ssh re-splits through the remote shell)", () => {
    const { args } = buildAgentCommand({
      host: "bob.example",
      agentPath: "/nix/store/x-agent",
      binary: "pulam",
      // A value with a space + a single quote would re-split / break the remote
      // command line unquoted; the quoting must make it one literal token. A
      // safe bare word like `--kaval` is left unquoted by `shellQuoteArg` (the
      // canonical quoter) — equivalent through the remote shell.
      extraArgs: ["--kaval", "/tmp/we ird/pty's.sock"],
      localEnv: {},
    });
    expect(args.slice(-3)).toEqual([
      "--stdio",
      "--kaval",
      "'/tmp/we ird/pty'\\''s.sock'",
    ]);
  });

  it("throws on a localhost dial with no composed env — never falls back to ambient inherit (#1872)", () => {
    // The type forbids omitting `localEnv`, but types erase at runtime; the localhost arm
    // fails LOUD rather than let `spawn(env: undefined)` inherit the ambient `process.env`
    // (an untyped caller / `as any` / a .d.ts-build skew could hand undefined at runtime).
    expect(() =>
      buildAgentCommand({
        host: "localhost",
        agentPath: "/nix/store/x-agent",
        binary: "my-agent",
        localEnv: undefined as unknown as Record<string, string>,
      }),
    ).toThrow(/localEnv is required for a localhost dial/);
  });

  it("does NOT throw when localEnv is absent on the ssh arm — it is unused there", () => {
    // The ssh arm never touches `localEnv` (`env` is undefined = legitimate inherit for the
    // LOCAL ssh client), so a runtime-absent `localEnv` must not reject a remote dial — the
    // guard is precisely scoped to the localhost arm where the leak would occur.
    expect(() =>
      buildAgentCommand({
        host: "bob.example",
        agentPath: "/nix/store/x-agent",
        binary: "my-agent",
        localEnv: undefined as unknown as Record<string, string>,
      }),
    ).not.toThrow();
  });
});

describe("sshRefusalOf", () => {
  it("classifies the credential refusals BatchMode turns into an instant exit", () => {
    // With `BatchMode=yes` ssh DECLINES to prompt rather than asking, so a
    // password-only host produces this line and exits — the fact that must
    // become a terminal verdict instead of an eternal reconnect.
    expect(
      sshRefusalOf(
        "srid@petit: Permission denied (publickey,password,keyboard-interactive).",
      ),
    ).toBe("auth-refused");
    // A host whose MaxAuthTries is spent by the agent's keys refuses the same
    // way, with different words.
    expect(
      sshRefusalOf(
        "Received disconnect from 10.0.0.4 port 22:2: Too many authentication failures",
      ),
    ).toBe("auth-refused");
  });

  it("classifies an unverified host key — one line covers unknown AND changed keys", () => {
    // Both the never-seen host and the REMOTE HOST IDENTIFICATION HAS CHANGED
    // warning end on this same final line, so one pattern classifies both.
    expect(sshRefusalOf("Host key verification failed.")).toBe(
      "host-key-unverified",
    );
  });

  it("does NOT classify a remote command's own permission error", () => {
    // ssh forwards the REMOTE command's stderr on the same stream, so a bare
    // "Permission denied" is not ours to claim: only ssh's own auth message
    // carries the parenthesised method list. Misclassifying here would strand a
    // reachable host on a terminal card for a transient remote-side error.
    expect(
      sshRefusalOf("nix-instantiate: /nix/var/nix/db: Permission denied"),
    ).toBeNull();
  });

  it("leaves transport failures to looksLikeNetworkError", () => {
    // The sibling classifier owns "the host is unreachable" (retry forever);
    // this one owns "the host answered and refused us" (terminal). A transport
    // line must never take the terminal path.
    for (const line of [
      "ssh: connect to host petit port 22: Connection refused",
      "ssh: Could not resolve hostname petit: Name or service not known",
    ]) {
      expect(sshRefusalOf(line)).toBeNull();
      expect(looksLikeNetworkError(line)).toBe(true);
    }
  });
});

describe("ssh keepalive policy", () => {
  it("defaults to ~30s of tolerated silence — the interactive policy", () => {
    // The literal every consumer that states nothing gets. Pinned here (not
    // read back from the const) so a change to the default is a deliberate,
    // visible edit rather than a silently-green tautology.
    expect(DEFAULT_SSH_KEEPALIVE.intervalS).toBe(10);
    expect(DEFAULT_SSH_KEEPALIVE.countMax).toBe(3);
    assertKeepAlive(sshCommonOpts());
    assertKeepAlive(SSH_COMMON_OPTS);
  });

  it("carries a custom policy into the agent argv, the probe argv, and NIX_SSHOPTS", () => {
    // The whole point of the option: a CI dial's five-minute tolerance must
    // reach EVERY ssh the dial spawns — including the one Nix forks for the
    // remote store, which never sees our argv.
    assertKeepAlive(
      buildAgentCommand({
        host: "bob.example",
        agentPath: "/nix/store/x-agent",
        binary: "my-agent",
        localEnv: {},
        keepalive: CI_KEEPALIVE,
      }).args,
      CI_KEEPALIVE,
    );
    assertKeepAlive(
      buildSshProbeCommand(
        { host: "bob.example", keepalive: CI_KEEPALIVE },
        "nix-store",
        "--realise",
        "x",
      ).args,
      CI_KEEPALIVE,
    );
    assertKeepAlive(nixSshOpts(CI_KEEPALIVE), CI_KEEPALIVE);
  });

  it("gives a custom policy its OWN ControlMaster socket", () => {
    // OpenSSH applies ServerAlive* from whichever process OPENED the master, so
    // a shared socket would silently hand the CI dial the interactive policy.
    const ciPath = sshOpts(
      buildSshProbeCommand(
        { host: "h", keepalive: CI_KEEPALIVE },
        "nix-store",
        "--realise",
        "x",
      ).args,
    ).ControlPath;
    const defaultPath = sshOpts(
      buildSshProbeCommand("h", "nix-store", "--realise", "x").args,
    ).ControlPath;
    expect(ciPath).toBeDefined();
    expect(ciPath).not.toBe(defaultPath);
    // The env form names the SAME per-policy socket as the argv form.
    expect(sshOpts(nixSshOpts(CI_KEEPALIVE)).ControlPath).toBe(ciPath);
  });

  it("a bare host string still means the default policy", () => {
    // Backward compatibility for every existing call site and for external
    // importers of the builders.
    assertKeepAlive(
      buildSshProbeCommand("bob.example", "nix-store", "--realise", "x").args,
    );
    assertMultiplex(
      buildSshProbeCommand(
        { host: "bob.example" },
        "nix-store",
        "--realise",
        "x",
      ).args,
    );
  });

  it("THROWS on an absurd or malformed policy — never clamps it", () => {
    // Fail-fast, the sibling of createHeartbeat's MAX_HEARTBEAT_* guard: a
    // policy is rejected, never silently reshaped into one nobody asked for.
    //
    // And it is rejected in ONE place — `sshKeepalive` is the only producer of
    // a branded `SshKeepalive`, so the throw lands at the literal the consumer
    // wrote rather than at whichever render seam happens to see it first. That
    // closes the localhost loophole structurally too: there is no longer an
    // unvalidated value that could reach a builder whose local arm renders no
    // opts at all, so fail-fast cannot become a property of WHICH HOST you
    // dialled.
    for (const [intervalS, countMax] of [
      [0, 3],
      [-10, 3],
      [10, 0],
      [2.5, 3],
      [Number.NaN, 3],
      [Number.POSITIVE_INFINITY, 3],
      // 120 × 60 = 7200s — past the one-hour tolerance ceiling.
      [120, 60],
    ] as const) {
      expect(() => sshKeepalive(intervalS, countMax)).toThrow(/ssh keepalive/);
    }
    // The boundary itself is allowed: exactly one hour of tolerance passes.
    expect(() => sshKeepalive(60, 60)).not.toThrow();
    expect(60 * 60).toBe(MAX_SSH_KEEPALIVE_TOLERANCE_S);
  });
});

describe("sshDialOpts — the COMPLETE outward-facing opt set", () => {
  it("is what the builders emit: keepalive AND the ControlMaster decision", () => {
    // The seam this package hands an out-of-package consumer must render the
    // SAME set the package spawns with — a set that names no ControlPath is not
    // "no multiplexing" (see NO_MULTIPLEXING in controlMaster.ts).
    const dial = [...sshDialOpts(CI_KEEPALIVE)];
    assertKeepAlive(dial, CI_KEEPALIVE);
    assertMultiplex(dial, CI_KEEPALIVE);
    // Byte-for-byte the option prefix both builders emit — one composition, so
    // the outward seam cannot drift from the argv this package spawns.
    const probe = buildSshProbeCommand(
      { host: "bob.example", keepalive: CI_KEEPALIVE },
      "nix-store",
      "--realise",
      "x",
    ).args;
    expect(probe.slice(0, dial.length)).toEqual(dial);
    const agent = buildAgentCommand({
      host: "bob.example",
      agentPath: "/nix/store/x-agent",
      binary: "my-agent",
      localEnv: {},
      keepalive: CI_KEEPALIVE,
    }).args;
    expect(agent.slice(0, dial.length)).toEqual(dial);
    // …and nothing is double-appended by the composition.
    const opts = dial.filter((a) => a !== "-o");
    expect(new Set(opts).size).toBe(opts.length);
  });

  it("names the SAME socket as the env form nix's own ssh reads", () => {
    expect(sshOpts(sshDialOpts(CI_KEEPALIVE)).ControlPath).toBe(
      sshOpts(nixSshOpts(CI_KEEPALIVE)).ControlPath,
    );
  });
});

/** Assert an ssh argv carries the P2.8 ControlMaster multiplexing opts, on the
 *  socket that belongs to `keepalive` (the master's opener fixes `ServerAlive*`
 *  for its whole lifetime, so the socket is keyed by the policy). */
function assertMultiplex(
  rendered: readonly string[] | string,
  keepalive: SshKeepalive = DEFAULT_SSH_KEEPALIVE,
): void {
  const opts = sshOpts(rendered);
  expect(opts.ControlMaster).toBe("auto");
  expect(opts.ControlPersist).toBe("10m");
  // The leaf is spelled by `policyTag`, the same function `controlOptPairs`
  // names the socket with — never re-derived here from the policy's fields.
  expect(opts.ControlPath?.endsWith(socketLeaf(keepalive))).toBe(true);
}

describe("ssh multiplexing (ControlMaster)", () => {
  it("rides one shared master: the agent dial AND the probe carry the opts", () => {
    assertMultiplex(
      buildAgentCommand({
        host: "bob.example",
        agentPath: "/nix/store/x-agent",
        binary: "my-agent",
        localEnv: {},
      }).args,
    );
    assertMultiplex(
      buildSshProbeCommand("bob.example", "nix-store", "--realise", "x").args,
    );
  });

  it("remote-store Nix's ssh fork targets the SAME socket (env form == argv form)", () => {
    const argvPath = sshOpts(
      buildAgentCommand({
        host: "bob.example",
        agentPath: "/nix/store/x-agent",
        binary: "my-agent",
        localEnv: {},
      }).args,
    ).ControlPath;
    const envOpts = sshOpts(nixSshOpts());
    expect(envOpts.ControlMaster).toBe("auto");
    // One source of truth: nix's NIX_SSHOPTS and our argv name one socket,
    // so the ssh-ng fork rides the master the probe opened, not a new one.
    expect(envOpts.ControlPath).toBe(argvPath);
    // …and it still word-splits cleanly to carry the dead-peer keepalive.
    assertKeepAlive(nixSshOpts());
  });

  it("never emits an `-O exit`/control command — stale recovery is ssh's `auto`", () => {
    // Locks decision 3: with cross-invocation ControlPersist, teardown must
    // NOT kill the master. The builders only ever SET UP multiplexing
    // (ControlMaster=auto); they never issue `ssh -O exit`/`-O check`, so a
    // future change can't silently start reaping the warm master.
    for (const args of [
      buildAgentCommand({
        host: "h",
        agentPath: "/nix/store/x-agent",
        binary: "a",
        localEnv: {},
      }).args,
      buildSshProbeCommand("h", "nix-store", "--realise", "x").args,
    ]) {
      expect(args).not.toContain("-O");
      expect(args).not.toContain("exit");
      expect(sshOpts(args).ControlMaster).toBe("auto");
    }
  });

  it("degrades uniformly: a non-private control dir refuses multiplexing everywhere", () => {
    if (process.getuid === undefined) return; // no uid semantics — skip
    // Re-point XDG at a dir whose computed control dir is pre-created loose.
    const xdg = namedControlDir("kolu-ssh-loose");
    const dir = join(xdg, "kolu-ssh");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755); // group/other bits → not owner-only
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();

    const probe = sshOpts(
      buildSshProbeCommand("h", "nix-store", "--realise", "x").args,
    );
    const dial = sshOpts(
      buildAgentCommand({
        host: "h",
        agentPath: "/p",
        binary: "a",
        localEnv: {},
      }).args,
    );
    const env = sshOpts(nixSshOpts());
    for (const opts of [probe, dial, env]) {
      // One memoized source degrades every renderer at once: keepalive
      // survives, and multiplexing is REFUSED everywhere — explicitly, as
      // ControlPath=none rather than by emitting nothing (NO_MULTIPLEXING in
      // controlMaster.ts argues why silence would be worse than either).
      expect(opts.BatchMode).toBe("yes");
      expect(opts.ControlMaster).toBe("no");
      expect(opts.ControlPath).toBe("none");
      expect(opts.ControlPersist).toBeUndefined();
    }
  });
});
