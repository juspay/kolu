/**
 * The RECONNECT-SNAPSHOT acceptance test (PLAN D3, review #12).
 *
 * #12 is the finding that made the retry fence a face concern: Effect RPC's
 * `retryTransientErrors` reconnects the SOCKET but re-issues nothing — the close of
 * an established socket fails every in-flight entry with an `RpcClientError` and no
 * layer re-subscribes. Everything the Solid bridge promises rests on the opposite
 * behaviour:
 *
 *   - `createSubscription`'s **change-iff-fired** law says an EQUAL reconnect
 *     snapshot must not fire `updated` — which presupposes that a reconnect
 *     produces a SNAPSHOT at all, not an error;
 *   - `client.health()` says a healthy surface reads healthy — which presupposes a
 *     transport drop never reaches `sub.error()`.
 *
 * So this file pins the observable contract, end to end through the real face over
 * a fake dispatch: **a mid-stream dispatch failure, then recovery, yields exactly
 * ONE fresh snapshot and NO error at the subscription.** It is deliberately written
 * against behaviour, not mechanism — `Stream.retry`, the schedule, and the
 * `Schedule.while` gate are all replaceable; this contract is not.
 *
 * The counterpart negative is here too: a DECLARED (D4) failure is NOT retried, so
 * it reaches `sub.error()` on its first occurrence. Without that arm, "retry
 * forever" would be indistinguishable from "swallow everything", and a dead surface
 * would read as a permanently-pending one.
 */

import { Effect, Schema, Stream } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { unenrolledStreamCall } from "../client";
import { defineSurface } from "../define";
import { SurfaceRelayTransportLost } from "../errors";
import type { SurfaceDispatch } from "../link";
import { runStreamScoped } from "../runStream";
import { surfaceClient } from "./surfaceClient";

const surface = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ n: Schema.Number }),
      default: { n: 0 },
      verbs: ["get"],
    },
  },
});

const CELL_GET = "surface/conn/get";

/** A transport failure shaped exactly as Effect RPC's own: recognised by `_tag`,
 *  not by class identity, because a real one crosses module instances (see
 *  `isTransportError`). Constructing it here rather than importing
 *  `RpcClientError` is deliberate — the fence must recognise the SHAPE, so a test
 *  that imported the class would prove less than the production path needs. */
class FakeTransportDrop extends Error {
  readonly _tag = "RpcClientError";
  constructor() {
    super("socket closed");
  }
}

/** An app-DECLARED failure the fence must never retry. */
class Denied extends Schema.TaggedError<Denied>("test/Denied")("Denied", {
  why: Schema.String,
}) {}

/** A dispatch whose cell stream is driven by `attempts`: attempt N runs
 *  `attempts[N-1]`, and the last entry repeats for any further attempt. Every
 *  subscribe (including each fence retry) pulls the next entry, so a test spells
 *  its scenario as a list of attempts rather than hand-holding a counter. */
function scriptedDispatch(
  attempts: ReadonlyArray<() => Stream.Stream<unknown, unknown>>,
): { dispatch: SurfaceDispatch; subscribes: () => number } {
  let subscribes = 0;
  const dispatch: SurfaceDispatch = {
    unary: () => Effect.succeed(undefined),
    stream: (tag) => {
      if (tag !== CELL_GET) return Stream.empty;
      // `Stream.suspend` so the attempt counter advances at SUBSCRIBE time — which
      // is what a retry does — rather than when the stream value is built.
      return Stream.suspend(() => {
        const at = Math.min(subscribes, attempts.length - 1);
        subscribes += 1;
        const make = attempts[at];
        if (make === undefined) throw new Error("no attempt scripted");
        return make();
      });
    },
  };
  return { dispatch, subscribes: () => subscribes };
}

/** Wait past the fence's fixed inter-attempt delay (`STREAM_RETRY_DELAY_MS`) plus
 *  scheduling slack. Real timers, not fake ones: the fence's delay is an Effect
 *  `Schedule`, and the point of this test is that the REAL wiring reconnects — a
 *  fake clock would prove the schedule was configured, not that a frame arrived. */
const waitPastRetry = () => new Promise((r) => setTimeout(r, 1400));
const flush = () => new Promise((r) => setTimeout(r, 30));

