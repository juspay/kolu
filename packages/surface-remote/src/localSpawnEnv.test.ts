/**
 * PR1.5 (#1872 defense-in-depth) — the localhost arm of `sshConnector` must spawn
 * the agent with the CALLER-COMPOSED `localEnv`, NEVER the ambient `process.env`.
 *
 * The seam #1880 left: `spawn(command, args, { stdio })` with NO `env` option makes
 * Node inherit the caller's (kolu-server's) full env — the one path the ssh boundary
 * doesn't scrub, so a locally-hosted agent would silently inherit identity vars
 * (`CLAUDE_CODE_CHILD_SESSION`, …). This pin proves the localhost spawn now runs with
 * EXACTLY the composed `localEnv`, and that the ssh arm still inherits (its child is
 * the LOCAL ssh client, which legitimately needs `SSH_AUTH_SOCK` / `~/.ssh`).
 *
 * Mocks `node:child_process` + `nixCopy` (same approach as `liveness.test.ts`) so no
 * real ssh / remote-store Nix command runs; the connector is driven once with a no-op context.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { writeStdioReadiness } from "@kolu/surface/links/readiness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directAgentDerivation } from "./agentDerivation";
import { provisionAgent } from "./nixCopy";
import type { ConnectContext } from "./session";
import { type SshProv, sshConnector } from "./sshConnector";
import {
  TEST_AGENT_SURFACE,
  TEST_BINARY_CACHE,
} from "./agentDerivation.testutil";

vi.mock("./nixCopy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nixCopy")>()),
  provisionAgent: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

/** A fake child with open stdio — the connector wires `stdout`/`stdin` and asserts
 *  neither is null, so PassThroughs suffice. Never exits (no assertion needs it to). */
function fakeChild() {
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = new PassThrough();
  const stdout = new PassThrough();
  child.stdout = stdout;
  child.stderr = new PassThrough();
  child.pid = 4321;
  child.kill = vi.fn(() => true);
  // GREET (juspay/kolu#2101). The connector now waits for the agent's readiness
  // banner before it builds a link, so a fake agent that never speaks would park
  // this dial for the whole gate deadline. A real `--stdio` agent greets at boot;
  // so does this one.
  writeStdioReadiness(stdout, { verdict: "ready" });
  return child;
}

/** The connector only needs these hooks; none is asserted here. */
const noopCtx: ConnectContext<SshProv> = {
  localProgress: () => {},
  remoteProgress: () => {},
  provisioning: () => {},
  connecting: () => {},
  signal: new AbortController().signal,
  campaignEpoch: 0,
};

/** The `env` the connector handed `spawn` on its single call. */
function spawnEnv(): NodeJS.ProcessEnv | undefined {
  const call = vi.mocked(spawn).mock.calls[0];
  return (call?.[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env;
}

describe("sshConnector localhost arm env (PR1.5 / #1872)", () => {
  beforeEach(() => {
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/x-agent",
    } as never);
    vi.mocked(spawn).mockImplementation(() => fakeChild() as never);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("spawns localhost with EXACTLY the composed localEnv — never the ambient process.env", async () => {
    // An identity var #1872 forbids riding an ambient inherit into an agent: it is
    // present in the caller's env but MUST be absent from the composed `localEnv`.
    vi.stubEnv("CLAUDE_CODE_CHILD_SESSION", "1");
    const localEnv = { HOME: "/home/x", PATH: "/usr/bin" };
    const connector = sshConnector({
      surface: TEST_AGENT_SURFACE,
      host: "localhost",
      binary: "agent",
      resolveDrvPath: () =>
        Promise.resolve(
          directAgentDerivation("/nix/store/x-agent.drv", TEST_BINARY_CACHE),
        ),
      localEnv,
    });
    await connector(noopCtx);
    // The localhost child runs with the composed env verbatim …
    expect(spawnEnv()).toEqual(localEnv);
    // … so the ambient identity var never reaches the local spawn (the seam closed).
    expect(spawnEnv()).not.toHaveProperty("CLAUDE_CODE_CHILD_SESSION");
  });

  it("leaves the ssh arm's env undefined — the local ssh client inherits (SSH_AUTH_SOCK / ~/.ssh)", async () => {
    const connector = sshConnector({
      surface: TEST_AGENT_SURFACE,
      host: "bob.example",
      binary: "agent",
      resolveDrvPath: () =>
        Promise.resolve(
          directAgentDerivation("/nix/store/x-agent.drv", TEST_BINARY_CACHE),
        ),
      localEnv: { HOME: "/home/x", PATH: "/usr/bin" },
    });
    await connector(noopCtx);
    // No `env` override → Node inherits, which is correct for the LOCAL ssh client.
    expect(spawnEnv()).toBeUndefined();
  });
});
