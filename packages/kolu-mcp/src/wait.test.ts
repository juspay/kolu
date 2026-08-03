/**
 * `awaitOutputSettled` — the MCP face's idle done-signal over padiSurface,
 * driven through a fake snapshot-then-delta client (the same harness shape
 * padi-tui's read.test uses). Pins the outcome matrix: idle-met, gone via the
 * exit event, gone via feed-end + absent key, closed via feed-end + present
 * key (loud, never a false met), and timeout. Plus the tool's JSON frame.
 */
import { awaitOutputSettled, type PadiSurfaceClient } from "@kolu/padi/dial";
import { SurfaceStdioTransportClosed } from "@kolu/surface/errors";
import { type Cause, Effect, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { waitJson, waitOutputSettledTool } from "./wait.ts";

type AttachFrame =
  | { kind: "snapshot"; data: string; topLine: number }
  | { kind: "delta"; data: string };

/** A pushable source: each subscriber replays the queued frames, then receives
 *  every later `push`, and completes on `end()`.
 *
 *  A member verb now hands back a LAZY `Stream` and takes no `AbortSignal`
 *  (D10/#18), so the fake mints one subscription per call and teardown is the
 *  consumer INTERRUPTING it (`iterateUntilAborted`'s `iter.return()`) — which
 *  closes the stream's scope and runs the release below. It is a `Stream.callback`
 *  rather than an async generator for exactly that reason: a generator parked in
 *  `await` cannot be resumed by `return()`, so an interrupt would never unwind
 *  and `runWait` (which awaits its watchers) would hang. `torn` records the
 *  releases so a test can assert a subscription was actually let go. */
class FakeStream<T> {
  private readonly frames: T[] = [];
  private readonly live = new Set<Queue.Queue<T, Cause.Done>>();
  private ended = false;
  /** How many subscriptions the CONSUMER released (not ended by `end()`). */
  torn = 0;
  push(v: T): void {
    this.frames.push(v);
    for (const q of this.live) Queue.offerUnsafe(q, v);
  }
  end(): void {
    this.ended = true;
    for (const q of this.live) Queue.endUnsafe(q);
    this.live.clear();
  }
  /** The lazy `Stream` a member verb hands back. */
  stream(): Stream.Stream<T> {
    return Stream.callback<T>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          for (const frame of this.frames) Queue.offerUnsafe(queue, frame);
          if (this.ended) Queue.endUnsafe(queue);
          else this.live.add(queue);
        }),
        () =>
          Effect.sync(() => {
            if (this.live.delete(queue)) this.torn += 1;
          }),
      ),
    );
  }
}

function fakeClient(streams: {
  attach: FakeStream<AttachFrame>;
  exit: FakeStream<{ exitCode: number }>;
  keys: FakeStream<string[]>;
}): PadiSurfaceClient {
  return {
    surface: {
      terminalAttach: { get: () => streams.attach.stream() },
      terminalExit: { get: () => streams.exit.stream() },
      terminals: { keys: () => streams.keys.stream() },
    },
  } as unknown as PadiSurfaceClient;
}

const ID = "t1";
const snapshot: AttachFrame = { kind: "snapshot", data: "screen", topLine: 0 };

function streams(): {
  attach: FakeStream<AttachFrame>;
  exit: FakeStream<{ exitCode: number }>;
  keys: FakeStream<string[]>;
} {
  return {
    attach: new FakeStream<AttachFrame>(),
    exit: new FakeStream<{ exitCode: number }>(),
    keys: new FakeStream<string[]>(),
  };
}