describe("reconnect snapshot (#12) — a mid-stream drop is invisible to the subscription", () => {
  it("yields EXACTLY ONE fresh snapshot after a transport drop, with no error surfaced", async () => {
    const { dispatch, subscribes } = scriptedDispatch([
      // Attempt 1: a snapshot, then the socket dies mid-stream.
      () =>
        Stream.concat(
          Stream.make({ n: 1 }),
          Stream.fail(new FakeTransportDrop()),
        ),
      // Attempt 2: a FRESH snapshot, then the stream stays open (a healthy cell
      // that simply hasn't published again).
      () => Stream.concat(Stream.make({ n: 2 }), Stream.never),
    ]);

    const outcome = await new Promise<{
      frames: unknown[];
      changes: number;
      error: Error | undefined;
      pending: boolean;
      subscribes: number;
      healthy: boolean;
    }>((resolve) => {
      createRoot(async (dispose) => {
        const client = surfaceClient(surface, dispatch);
        const cell = client.cells.conn.use();
        const frames: unknown[] = [];
        let changes = 0;
        // Track every value the subscription exposes, and every `updated` firing —
        // the change-iff-fired law's own channel, which is what a consumer like
        // Terminal.tsx resets on.
        cell.sub.updated?.((change) => {
          changes += 1;
          frames.push(change.next);
        });

        await flush();
        // The first snapshot is a value, not a change — so `frames` is still empty
        // and the accessor already reads it. CLONE it: the subscription writes
        // frames through Solid's `reconcile`, which ADOPTS a frame object and
        // mutates it on the next write, so a retained reference would silently
        // become the second snapshot (the same hazard `createUpdatedTracker` clones
        // for). Reading the value late is exactly what a consumer does NOT do; the
        // clone models the render that already happened.
        const first = JSON.parse(JSON.stringify(cell.value())) as unknown;

        await waitPastRetry();

        const health = client.health();
        resolve({
          frames: [first, ...frames],
          changes,
          error: cell.error(),
          pending: cell.pending(),
          subscribes: subscribes(),
          healthy: health.subs.every((s) => s.error === undefined),
        });
        dispose();
      });
    });

    // EXACTLY one fresh snapshot: the drop re-subscribed once, and the new stream
    // led with its snapshot. Two re-subscribes (a retry storm) or zero (a dead
    // subscription) both fail here.
    expect(outcome.subscribes).toBe(2);
    expect(outcome.frames).toEqual([{ n: 1 }, { n: 2 }]);
    expect(outcome.changes).toBe(1);
    // The drop NEVER reached the subscription: no error, and not stuck pending.
    expect(outcome.error).toBeUndefined();
    expect(outcome.pending).toBe(false);
    // …and therefore never reached the one health FACT either.
    expect(outcome.healthy).toBe(true);
  });

  it("retries the relay's transport-loss end too — the one framework error that is transient", async () => {
    const { dispatch, subscribes } = scriptedDispatch([
      () =>
        Stream.concat(
          Stream.make({ n: 1 }),
          Stream.fail(new SurfaceRelayTransportLost({ reason: "upstream" })),
        ),
      () => Stream.concat(Stream.make({ n: 2 }), Stream.never),
    ]);

    const outcome = await new Promise<{
      value: unknown;
      error: Error | undefined;
      subscribes: number;
    }>((resolve) => {
      createRoot(async (dispose) => {
        const client = surfaceClient(surface, dispatch);
        const cell = client.cells.conn.use();
        await waitPastRetry();
        resolve({
          value: cell.value(),
          error: cell.error(),
          subscribes: subscribes(),
        });
        dispose();
      });
    });

    expect(outcome.subscribes).toBe(2);
    expect(outcome.value).toEqual({ n: 2 });
    expect(outcome.error).toBeUndefined();
  });

  it("does NOT retry a DECLARED failure — it reaches the subscription's error() at once", async () => {
    const { dispatch, subscribes } = scriptedDispatch([
      () =>
        Stream.concat(
          Stream.make({ n: 1 }),
          Stream.fail(new Denied({ why: "nope" })),
        ),
      // Scripted but must never be reached: a declared error is the server's
      // answer, and repeating the call just repeats the answer.
      () => Stream.make({ n: 99 }),
    ]);

    const outcome = await new Promise<{
      value: unknown;
      error: Error | undefined;
      subscribes: number;
      healthy: boolean;
    }>((resolve) => {
      createRoot(async (dispose) => {
        const client = surfaceClient(surface, dispatch);
        const cell = client.cells.conn.use();
        await waitPastRetry();
        const health = client.health();
        resolve({
          value: cell.value(),
          error: cell.error(),
          subscribes: subscribes(),
          healthy: health.subs.every((s) => s.error === undefined),
        });
        dispose();
      });
    });

    expect(outcome.subscribes).toBe(1);
    // The last good frame is retained (the cell does not blank on failure) …
    expect(outcome.value).toEqual({ n: 1 });
    // … and the declared failure IS surfaced, tag intact, to both channels.
    expect(outcome.error).toBeInstanceOf(Denied);
    expect((outcome.error as Denied)._tag).toBe("Denied");
    expect(outcome.healthy).toBe(false);
  });
});

