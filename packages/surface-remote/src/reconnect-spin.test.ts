/**
 * Regression: the reconnect bridge loop must not busy-spin after a
 * connected link drops.
 *
 * The original defect: the oRPC client was a proxy that intercepted `.then` as a
 * procedure path, so it was *thenable* — `await session.currentClient()`
 * re-invoked it and yielded a fresh object every call. A `waitForNextClient`
 * that compared the awaited *client* by identity therefore resolved on every
 * consumer iteration; once the stdio link failed fast (#1060) instead of hanging,
 * the consumer loop spun at CPU speed, pegging the event loop so the child
 * `exit` handler and reconnect-backoff timer never ran. `waitForNextClient` keys
 * on the `clientPromise` identity (stable per spawn) instead, so the loop blocks
 * until a real reconnect.
 *
 * The surface FACE is a plain object, so the thenable trap has no spelling any
 * more — but the LAW is the cursor's, not the client's, and this test still
 * measures it: a consumer loop over `cursor.next()` must make a handful of
 * attempts across a reconnect, never thousands.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { defineSurface } from "@kolu/surface/define";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { writeStdioReadiness } from "@kolu/surface/links/readiness";
import { serveOverStdio } from "@kolu/surface/peer-server";
import type { SurfaceClientLike } from "@kolu/surface/project";
import { implementSurface } from "@kolu/surface/server";
import { Effect, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directAgentDerivation } from "./agentDerivation";
import { provisionAgent } from "./nixCopy";
import { makeSession, type Session } from "./session";
import { type AgentClient, type SshProv, sshConnector } from "./sshConnector";
import { makeClientCursor } from "./waitForNextClient";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";

vi.mock("./nixCopy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nixCopy")>()),
  provisionAgent: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const tickSurface = defineSurface({
  streams: {
    tick: {
      inputSchema: Schema.Struct({}),
      outputSchema: Schema.Struct({ n: Schema.Number }),
    },
  },
});

/** Drain the face's `tick` stream to completion, swallowing the link-drop
 *  failure — the Effect-native form of the old `for await (… of client.tick({}))`.
 *  `onFirst` fires on the first frame (what the consumer marks connected on). */
async function drainTick(
  client: SurfaceClientLike,
  onFirst: () => void,
): Promise<void> {
  const tick = (
    client.surface as {
      tick: { get: (i: unknown) => Stream.Stream<unknown, unknown> };
    }
  ).tick;
  await Effect.runPromise(
    Stream.runForEach(tick.get({}), () => Effect.sync(onFirst)).pipe(
      Effect.ignore,
    ),
  );
}

// A child that serves a real agent (so the pump gets a first yield and the
// consumer calls `markConnected`), then drops its link by ending the
// agent's stdout — WITHOUT emitting a child `exit` (mirrors an ssh pipe
// whose stdout closes while the bridge is mid-loop, the case that pegged
// the event loop so the real `exit` could never be delivered).
function flakyChild(liveMs: number) {
  const pair = createLoopbackPair();
  const runtime = implementSurface(tickSurface, {
    streams: {
      tick: {
        source: () => Stream.concat(Stream.make({ n: 0 }), Stream.never),
      },
    },
  });
  void serveOverStdio({
    group: runtime.group,
    handlers: runtime.handlers,
    transport: pair.server,
  });
  // The agent GREETS before its first frame (juspay/kolu#2101) — this fake child
  // plays the part `serveOverStdio` plays for a real one.
  writeStdioReadiness(pair.server.write, { verdict: "ready" });

  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = pair.client.write;
  child.stdout = pair.client.read;
  child.stderr = new PassThrough();
  child.pid = 4321;
  child.kill = () => true;
  setTimeout(() => {
    pair.server.write.end(); // agent stdout EOF → link closed (fast-fail)
    // The ssh child also exits — which fires the session's reconnect path.
    // Pre-fix the busy-spin pegged the event loop so this `exit` could
    // never be delivered; post-fix the loop blocks, so it is.
    (child as unknown as EventEmitter).emit("exit", 1, null);
  }, liveMs);
  return child;
}

describe("reconnect bridge loop", () => {
  let session: Session<AgentClient, SshProv>;

  beforeEach(() => {
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/deadbeef-agent",
    } as never);
    vi.mocked(spawn).mockImplementation(() => flakyChild(40) as never);
  });
  afterEach(() => {
    session.destroy();
    vi.clearAllMocks();
  });

  it("does not busy-spin after a connected link drops", async () => {
    session = makeSession<AgentClient, SshProv>({
      initialConnection: "probing",
      connectOnce: sshConnector({
        surface: tickSurface,
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
      reconnectDelayMs: 50,
      label: "testhost",
    });
    session.pin().catch(() => {});

    // The cursor threads the spawn-identity token internally, so this loop is
    // the exact shape a real consumer writes. If the fix regressed (comparing
    // the thenable client instead of the clientPromise), `next()` would
    // resolve every iteration and the count would explode into the thousands.
    const cursor = makeClientCursor(session as unknown as Session);
    let iterations = 0;
    const deadline = Date.now() + 500;
    while (!session.isDestroyed() && Date.now() < deadline) {
      let client: SurfaceClientLike;
      try {
        client = await cursor.next();
      } catch {
        break;
      }
      iterations += 1;
      await drainTick(client, () => session.markConnected());
    }

    // A sane reconnect cadence is a handful of attempts in 500ms; the
    // pre-fix busy-spin did tens of thousands.
    expect(iterations).toBeLessThan(50);
  });

  it("destroy() during backoff unblocks a cursor.next() that is awaiting the next client (F7)", async () => {
    // The first spawn yields a live client (so the cursor advances past it), then
    // its link dies → the session drops into a LONG backoff with no spawn in
    // flight. A second `cursor.next()` then parks, waiting for the next client
    // that is 30s away. Only an `onState` publish re-checks `isDestroyed()`, and
    // pre-fix `destroy()` cleared timers WITHOUT publishing — so the park hung
    // forever (the F7 bug). Post-fix `destroy()` re-publishes state, so the
    // parked `next()` rejects and the pump loop can exit.
    vi.mocked(spawn).mockImplementation(() => flakyChild(40) as never);

    session = makeSession<AgentClient, SshProv>({
      initialConnection: "probing",
      connectOnce: sshConnector({
        surface: tickSurface,
        host: "destroyhost",
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
      // Long backoff so the second next() is genuinely parked, not racing a fast
      // respawn.
      reconnectDelayMs: 30_000,
      label: "destroyhost",
    });
    session.pin().catch(() => {});

    const cursor = makeClientCursor(session as unknown as Session);
    // Advance past the first spawn's live client and drain its stream until the
    // link dies — exactly what a real pump loop does. This leaves the session in
    // backoff with `clientPromise` cleared.
    const client = await cursor.next();
    await drainTick(client, () => session.markConnected());

    // Now park a SECOND next(): no spawn in flight (mid-backoff), so it blocks.
    const parked = cursor.next();
    // Let the backoff settle, then destroy.
    await new Promise((r) => setTimeout(r, 20));
    session.destroy();

    // The parked next() must REJECT (session destroyed), not hang. A bounded race
    // so a regression fails the test instead of hanging the whole suite.
    await expect(
      Promise.race([
        parked,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("cursor.next() hung")), 1000),
        ),
      ]),
    ).rejects.toThrow(/session destroyed/);
  });
});
