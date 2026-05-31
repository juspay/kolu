/**
 * Coverage for the ssh-argv builders in `./host`. The load-bearing
 * assertion is that the one-shot probe/realise command carries the same
 * dead-peer keepalive as the long-lived agent session: a `nix-store
 * --realise` over ssh is a remote *build*, and without keepalive a host
 * that degrades mid-build wedges the caller's spawn cycle forever (the
 * "stuck copying to remote for eternity" failure this guards against).
 */
import { describe, expect, it } from "vitest";
import { buildAgentCommand, buildSshProbeCommand, NIX_SSHOPTS } from "./host";

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
});

describe("NIX_SSHOPTS", () => {
  it("renders the same keepalive policy as the spawned-ssh argv", () => {
    // `nix copy --to ssh-ng://` forks its own ssh out of reach of our
    // argv; this env string is the only handle on its dead-peer
    // behaviour, so it must carry the identical policy. Parse it back
    // through the argv reader (NIX_SSHOPTS is word-split by nix) and
    // assert the same four flags the spawned ssh gets.
    assertKeepAlive(NIX_SSHOPTS.split(" "));
  });
});