describe("the per-subscription onRetry tap (#8)", () => {
  // The tap is what a consumer clears derived state on — xterm's attach wipes the
  // terminal buffer, padi's watch disarms its idle timer — so its firing contract
  // is load-bearing in BOTH directions: it must fire before every re-subscribe (or
  // the fresh snapshot double-paints onto stale state), and it must NOT fire when
  // no re-subscribe follows (or a consumer clears its view and never gets it back).

  it("fires exactly once per retryable failure, before the re-subscribe", async () => {
    const { dispatch, subscribes } = scriptedDispatch([
      () =>
        Stream.concat(
          Stream.make({ n: 1 }),
          Stream.fail(new FakeTransportDrop()),
        ),
      () => Stream.concat(Stream.make({ n: 2 }), Stream.never),
    ]);
    const order: string[] = [];
    const stream = unenrolledStreamCall(
      (input: undefined) => dispatch.stream(CELL_GET, input),
      undefined,
      { onRetry: () => order.push("retry") },
    );
    const stop = runStreamScoped(stream, {
      onFrame: (frame) => order.push(`frame:${(frame as { n: number }).n}`),
      onEnd: () => order.push("end"),
      onFailure: (err) => order.push(`fail:${err.message}`),
    });
    await waitPastRetry();
    stop();
    // Before the re-subscribe, after the failed attempt's last frame — and exactly
    // once, not once per frame and not twice for one drop.
    expect(order).toEqual(["frame:1", "retry", "frame:2"]);
    expect(subscribes()).toBe(2);
  });

  it("a THROWING onRetry does not cost the re-subscribe — the promise holds", async () => {
    // kolu#2101 G8c. `onRetry` is CONSUMER code (kolu's terminal resets an
    // xterm; `surfaceClient`'s health hook flips `pending` back on and then
    // calls the caller's own hook under it), and consumer code throws — a
    // disposed xterm, a store read on an unmounted owner. Run bare in
    // `Effect.sync` that throw is a DEFECT, and `Stream.retry` retries FAILURES
    // only: the stream would die HERE, immediately after telling the consumer to
    // clear its view — the exact "cleared view and no new stream" state the
    // fence's own comment promises cannot happen.
    const { dispatch, subscribes } = scriptedDispatch([
      () =>
        Stream.concat(
          Stream.make({ n: 1 }),
          Stream.fail(new FakeTransportDrop()),
        ),
      () => Stream.concat(Stream.make({ n: 2 }), Stream.never),
    ]);
    const order: string[] = [];
    const stop = runStreamScoped(
      unenrolledStreamCall(
        (input: undefined) => dispatch.stream(CELL_GET, input),
        undefined,
        {
          onRetry: () => {
            order.push("retry");
            throw new Error("xterm: terminal has been disposed");
          },
        },
      ),
      {
        onFrame: (frame) => order.push(`frame:${(frame as { n: number }).n}`),
        onEnd: () => order.push("end"),
        onFailure: (err) => order.push(`fail:${err.message}`),
      },
    );
    await waitPastRetry();
    stop();
    // The fresh snapshot still arrives, and the stream is still alive.
    expect(order).toEqual(["frame:1", "retry", "frame:2"]);
    expect(subscribes()).toBe(2);
  });

  it("a consumer's throwing onRetry does not STRAND health at pending (#4)", async () => {
    // The same defect one layer up, where it is most visible: the health hook
    // sets `pending = true` BEFORE calling the consumer's hook, so a throw there
    // used to leave the subscription pending forever with no stream left to
    // deliver the frame that clears it — a permanently "connecting" dot over a
    // healthy server.
    const { dispatch } = scriptedDispatch([
      () =>
        Stream.concat(
          Stream.make({ n: 1 }),
          Stream.fail(new FakeTransportDrop()),
        ),
      () => Stream.concat(Stream.make({ n: 2 }), Stream.never),
    ]);

    const outcome = await new Promise<{ pending: boolean; frames: unknown[] }>(
      (resolve) => {
        createRoot(async (dispose) => {
          const client = surfaceClient(surface, dispatch);
          const frames: unknown[] = [];
          // `rawStream` is the site: it OWNS the health signals, sets
          // `pending = true` for the reconnect gap, and then calls the caller's
          // hook — under the same `Effect.sync` the fence runs.
          const health = client.rawStream(
            "conn-raw",
            (input: undefined) => dispatch.stream(CELL_GET, input),
            undefined,
            {
              onItem: (item) => frames.push(item),
              onRetry: () => {
                throw new Error("consumer onRetry exploded");
              },
            },
          );
          await waitPastRetry();
          resolve({ pending: health.pending(), frames });
          dispose();
        });
      },
    );

    expect(outcome.frames).toEqual([{ n: 1 }, { n: 2 }]); // the reconnect delivered
    expect(outcome.pending).toBe(false); // …and cleared the pending latch
  });

  it("does NOT fire for a failure the fence refuses to retry", async () => {
    const { dispatch } = scriptedDispatch([
      () => Stream.fail(new Denied({ why: "nope" })),
    ]);
    let retries = 0;
    const stop = runStreamScoped(
      unenrolledStreamCall(
        (input: undefined) => dispatch.stream(CELL_GET, input),
        undefined,
        { onRetry: () => (retries += 1) },
      ),
      { onFrame: () => {}, onEnd: () => {}, onFailure: () => {} },
    );
    await flush();
    stop();
    // A declared error reaches the consumer; there is no re-subscribe to prepare
    // for, so clearing derived state here would blank a view nothing refills.
    expect(retries).toBe(0);
  });
});
