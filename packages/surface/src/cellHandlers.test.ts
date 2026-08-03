/**
 * cellHandlers — server-side write-path behaviour.
 *
 * Coverage focus: `equals` dedup and `onWrite` side-effect hooks added in
 * support of cross-cell invariants (the kolu session cell uses `onWrite`
 * to cancel a competing autosave timer; `equals` to skip byte-identical
 * republishes that would remount a keyed `<Show>` in the client). Both
 * features must:
 *   - fire on every write verb: `set`, `patch`, `test__set`, and the
 *     server-internal `ctx.cells.<key>.set/patch` exposed by
 *     `implementSurface`.
 *   - run in the correct order: `equals` is the gate, `onWrite` only
 *     fires when the write actually lands.
 *   - default to legacy behaviour when not supplied (always publish, no
 *     side effect) so existing cells are unaffected.
 */

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { defineSurface } from "./define";
import { cell } from "./index";
import {
  type CellStore,
  type Channel,
  cellHandlers,
  implementSurfaceOnPublisher,
  inMemoryChannel,
} from "./server";

/** In-memory cell store + channel pair for handler-level tests. */
function makeFixture<T>(initial: T) {
  let value = initial;
  const store: CellStore<T> = {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
  const subscribers: ((v: T) => void)[] = [];
  const bus: Channel<T> = {
    publish(v) {
      for (const cb of subscribers) cb(v);
    },
    async *subscribe() {
      // Not exercised by these tests — handler-level dedup/onWrite
      // doesn't need a live subscription, only the publish side effect.
    },
    consume(handlers) {
      subscribers.push(handlers.onEvent);
      return () => {
        const i = subscribers.indexOf(handlers.onEvent);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
  };
  return { store, bus, getValue: () => value };
}

describe("cellHandlers: equals dedup", () => {
  it("skips store.set + bus.publish when next equals current", () => {
    const { store, bus } = makeFixture<{ n: number }>({ n: 1 });
    const setSpy = vi.spyOn(store, "set");
    const publishSpy = vi.spyOn(bus, "publish");
    const handlers = cellHandlers(
      cell({
        name: "c",
        schema: Schema.Struct({ n: Schema.Number }),
        default: { n: 0 },
      }),
      {
        store,
        bus,
        equals: (a, b) => a.n === b.n,
      },
    );

    Effect.runSync(handlers.set({ n: 1 }));
    expect(setSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();

    Effect.runSync(handlers.set({ n: 2 }));
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("dedup applies to test__set", () => {
    const { store, bus } = makeFixture<string>("a");
    const publishSpy = vi.spyOn(bus, "publish");
    const handlers = cellHandlers(
      cell({ name: "c", schema: Schema.String, default: "" }),
      {
        store,
        bus,
        equals: (a, b) => a === b,
      },
    );

    Effect.runSync(handlers.test__set("a"));
    expect(publishSpy).not.toHaveBeenCalled();

    Effect.runSync(handlers.test__set("b"));
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("dedup applies to patch via the merge fn's output", () => {
    const { store, bus } = makeFixture<{ a: number; b: number }>({
      a: 1,
      b: 2,
    });
    const publishSpy = vi.spyOn(bus, "publish");
    const handlers = cellHandlers<"c", { a: number; b: number }, { b: number }>(
      cell({
        name: "c",
        schema: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
        default: { a: 0, b: 0 },
      }),
      {
        store,
        bus,
        patch: (cur, p) => ({ ...cur, b: p.b }),
        equals: (x, y) => x.a === y.a && x.b === y.b,
      },
    );

    // Patch that leaves the value unchanged → deduped
    Effect.runSync(handlers.patch({ b: 2 }));
    expect(publishSpy).not.toHaveBeenCalled();

    // Patch that changes the value → publishes
    Effect.runSync(handlers.patch({ b: 3 }));
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("no equals → every write publishes (legacy behaviour preserved)", () => {
    const { store, bus } = makeFixture<{ n: number }>({ n: 1 });
    const publishSpy = vi.spyOn(bus, "publish");
    const handlers = cellHandlers(
      cell({
        name: "c",
        schema: Schema.Struct({ n: Schema.Number }),
        default: { n: 0 },
      }),
      {
        store,
        bus,
      },
    );

    Effect.runSync(handlers.set({ n: 1 }));
    Effect.runSync(handlers.set({ n: 1 }));
    Effect.runSync(handlers.test__set({ n: 1 }));
    expect(publishSpy).toHaveBeenCalledTimes(3);
  });
});

describe("cellHandlers: onWrite side effect", () => {
  it("fires after equals check, only on actual writes", () => {
    const { store, bus } = makeFixture<number>(1);
    const onWrite = vi.fn();
    const handlers = cellHandlers(
      cell({ name: "c", schema: Schema.Number, default: 0 }),
      {
        store,
        bus,
        equals: (a, b) => a === b,
        onWrite,
      },
    );

    Effect.runSync(handlers.set(1)); // dedup'd
    expect(onWrite).not.toHaveBeenCalled();

    Effect.runSync(handlers.set(2));
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledWith(2);
  });

  it("fires on every write verb", () => {
    const { store, bus } = makeFixture<{ n: number }>({ n: 0 });
    const onWrite = vi.fn();
    const handlers = cellHandlers<"c", { n: number }, { n: number }>(
      cell({
        name: "c",
        schema: Schema.Struct({ n: Schema.Number }),
        default: { n: 0 },
      }),
      {
        store,
        bus,
        patch: (_cur, p) => p,
        onWrite,
      },
    );

    Effect.runSync(handlers.set({ n: 1 }));
    Effect.runSync(handlers.patch({ n: 2 }));
    Effect.runSync(handlers.test__set({ n: 3 }));
    expect(onWrite).toHaveBeenCalledTimes(3);
    expect(onWrite.mock.calls.map((c) => c[0])).toEqual([
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);
  });

  it("fires before store.set + bus.publish", () => {
    // Order matters for the autosave-cancel use case: the side effect
    // must establish its invariant (cancel pending timer) BEFORE the
    // cell's new value is observable to subscribers.
    const { store, bus } = makeFixture<number>(0);
    const calls: string[] = [];
    const _setSpy = vi
      .spyOn(store, "set")
      .mockImplementation(() => calls.push("store.set"));
    const _publishSpy = vi
      .spyOn(bus, "publish")
      .mockImplementation(() => calls.push("bus.publish"));
    const handlers = cellHandlers(
      cell({ name: "c", schema: Schema.Number, default: 0 }),
      {
        store,
        bus,
        onWrite: () => calls.push("onWrite"),
      },
    );

    Effect.runSync(handlers.set(1));
    expect(calls).toEqual(["onWrite", "store.set", "bus.publish"]);
  });
});

describe("implementSurface: ctx.cells.<key>.set respects equals + onWrite", () => {
  it("server-internal set is dedup'd and triggers onWrite", () => {
    const surface = defineSurface({
      cells: {
        c: {
          schema: Schema.Struct({ n: Schema.Number }),
          default: { n: 0 },
        },
      },
    });
    const { store, bus } = makeFixture<{ n: number }>({ n: 0 });
    const publishSpy = vi.spyOn(bus, "publish");
    const onWrite = vi.fn();

    // A caller-owned channel factory (via the OnPublisher constructor) so the
    // test can observe the internal publish on the same `bus` it spies.
    const { ctx } = implementSurfaceOnPublisher(
      surface,
      {
        cells: {
          c: {
            store,
            equals: (a, b) => a.n === b.n,
            onWrite,
          },
        },
      },
      <T>(_name: string) => bus as unknown as Channel<T>,
    );

    // No-op write — dedup'd, onWrite not invoked
    ctx.cells.c.set({ n: 0 });
    expect(publishSpy).not.toHaveBeenCalled();
    expect(onWrite).not.toHaveBeenCalled();

    // Real change — publishes, onWrite fires
    ctx.cells.c.set({ n: 1 });
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledWith({ n: 1 });
  });
});

describe("cellHandlers: an AUTHORING cell's `get` is subscribe-before-snapshot", () => {
  it("delivers a write that lands DURING the snapshot read (no lost-update gap)", async () => {
    // The sharpest probe of "subscribe strictly precedes snapshot", the cell twin
    // of the collection `deltas`/`keys` pins: write from INSIDE the snapshot read.
    // With subscribe-AFTER-snapshot the publish hits zero subscribers, and — a
    // cell being state, not a log — nothing ever re-states it: the consumer is
    // stuck on the snapshot forever and `Stream.take(2)` hangs.
    //
    // This is not hypothetical. It is how kolu-server's re-served mirror froze on
    // padi's baked `newTerminalPolicy` default across a padi respawn: the policy
    // push lands in exactly this window, and the cell never moves again.
    let value = "a";
    const bus = inMemoryChannel<string>();
    let subscribersDuringSnapshot = -1;
    let armed = true;
    const store: CellStore<string> = {
      get: () => {
        if (armed) {
          armed = false;
          subscribersDuringSnapshot = bus.subscriberCount();
          value = "b";
          bus.publish("b");
        }
        return value;
      },
      set: (v) => {
        value = v;
      },
    };
    const handlers = cellHandlers(
      cell({ name: "c", schema: Schema.String, default: "" }),
      { store, bus },
    );

    const frames = await Effect.runPromise(
      Stream.runCollect(Stream.take(handlers.get(), 2)),
    );

    // The subscriber was ALREADY live while the snapshot was being read…
    expect(subscribersDuringSnapshot).toBe(1);
    // …so TWO frames arrived. (The snapshot itself already reflects the write —
    // the documented, benign double-delivery of subscribe-before-snapshot; a cell
    // frame is a full replacement, so a repeat folds idempotently. What must never
    // happen is the second frame going missing.)
    expect(frames.length).toBe(2);
    expect(frames[1]).toBe("b");
    // …and the subscription is released once the stream ends.
    expect(bus.subscriberCount()).toBe(0);
  });
});
