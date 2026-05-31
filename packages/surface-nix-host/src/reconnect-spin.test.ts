/**
 * Regression: the reconnect bridge loop must not busy-spin after a
 * connected link drops.
 *
 * The client is an oRPC proxy that intercepts `.then` as a procedure path,
 * so it is *thenable*: `await session.currentClient()` re-invokes it and
 * yields a fresh object every call. A `waitForNextClient` that compared the
 * awaited *client* by identity therefore resolved on every consumer
 * iteration; once the stdio link fails fast (#1060) instead of hanging, the
 * consumer loop spun at CPU speed — pegging the event loop so the child
 * `exit` handler and reconnect-backoff timer never ran. `waitForNextClient`
 * now keys on the `clientPromise` identity (stable per spawn), so the loop
 * blocks until a real reconnect.
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
import type { AgentClient } from "./hostSession";
import { HostSession } from "./hostSession";
import { provisionAgent } from "./nixCopy";
import { makeClientCursor } from "./waitForNextClient";

vi.mock("./nixCopy", () => ({ provisionAgent: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const contract = {
  tick: oc
    .input(z.object({}))
    .output(eventIterator(z.object({ n: z.number() }))),
};

// A child that serves a real agent (so the pump gets a first yield and the
// consumer calls `markConnected`), then drops its link by ending the
// agent's stdout — WITHOUT emitting a child `exit` (mirrors an ssh pipe
// whose stdout closes while the bridge is mid-loop, the case that pegged
// the event loop so the real `exit` could never be delivered).
function flakyChild(liveMs: number) {
  const pair = createLoopbackPair();
  const t = implement(contract);
  const router = t.router({
    tick: t.tick.handler(async function* () {
      yield { n: 0 };
      await new Promise((r) => setTimeout(r, 60_000));
    }),
  });
  void serveOverStdio({ router, transport: pair.server });

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
  let session: HostSession<typeof contract>;

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
    session = new HostSession<typeof contract>({
      host: "testhost",
      resolveDrvPath: () => Promise.resolve("/nix/store/deadbeef-agent.drv"),
      binary: "agent",
      reconnectDelayMs: 50,
    });
    session.pin().catch(() => {});

    // The cursor threads the spawn-identity token internally, so this loop is
    // the exact shape a real consumer writes. If the fix regressed (comparing
    // the thenable client instead of the clientPromise), `next()` would
    // resolve every iteration and the count would explode into the thousands.
    const cursor = makeClientCursor(session);
    let iterations = 0;
    const deadline = Date.now() + 500;
    while (!session.isDestroyed() && Date.now() < deadline) {
      let client: AgentClient<typeof contract>;
      try {
        client = await cursor.next();
      } catch {
        break;
      }
      iterations += 1;
      try {
        // biome-ignore lint/suspicious/noExplicitAny: proxy call in a repro
        for await (const _ of await (client as any).tick({})) {
          session.markConnected();
        }
      } catch {
        /* link drop surfaces as rejection */
      }
    }

    // A sane reconnect cadence is a handful of attempts in 500ms; the
    // pre-fix busy-spin did tens of thousands.
    expect(iterations).toBeLessThan(50);
  });
});
