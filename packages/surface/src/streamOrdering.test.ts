/**
 * The TWO OPPOSING ordering invariants `kill.feature` ("Natural PTY exit removes
 * terminal") pins, stated implementation-independently.
 *
 * Under the oRPC async-generator wire these two pulled in opposite directions,
 * and both were held by hand-tuned async hops:
 *
 *   (1) `publisherChannel`/`iterateUntilAborted` MUST add one microtask per
 *       yield, or a list-update publish racing a per-terminal exit publish could
 *       deliver the list message FIRST and the client's `removeAndAutoSwitch`
 *       would see an already-truncated list and pick the wrong active terminal;
 *   (2) `eventHandlers` MUST NOT wrap the source, or the extra async hop put the
 *       stream's "complete" frame AHEAD of its last yielded value and the value
 *       was dropped.
 *
 * A port that uniformly "preserves one microtask per yield" satisfies (1) and
 * breaks (2). So the SPEC is these two tests, not the mechanism:
 *
 *   (a) when two channels publish in the SAME TICK, delivery order at a consumer
 *       equals publish order;
 *   (b) a single-emission-then-complete event source delivers its value BEFORE
 *       end-of-stream.
 *
 * Whatever the streaming substrate — async generators, Effect `Stream`, anything
 * later — these must hold. Do not relax one to make the other pass; that is the
 * exact trade the e2e catches and these tests exist to catch first.
 */

import { Effect, Fiber, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import {
  implementSurface,
  inMemoryStore,
  type SurfaceHandlers,
} from "./server";

/** Read a streaming member's handler at its full wire tag. */
function streamAt(
  handlers: SurfaceHandlers,
  tag: string,
  payload?: unknown,
): Stream.Stream<unknown> {
  const handler = handlers[tag];
  if (!handler) throw new Error(`no handler bound at "${tag}"`);
  return handler(payload) as Stream.Stream<unknown>;
}

/** Let the macrotask queue drain — enough for every parked fiber to make
 *  progress, without pinning any particular number of microtask hops (which is
 *  precisely the mechanism these tests refuse to encode). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 10));

// ── (a) cross-channel delivery order equals publish order ──────────────

describe("stream ordering: two channels publishing in one tick", () => {
  it("delivers in publish order at the consumer (kill.feature: list-update before per-terminal exit)", async () => {
    // The kill.feature shape: a terminal-LIST cell and a per-terminal EXIT
    // event. These are two independent channels; the client folds the exit only
    // against a list that still contains the terminal.
    const surface = defineSurface({
      cells: {
        terminalList: {
          schema: Schema.Array(Schema.String),
          default: [] as readonly string[],
        },
      },
      events: {
        terminalExit: {
          inputSchema: Schema.String,
          outputSchema: Schema.Struct({ code: Schema.Number }),
        },
      },
    });
    const runtime = implementSurface(surface, {
      cells: {
        terminalList: {
          store: inMemoryStore<readonly string[]>(["t1", "t2"]),
        },
      },
      events: { terminalExit: {} },
    });

    const log: string[] = [];
    const listFiber = Effect.runFork(
      Stream.runForEach(
        streamAt(runtime.handlers, "surface/terminalList/get"),
        (v) =>
          Effect.sync(() => {
            log.push(`list:${JSON.stringify(v)}`);
          }),
      ),
    );
    const exitFiber = Effect.runFork(
      Stream.runForEach(
        streamAt(runtime.handlers, "surface/terminalExit/get", "t2"),
        (v) =>
          Effect.sync(() => {
            log.push(`exit:${JSON.stringify(v)}`);
          }),
      ),
    );

    // Both subscriptions must be LIVE before the racing publishes, or the test
    // would measure subscription latency instead of delivery order. The cell's
    // snapshot proves the cell leg; a warm-up publish proves the event leg.
    await settle();
    runtime.ctx.events.terminalExit.publish("t2", { code: 0 });
    await settle();
    expect(log).toEqual(['list:["t1","t2"]', 'exit:{"code":0}']);
    log.length = 0;

    // THE RACE: two channels, one synchronous tick, list first.
    runtime.ctx.cells.terminalList.set(["t1"]);
    runtime.ctx.events.terminalExit.publish("t2", { code: 137 });
    await settle();
    expect(log).toEqual(['list:["t1"]', 'exit:{"code":137}']);

    // …and the reverse order is equally preserved: the invariant is "delivery
    // order equals PUBLISH order", not "the cell always wins".
    log.length = 0;
    runtime.ctx.events.terminalExit.publish("t2", { code: 1 });
    runtime.ctx.cells.terminalList.set([]);
    await settle();
    expect(log).toEqual(['exit:{"code":1}', "list:[]"]);

    await Effect.runPromise(Fiber.interrupt(listFiber));
    await Effect.runPromise(Fiber.interrupt(exitFiber));
    await runtime.close();
  });
});

// ── (b) a single-emission source delivers before end-of-stream ─────────

describe("stream ordering: a single-emission-then-complete event source", () => {
  it("delivers its value BEFORE end-of-stream (kill.feature: the exit frame is not lost to completion)", async () => {
    // The natural-PTY-exit shape: the source emits exactly one occurrence and
    // then COMPLETES. Nothing may sit between the emission and the completion
    // that could let the completion overtake it.
    const surface = defineSurface({
      events: {
        terminalExit: {
          inputSchema: Schema.String,
          outputSchema: Schema.Struct({ code: Schema.Number }),
        },
      },
    });
    const runtime = implementSurface(surface, {
      events: {
        terminalExit: {
          source: (input) =>
            Stream.make({ code: input === "t2" ? 137 : 0 }) as Stream.Stream<{
              code: number;
            }>,
        },
      },
    });

    const observed: string[] = [];
    await Effect.runPromise(
      Stream.runForEach(
        streamAt(runtime.handlers, "surface/terminalExit/get", "t2"),
        (v) =>
          Effect.sync(() => {
            observed.push(`value:${JSON.stringify(v)}`);
          }),
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            observed.push("end-of-stream");
          }),
        ),
      ),
    );

    // The value is delivered, and it is delivered FIRST. A regression puts
    // "end-of-stream" first (or drops the value entirely) — both fail here.
    expect(observed).toEqual(['value:{"code":137}', "end-of-stream"]);
    await runtime.close();
  });

  it("delivers a channel-published occurrence that lands before the source completes", async () => {
    // The same invariant through the FRAMEWORK-OWNED event channel (no custom
    // source): a publish followed immediately by the consumer tearing down must
    // still have delivered the occurrence.
    const surface = defineSurface({
      events: {
        ping: {
          inputSchema: Schema.String,
          outputSchema: Schema.Number,
        },
      },
    });
    const runtime = implementSurface(surface, { events: { ping: {} } });

    const seen: number[] = [];
    const fiber = Effect.runFork(
      Stream.runForEach(
        streamAt(runtime.handlers, "surface/ping/get", "a"),
        (v) =>
          Effect.sync(() => {
            seen.push(v as number);
          }),
      ),
    );
    await settle();
    runtime.ctx.events.ping.publish("a", 1);
    runtime.ctx.events.ping.publish("a", 2);
    await settle();
    expect(seen).toEqual([1, 2]);
    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.close();
  });
});
