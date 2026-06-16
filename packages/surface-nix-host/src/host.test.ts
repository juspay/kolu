/**
 * Coverage for the ssh-argv builders in `./host`. The load-bearing
 * assertion is that the one-shot probe/realise command carries the same
 * dead-peer keepalive as the long-lived agent session: a `nix-store
 * --realise` over ssh is a remote *build*, and without keepalive a host
 * that degrades mid-build wedges the caller's spawn cycle forever (the
 * "stuck copying to remote for eternity" failure this guards against).
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetControlMemo } from "./controlMaster";
import {
  buildAgentCommand,
  buildSshProbeCommand,
  NIX_SSHOPTS,
  nixSshOpts,
} from "./host";

// Every spawned-ssh builder now appends the P2.8 ControlMaster opts, which
// mkdir a kolu-private control dir. Point that at a throwaway private tmp dir
// per test so the suite stays hermetic and the opts render deterministically
// (a real $XDG_RUNTIME_DIR may or may not be owner-only on a given box).
const tmpDirs: string[] = [];
beforeEach(() => {
  const xdg = mkdtempSync(join(tmpdir(), "kolu-ssh-host-test-"));
  tmpDirs.push(xdg);
  vi.stubEnv("XDG_RUNTIME_DIR", xdg);
  __resetControlMemo();
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetControlMemo();
  for (const d of tmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

/** Pull the `-o Key=Value` pairs out of an ssh argv into a lookup. */
function sshOpts(args: readonly string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const val = args[i + 1];
    if (args[i] === "-o" && val) {
      const [k, v] = val.split("=");
      opts[k ?? val] = v ?? "";
    }
  }
  return opts;
}

/** Assert an ssh argv carries the full shared dead-peer keepalive policy.
 *  One invariant ("every non-interactive ssh this package spawns carries
 *  `SSH_COMMON_OPTS`") asserted in one place, so re-tuning a keepalive
 *  value can't leave a second hand-synced block green on stale numbers. */
function assertKeepAlive(args: readonly string[]): void {
  const opts = sshOpts(args);
  expect(opts.BatchMode).toBe("yes");
  expect(opts.ServerAliveInterval).toBe("10");
  expect(opts.ServerAliveCountMax).toBe("3");
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

  it("wraps a remote command in ssh and forwards the remote argv verbatim", () => {
    const { command, args } = buildSshProbeCommand(
      "alice@bob.example",
      "nix-store",
      "--realise",
      "/nix/store/x-agent.drv",
    );
    expect(command).toBe("ssh");
    // host then remote argv, after the -o option block.
    expect(args.slice(-4)).toEqual([
      "alice@bob.example",
      "nix-store",
      "--realise",
      "/nix/store/x-agent.drv",
    ]);
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
  it("runs the binary directly for localhost", () => {
    const cmd = buildAgentCommand({
      host: "localhost",
      agentPath: "/nix/store/x-agent",
      binary: "my-agent",
    });
    expect(cmd).toEqual({
      command: "/nix/store/x-agent/bin/my-agent",
      args: ["--stdio"],
    });
  });

  it("wraps a remote agent in ssh with the shared keepalive opts", () => {
    const { command, args } = buildAgentCommand({
      host: "bob.example",
      agentPath: "/nix/store/x-agent",
      binary: "my-agent",
    });
    expect(command).toBe("ssh");
    expect(args.slice(-2)).toEqual([
      "/nix/store/x-agent/bin/my-agent",
      "--stdio",
    ]);
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
    });
    const sep = args.indexOf("--");
    expect(sep).toBeGreaterThanOrEqual(0);
    expect(args[sep + 1]).toBe(evil);
    expect(args.slice(0, sep)).not.toContain(evil);
  });
});

describe("NIX_SSHOPTS", () => {
  it("renders the same keepalive policy as the spawned-ssh argv", () => {
    // `nix copy --to ssh-ng://` forks its own ssh out of reach of our
    // argv; this env string is the only handle on its dead-peer
    // behaviour, so it must carry the identical policy. Parse it back
    // through the argv reader (NIX_SSHOPTS is word-split by nix) and
    // assert the same four flags the spawned ssh gets. (The const carries
    // the keepalive policy alone; `nixSshOpts()` is what additionally
    // carries the ControlMaster opts — asserted below.)
    assertKeepAlive(NIX_SSHOPTS.split(" "));
  });
});

/** Assert an ssh argv carries the P2.8 ControlMaster multiplexing opts. */
function assertMultiplex(args: readonly string[]): void {
  const opts = sshOpts(args);
  expect(opts.ControlMaster).toBe("auto");
  expect(opts.ControlPersist).toBe("10m");
  expect(opts.ControlPath?.endsWith("/%C")).toBe(true);
}

describe("ssh multiplexing (ControlMaster)", () => {
  it("rides one shared master: the agent dial AND the probe carry the opts", () => {
    assertMultiplex(
      buildAgentCommand({
        host: "bob.example",
        agentPath: "/nix/store/x-agent",
        binary: "my-agent",
      }).args,
    );
    assertMultiplex(
      buildSshProbeCommand("bob.example", "nix-store", "--realise", "x").args,
    );
  });

  it("nix copy's ssh fork targets the SAME socket (env form == argv form)", () => {
    const argvPath = sshOpts(
      buildAgentCommand({
        host: "bob.example",
        agentPath: "/nix/store/x-agent",
        binary: "my-agent",
      }).args,
    ).ControlPath;
    const envOpts = sshOpts(nixSshOpts().split(" "));
    expect(envOpts.ControlMaster).toBe("auto");
    // One source of truth: nix's NIX_SSHOPTS and our argv name one socket,
    // so the ssh-ng fork rides the master the probe opened, not a new one.
    expect(envOpts.ControlPath).toBe(argvPath);
    // …and it still word-splits cleanly to carry the dead-peer keepalive.
    assertKeepAlive(nixSshOpts().split(" "));
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
      }).args,
      buildSshProbeCommand("h", "nix-store", "--realise", "x").args,
    ]) {
      expect(args).not.toContain("-O");
      expect(args).not.toContain("exit");
      expect(sshOpts(args).ControlMaster).toBe("auto");
    }
  });

  it("degrades uniformly: a non-private control dir drops ALL control opts", () => {
    if (process.getuid === undefined) return; // no uid semantics — skip
    // Re-point XDG at a dir whose computed control dir is pre-created loose.
    const xdg = mkdtempSync(join(tmpdir(), "kolu-ssh-loose-"));
    tmpDirs.push(xdg);
    const dir = join(xdg, "kolu-ssh");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755); // group/other bits → not owner-only
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();

    const probe = sshOpts(
      buildSshProbeCommand("h", "nix-store", "--realise", "x").args,
    );
    const dial = sshOpts(
      buildAgentCommand({ host: "h", agentPath: "/p", binary: "a" }).args,
    );
    const env = sshOpts(nixSshOpts().split(" "));
    for (const opts of [probe, dial, env]) {
      // One memoized source degrades every renderer at once: keepalive
      // survives, multiplexing is dropped everywhere.
      expect(opts.BatchMode).toBe("yes");
      expect(opts.ControlMaster).toBeUndefined();
      expect(opts.ControlPath).toBeUndefined();
      expect(opts.ControlPersist).toBeUndefined();
    }
  });
});
