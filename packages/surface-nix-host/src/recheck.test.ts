/**
 * Coverage for `recheck()` — the wake / network-change companion to
 * `reconnect()`.
 *
 * The distinguishing behaviour, and the reason a plain `reconnect()` can't
 * stand in for it: after a laptop sleeps and reopens on a different network,
 * a `connected` link is *lying*. The far end dropped the TCP socket, but the
 * local ssh child won't notice until its keepalive fails ~30 s later, so the
 * session still reads `connected` with a live child and a non-null
 * `clientPromise`. `reconnect()` deliberately no-ops in that state (its guard
 * refuses to disturb a live link — it's the manual "Reconnect" button, only
 * meaningful from `failed`). `recheck()` instead force-cycles the child so
 * the reconnect loop re-establishes immediately rather than waiting for ssh
 * to time out.
 *
 * Mocks `node:child_process` + `nixCopy` (same approach as
 * `reconnect-spin.test.ts`) so no real ssh / `nix copy` runs.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { eventIterator, oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HostSession } from "./hostSession";
import { provisionAgent } from "./nixCopy";

vi.mock("./nixCopy", () => ({ provisionAgent: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const contract = {
  tick: oc
    .input(z.object({}))
    .output(eventIterator(z.object({ n: z.number() }))),
};

/** A child that serves a real agent over a loopback pair and stays alive
 *  until `kill()` is called, at which point it ends its stdout and emits
 *  the `exit` the session's reconnect path waits on — mirroring an ssh
 *  child cycled by `recheck`. `kill` is a spy so a test can assert the
 *  live link was actually force-cycled. */
function controllableChild() {
  const pair = createLoopbackPair();
  const t = implement(contract);
  const router = t.router({
    tick: t.tick.handler(async function* () {
      yield { n: 0 };
      await new Promise((r) => setTimeout(r, 600_000));
    }),
  });
  void serveOverStdio({ router, transport: pair.server });

  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = pair.client.write;
  child.stdout = pair.client.read;
  child.stderr = new PassThrough();
  child.pid = 1234;
  const kill = vi.fn(() => {
    pair.server.write.end();
    (child as unknown as EventEmitter).emit("exit", null, "SIGTERM");
    return true;
  });
  child.kill = kill;
  return { child, kill };
}

describe("HostSession.recheck", () => {
  let children: Array<{ kill: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/deadbeef-agent",
    } as never);
    children = [];
    vi.mocked(spawn).mockImplementation(() => {
      const { child, kill } = controllableChild();
      children.push({ kill });
      return child as never;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("force-cycles a live (connected) link and reconnects", async () => {
    const session = new HostSession<typeof contract>({
      host: "testhost",
      resolveDrvPath: () => Promise.resolve("/nix/store/deadbeef-agent.drv"),
      binary: "agent",
      reconnectDelayMs: 50,
    });

    session.pin().catch(() => {});
    // Flush the (resolved) resolve + provision microtasks so the first
    // child spawns and we enter `connecting`.
    await vi.advanceTimersByTimeAsync(1);
    expect(session.current().connection).toBe("connecting");
    // The bridge marks `connected` after the first RPC — simulate it so we
    // test the "seemingly-connected but actually stale" wake case.
    session.markConnected();
    expect(session.current().connection).toBe("connected");
    expect(spawn).toHaveBeenCalledTimes(1);

    // The wake signal. Unlike `reconnect()` (which would no-op on a live
    // link), `recheck()` must kill the current child…
    session.recheck();
    expect(children[0]?.kill).toHaveBeenCalledTimes(1);

    // …and the killed child's `exit` routes through the reconnect loop,
    // respawning after the (reset) backoff — a fresh ssh child.
    await vi.advanceTimersByTimeAsync(100);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(session.current().connection).toBe("connecting");

    session.destroy();
  });

  it("is a no-op on an unreferenced session (no spawn, no throw)", () => {
    const session = new HostSession<typeof contract>({
      host: "testhost",
      resolveDrvPath: () => Promise.resolve("/nix/store/deadbeef-agent.drv"),
      binary: "agent",
    });
    // Never pinned/acquired ⇒ refCount 0. A wake sweeping every host must
    // not spin up a session nobody asked for.
    session.recheck();
    expect(spawn).not.toHaveBeenCalled();
    session.destroy();
  });
});
