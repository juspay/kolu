/**
 * Seam-note rule 3, end to end: NOTHING kolu passes into the engine may throw.
 *
 * `reactorEngineLaws.test.ts` MEASURES what the raw engine does when a callback
 * throws mid-drain (the throw escapes the batch; every subscriber ordered after
 * the thrower loses that frame). This file pins that kolu's WRAPPER layer never
 * lets that happen in the first place — the defense the deploy-#2 freeze bought
 * (juspay/kolu#2101 G6).
 *
 * Each test drives a REAL surface: a derived cell publishing through the real
 * write gate into the real in-memory channel, with a real subscriber that throws.
 * Pre-defense every one of them fails with the frozen shape — the throw escaping
 * onto the writer's stack and a sibling silently missing the frame.
 */

import { Effect, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineSurface } from "./define";
import { derived, source } from "./reactor";
import { implementSurface, inMemoryChannel, inMemoryStore } from "./server";

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

let errors: unknown[][];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("nothing kolu hands the engine may throw (seam-note rule 3)", () => {
  it("a THROWING subscriber-side callback is contained: `publish` returns and siblings still get the frame", async () => {
    // The incident's inner shape at the layer kolu owns. `publish` fans out
    // SYNCHRONOUSLY on the writer's stack — in production, a reactor rebuild
    // inside the batch drain. The reachable synchronous callback inside one
    // subscriber's `push` is the bounded queue's `onOverflow` hook, so that is
    // what this injects: one subscriber whose hook throws, and a second, healthy
    // subscriber registered after it.
    let boom = false;
    const overflowing = inMemoryChannel<number>({
      highWaterMark: 1,
      overflow: "drop-oldest",
      onOverflow: () => {
        if (boom) throw new Error("overflow hook boom");
      },
    });
    const seen: number[] = [];
    // A parked consumer on a SECOND channel stands in for the sibling members a
    // real publish fans out to; the assertion that matters is that the throwing
    // channel's `publish` neither throws nor stops.
    const healthy = inMemoryChannel<number>();
    void (async () => {
      for await (const v of healthy.subscribe(undefined)) seen.push(v);
    })().catch(() => {});
    await flush();

    // A subscriber that is REGISTERED but not pulling: take one frame, then stop
    // asking. Further publishes queue, and past `highWaterMark` they overflow —
    // which is what runs the throwing hook on the publisher's stack.
    const consumer = overflowing.subscribe(undefined)[Symbol.asyncIterator]();
    const first = consumer.next();
    overflowing.publish(1);
    await first;
    overflowing.publish(2); // queued (queue length 1 = the mark)

    boom = true;
    // PRE-DEFENSE this throws out of `publish` — onto whatever wrote, which is
    // the drain.
    expect(() => {
      overflowing.publish(3);
      healthy.publish(3);
    }).not.toThrow();
    boom = false;
    await flush();

    // The sibling channel's frame landed despite the throwing hook, and the
    // containment was loud.
    expect(seen).toEqual([3]);
    expect(errors.some((args) => String(args[0]).includes("CONTAINED"))).toBe(
      true,
    );

    // The throwing channel is not wedged either.
    overflowing.publish(4);
    healthy.publish(4);
    await flush();
    expect(seen).toEqual([3, 4]);
  });

  it("a derived cell whose PUBLISH throws: the write returns, the throw is logged, later frames still publish", async () => {
    // `connectPublishEffect`'s publish half — the fan-out `set(next)` drives. Its
    // throw runs inside the effect body, i.e. inside the drain, so it is the
    // graph-severing shape. Contained + logged + healing.
    let tick!: () => void;
    let value = 1;
    const src = source({
      label: "stampedeCell",
      read: () => Promise.resolve(value),
      install: (t) => {
        tick = t;
        return () => {};
      },
    });
    const surface = defineSurface({
      cells: {
        counter: {
          schema: Schema.Number,
          default: -1,
          equals: (a: number, b: number) => a === b,
          verbs: ["get"],
        },
      },
    });
    let boom = false;
    const seen: number[] = [];
    const { ctx, done } = implementSurface(surface, {
      cells: {
        counter: {
          ...derived.cell(src),
          // A write hook that throws — the shape of a bus subscriber, an onWrite
          // hook, or a reconcile publisher failing mid-drain.
          onWrite: (next: number) => {
            seen.push(next);
            if (boom) throw new Error("publish boom");
          },
        },
      },
    });
    let doneRejection: unknown;
    done.catch((err: unknown) => {
      doneRejection = err;
    });
    await flush();
    expect(seen).toEqual([1]);

    // The throwing publish: contained, logged, and the runtime survives.
    boom = true;
    value = 2;
    tick();
    await flush();
    boom = false;
    expect(
      errors.some((args) => String(args[0]).includes("a cell onWrite hook")),
    ).toBe(true);
    expect(doneRejection).toBeUndefined();

    // The cell is not wedged: the NEXT tick publishes normally.
    value = 3;
    tick();
    await flush();
    expect(seen).toEqual([1, 2, 3]);
    expect(ctx.cells.counter.get()).toBe(3);
  });

  it("a STAMPEDE of writes survives one throwing subscriber — every other member still updates", async () => {
    // The mandated wrapper-level shape: N members updating in one burst with one
    // of them throwing on publish. Pre-defense the throw escapes into the writer
    // and the members after it in the fan-out never see that frame.
    const N = 24;
    const surface = defineSurface({
      cells: {
        a: { schema: Schema.Number, default: 0, verbs: ["get"] },
        b: { schema: Schema.Number, default: 0, verbs: ["get"] },
      },
      events: {
        tick: { inputSchema: Schema.String, outputSchema: Schema.Number },
      },
    });
    let boom = false;
    const aSeen: number[] = [];
    const bSeen: number[] = [];
    const runtime = implementSurface(surface, {
      cells: {
        a: {
          store: inMemoryStore(0),
          onWrite: (v: number) => {
            aSeen.push(v);
            if (boom) throw new Error("member a publish boom");
          },
        },
        b: {
          store: inMemoryStore(0),
          onWrite: (v: number) => {
            bSeen.push(v);
          },
        },
      },
      events: { tick: {} },
    });
    // A live stream subscriber across the whole stampede — the "attach stream"
    // bystander.
    const frames = Effect.runPromise(
      Stream.runCollect(
        Stream.take(
          runtime.handlers["surface/tick/get"]?.("t1") as Stream.Stream<number>,
          2,
        ),
      ),
    ) as unknown as Promise<number[]>;
    await flush();
    runtime.ctx.events.tick.publish("t1", 0);

    boom = true;
    for (let i = 1; i <= N; i++) {
      // Each write must return normally even though `a`'s hook throws.
      expect(() => {
        runtime.ctx.cells.a.set(i);
        runtime.ctx.cells.b.set(i);
      }).not.toThrow();
    }
    boom = false;

    // `b` — the bystander member — saw every frame of the stampede.
    expect(bSeen).toHaveLength(N);
    expect(bSeen.at(-1)).toBe(N);
    // `a` kept accepting writes too (its store is authoritative; only its hook
    // threw), and heals immediately.
    runtime.ctx.cells.a.set(999);
    expect(runtime.ctx.cells.a.get()).toBe(999);
    // The live stream never noticed.
    runtime.ctx.events.tick.publish("t1", 1);
    expect(await frames).toEqual([0, 1]);
    // Every containment was LOUD.
    expect(errors.length).toBeGreaterThan(0);
  });
});