describe("awaitOutputSettled — the idle done-signal over padiSurface", () => {
  it("resolves met once the window elapses after the snapshot", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 25,
    });
    expect(outcome).toMatchObject({ kind: "met", fired: "idle" });
  });

  it("a delta resets the window (settles only after true quiet)", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const started = Date.now();
    // Keep the terminal noisy for ~60ms, then go quiet.
    const noise = setInterval(
      () => s.attach.push({ kind: "delta", data: "x" }),
      15,
    );
    setTimeout(() => clearInterval(noise), 60);
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 40,
    });
    expect(outcome).toMatchObject({ kind: "met", fired: "idle" });
    // It cannot have settled before the noise stopped + the window: the last
    // delta lands at ≥45ms (ticks at 15/30/45), so met is ≥85ms — asserted
    // with a few ms of timer-jitter slack.
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
  });

  it("resolves gone the instant the exit event fires", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.exit.push({ exitCode: 0 });
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
    });
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a feed end with the id ABSENT from the roster is gone", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.keys.push([]); // the roster no longer carries t1
    s.attach.end();
    s.exit.end();
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
    });
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a feed end with the id STILL live is closed — loud, never a false met", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.keys.push([ID]); // still live: a dropped feed, not an exit
    s.attach.end();
    s.exit.end();
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
    });
    expect(outcome).toMatchObject({ kind: "closed" });
    if (outcome.kind === "closed") {
      expect(outcome.error).toMatch(/output feed/);
    }
  });

  it("PIN: the lost-feed membership read is BOUNDED — a silent keys stream never outlives the wait", async () => {
    // settleOnLostFeed's `terminals.keys` rides the SAME retry-mounted client as
    // the attach feed, so a wedged-but-alive link retries the snapshot forever.
    // Under oRPC the bound was an AbortSignal threaded into the read; a member
    // verb has no signal any more (D10/#18), so the bound is `ctx.signal`
    // INTERRUPTING the subscription. Same hazard, restated on the Effect axis:
    // the feed ends, `keys` never yields a snapshot, and the wait must still
    // settle on its timeout AND release the keys subscription.
    const s = streams();
    s.attach.push(snapshot);
    s.attach.end();
    s.exit.end();
    // `keys` is deliberately never pushed and never ended — the wedged read.
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
      timeoutMs: 50,
    });
    expect(outcome).toMatchObject({ kind: "timeout" });
    expect(s.keys.torn).toBe(1);
  });

  it("PIN: a DEAD-transport attach error PROPAGATES (rejects), never folds to closed", async () => {
    // A dead transport poisons the shared connection — it must reject out of
    // awaitOutputSettled so surface-mcp's withClient resets it, not settle a
    // clean `closed` that leaves the caller reusing a dead socket (codex F2).
    // The dead-transport vocabulary is now the shared TAGGED error (D4), not an
    // ORPCError code.
    const dead = new SurfaceStdioTransportClosed({ reason: "pipe closed" });
    const client = {
      surface: {
        terminalAttach: { get: () => Stream.fail(dead) },
        terminalExit: { get: () => Stream.fail(dead) },
        terminals: { keys: () => Stream.fail(dead) },
      },
    } as unknown as PadiSurfaceClient;
    await expect(
      awaitOutputSettled(client, { id: ID, idleMs: 800, timeoutMs: 5000 }),
    ).rejects.toBe(dead);
  });

  it("PIN: a non-positive / over-ceiling idleMs fails fast (RangeError)", async () => {
    // The exported primitive validates the timer range at its boundary — a
    // direct caller can't get a false near-instant met off an overflowed window
    // (codex F5).
    await expect(
      awaitOutputSettled(fakeClient(streams()), { id: ID, idleMs: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      awaitOutputSettled(fakeClient(streams()), {
        id: ID,
        idleMs: 2_147_483_648,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("resolves timeout when the terminal never settles", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const noise = setInterval(
      () => s.attach.push({ kind: "delta", data: "x" }),
      10,
    );
    try {
      const outcome = await awaitOutputSettled(fakeClient(s), {
        id: ID,
        idleMs: 60_000,
        timeoutMs: 50,
      });
      expect(outcome).toMatchObject({ kind: "timeout" });
    } finally {
      clearInterval(noise);
    }
  });
});

describe("waitJson — the wire envelope", () => {
  it("PIN: a met payload can never clobber the envelope's reserved keys", () => {
    // The met payload nests under `met` — a payload carrying `id`/`result`
    // keys serializes intact WITHOUT overwriting the envelope (the flat-spread
    // collision the review caught; nesting makes it inexpressible).
    const hostile = {
      kind: "met",
      id: "payload-id",
      result: "payload-result",
    } as const;
    const frame = waitJson("envelope-id", hostile as never);
    expect(frame.id).toBe("envelope-id");
    expect(frame.result).toBe("met");
    expect(frame.met).toMatchObject({
      id: "payload-id",
      result: "payload-result",
    });
  });
});

describe("waitOutputSettledTool — the JSON frame", () => {
  it("returns the uniform result frame (id + result + met detail)", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const result = (await Effect.runPromise(
      waitOutputSettledTool.handler(
        { id: ID, idleMs: 25 },
        fakeClient(s),
        undefined,
      ),
    )) as Record<string, unknown>;
    expect(result).toMatchObject({
      id: ID,
      result: "met",
      met: { fired: "idle" },
    });
    expect(typeof (result.met as { elapsedMs: unknown }).elapsedMs).toBe(
      "number",
    );
  });
});
