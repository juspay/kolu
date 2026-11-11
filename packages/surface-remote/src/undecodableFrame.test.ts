/**
 * A malformed line mid-session must not strand a host.
 *
 * The shape this pins: a remote agent's stdout carries one line that is not a
 * protocol frame (a stray log write). Before the fix, Effect failed every call
 * in flight and KEPT the link, and the leg read those failures as a dead
 * transport. Every mirrored subscription then failed with a tag the retry fence
 * will not retry, the pump waited for a next spawn that never came (the link
 * was alive), and the liveness probe still answered — so the host showed
 * connected and served nothing until an operator removed and re-added it.
 *
 * Now the link ENDS on the bad line (`undecodableAware`, `@kolu/surface`), so
 * the session's own liveness probe meets a dead transport, force-cycles the
 * child, and the re-serve folds the agent's CURRENT state from the fresh link.
 * Measured here end to end, with the real pieces: `makeSession` +
 * `sshConnector` (over a mocked `spawn`, as `liveness.test.ts` does), a real
 * stdio link to a real served surface, `reServeSurface`, and a downstream
 * face. Fake timers drive the session's watchdog; the link bytes are real.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Transform } from "node:stream";
import { buildSurfaceFace } from "@kolu/surface/client";
import { defineSurface } from "@kolu/surface/define";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { directDispatch } from "@kolu/surface/links/direct";
import { writeStdioReadiness } from "@kolu/surface/links/readiness";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { Effect, Fiber, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directAgentDerivation } from "./agentDerivation";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";
import type * as NixCopy from "./nixCopy";
import { provisionAgent } from "./nixCopy";
import { type ReServedSurface, reServeSurface } from "./reServeSurface";
import { makeSession } from "./session";
import { type AgentClient, type SshProv, sshConnector } from "./sshConnector";

vi.mock("./nixCopy", async (importOriginal) => ({
  ...(await importOriginal<typeof NixCopy>()),
  provisionAgent: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const surface = defineSurface({
  cells: { v: { schema: Schema.Number, default: 0 } },
});

/** The agent's state, shared by every spawn — the remote box outlives a link. */
const agentStore = inMemoryStore(1);

/** Every spawned child's stdout passes through this; arming it turns the next
 *  `v` frame the agent writes into a line that is not a frame. */
let corruptNext = false;

function corruptingStdout(read: NodeJS.ReadableStream): Transform {
  let buffered = "";
  const out = new Transform({
    transform(chunk, _encoding, callback) {
      buffered += chunk.toString();
      let end = buffered.indexOf("\n");
      while (end !== -1) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        if (corruptNext && line.includes('"Chunk"')) {
          corruptNext = false;
          this.push("«a log line that escaped to stdout»\n");
        } else {
          this.push(`${line}\n`);
        }
        end = buffered.indexOf("\n");
      }
      callback();
    },
  });
  read.pipe(out);
  return out;
}

function agentChild() {
  const pair = createLoopbackPair();
  const { group, handlers } = implementSurface(surface, {
    cells: { v: { store: agentStore } },
  });
  void serveOverStdio({ group, handlers, transport: pair.server });
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = pair.client.write;
  child.stdout = corruptingStdout(pair.client.read);
  child.stderr = new PassThrough();
  // The agent greets before its first frame (juspay/kolu#2101).
  writeStdioReadiness(pair.server.write, { verdict: "ready" });
  child.kill = vi.fn(() => {
    pair.server.write.end();
    (child as unknown as EventEmitter).emit("exit", null, "SIGTERM");
    return true;
  });
  return child;
}

interface DownstreamFace {
  readonly surface: {
    readonly v: {
      readonly get: () => Stream.Stream<number, unknown>;
      readonly set: (v: number) => Effect.Effect<unknown, unknown>;
    };
  };
}

/** The downstream face over the re-serve — what a browser holds. */
function downstreamFace(
  served: ReServedSurface<typeof surface.spec>,
): DownstreamFace {
  return buildSurfaceFace(
    surface,
    directDispatch(served as never),
  ) as unknown as DownstreamFace;
}

/** A downstream subscriber that stays open — a browser tab watching `v`. It is
 *  what PINS the session (a re-serve dials only while someone is watching), and
 *  `latest()` is what that tab is showing. */
function watchV(face: DownstreamFace) {
  const seen: number[] = [];
  const fiber = Effect.runFork(
    Stream.runForEach(face.surface.v.get(), (v) =>
      Effect.sync(() => {
        seen.push(v);
      }),
    ),
  );
  return {
    latest: (): number | undefined => seen[seen.length - 1],
    stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
  };
}

describe("a malformed line mid-session (review: no half-alive host)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/x-agent",
    } as never);
    vi.mocked(spawn).mockImplementation(() => agentChild() as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("ends the link, and the host's mirrored state recovers without operator action", async () => {
    const session = makeSession<AgentClient, SshProv>({
      initialConnection: "probing",
      connectOnce: sshConnector({
        surface,
        host: "testhost",
        binary: "agent",
        localEnv: {},
        resolveDrvPath: () =>
          Promise.resolve(
            directAgentDerivation("/nix/store/x-agent.drv", TEST_BINARY_CACHE),
          ),
      }),
      reconnectDelayMs: 50,
      label: "testhost",
    });
    const served = reServeSurface({
      source: surface,
      policy: { v: "value" },
      session,
    });
    const face = downstreamFace(served);
    // A downstream subscriber is what pins the session and starts the mirror.
    const tab = watchV(face);
    await vi.advanceTimersByTimeAsync(100);
    expect(tab.latest()).toBe(1);
    expect(session.currentState().phase).toBe("connected");
    expect(spawn).toHaveBeenCalledTimes(1);

    // The agent's state moves (a write forwarded to it), and the frame that
    // carries the new value back arrives as garbage. The write itself may fail
    // with the link it rode; what matters is what the host shows afterwards.
    corruptNext = true;
    const write = Effect.runPromise(Effect.exit(face.surface.v.set(2)));
    await vi.advanceTimersByTimeAsync(10);
    expect(corruptNext).toBe(false);
    await write;

    // Within one watchdog cycle the session meets the dead link, cycles the
    // child, and the re-serve folds the agent's current value. No remove/add.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(tab.latest()).toBe(2);
    expect(session.currentState().phase).toBe("connected");

    await tab.stop();
    await served.close();
    session.destroy();
  });
});
