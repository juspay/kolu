/**
 * The agent dial's exit 255 is classified by what ssh SAID, and a stdout that
 * ends before the readiness banner defers to that classification.
 *
 * ssh prints its reason and exits; the child's stdout can END, and its `exit`
 * can fire, before that reason line reaches us. If the readiness gate convicted
 * a stream that ended as a `"remote"` fault, a host whose transport is merely
 * down would give up after five dials. Mocks `node:child_process` + `nixCopy`
 * (the `recheck.test.ts` harness), so no real ssh or Nix runs.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { defineSurface } from "@kolu/surface/define";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directAgentDerivation } from "./agentDerivation";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";
import { provisionAgent } from "./nixCopy";
import { makeSession } from "./session";
import { type AgentClient, type SshProv, sshConnector } from "./sshConnector";

vi.mock("./nixCopy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nixCopy")>()),
  provisionAgent: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const surface = defineSurface({
  streams: {
    tick: {
      inputSchema: Schema.Struct({}),
      outputSchema: Schema.Struct({ n: Schema.Number }),
    },
  },
});

/** A child that exits 255 and ends its stdout at once, and only THEN — inside
 *  the drain window — writes `stderrLine` (or nothing) and ends its stderr. */
function sshChild(stderrLine: string | null) {
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => true);
  setTimeout(() => {
    (child as unknown as EventEmitter).emit("exit", 255, null);
    stdout.end();
    setTimeout(() => {
      if (stderrLine !== null) stderr.write(`${stderrLine}\n`);
      stderr.end();
    }, 50);
  }, 1);
  return child;
}

function dial() {
  const session = makeSession<AgentClient, SshProv>({
    initialConnection: "probing",
    connectOnce: sshConnector({
      surface,
      host: "testhost",
      binary: "agent",
      localEnv: {},
      resolveDrvPath: () =>
        Promise.resolve(
          directAgentDerivation(
            "/nix/store/deadbeef-agent.drv",
            TEST_BINARY_CACHE,
          ),
        ),
    }),
    reconnectDelayMs: 100_000,
    liveness: false,
    label: "testhost",
  });
  session.pin().catch(() => {});
  return session;
}

describe("agent dial: exit 255 + stdout EOF, ssh's reason arriving late", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/deadbeef-agent",
    } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("ssh's late transport line makes it a network failure, not a remote one", async () => {
    vi.mocked(spawn).mockImplementation(
      () =>
        sshChild(
          "ssh: connect to host testhost port 22: Connection timed out",
        ) as never,
    );
    const session = dial();
    await vi.advanceTimersByTimeAsync(2_000);
    const st = session.currentState();
    expect(st.phase).toBe("disconnected");
    expect(st.phase === "disconnected" && st.cause).toBe("network");
    session.destroy();
  });

  it("a 255 with no ssh reason is the command's own exit — bounded remote", async () => {
    vi.mocked(spawn).mockImplementation(() => sshChild(null) as never);
    const session = dial();
    await vi.advanceTimersByTimeAsync(2_000);
    const st = session.currentState();
    expect(st.phase).toBe("disconnected");
    expect(st.phase === "disconnected" && st.cause).toBe("remote");
    session.destroy();
  });
});

describe("agent dial: a stderr the line reader cannot read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/deadbeef-agent",
    } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("an over-long newline-free stderr ends the owned transport, loudly — never a live child with an undrained pipe", async () => {
    const stderr = new PassThrough();
    const child = new EventEmitter() as unknown as Record<string, unknown>;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough(); // never greets
    child.stderr = stderr;
    const kill = vi.fn(() => {
      (child as unknown as EventEmitter).emit("exit", null, "SIGTERM");
      return true;
    });
    child.kill = kill;
    vi.mocked(spawn).mockImplementation(() => child as never);
    const lines: string[] = [];
    const session = dial();
    session.onState((st) => {
      for (const e of st.log) lines.push(e.line);
    });
    await vi.advanceTimersByTimeAsync(10);
    stderr.write("x".repeat(stderr.readableHighWaterMark * 2));
    await vi.advanceTimersByTimeAsync(10);
    expect(kill).toHaveBeenCalled();
    expect(lines.some((l) => /stderr could not be read as lines/.test(l))).toBe(
      true,
    );
    session.destroy();
  });
});
