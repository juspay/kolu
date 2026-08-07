/**
 * `projectSurface` — deriving surface B from a live client of surface A.
 *
 * Surface A is an ordinary in-memory surface (a `count` cell + a `doubled`
 * stream of `count * 2` + a `pinged` event). Surface B is projected from A: a
 * `count1` cell that tracks A's `count` + 1 via `deriveCell`, a `quad` stream
 * that maps A's `doubled` * 2 via `deriveStream`, a `relayed` event that maps
 * A's `pinged` * 10 via `deriveEvent`, and a `bumpAndView` procedure that passes
 * through to A's `bump`. These tests pin that:
 *
 *   - B's cell snapshot reflects A's *current* value (snapshot, not just deltas);
 *   - mutating A propagates a mapped delta to B's cell;
 *   - B's stream yields mapped frames (snapshot-then-deltas preserved);
 *   - B's event relays mapped occurrences with no snapshot obligation;
 *   - INTERRUPTING a B stream subscription tears down the upstream A
 *     subscription with no leak and no unhandled rejection;
 *   - `surfaceClientRef` alone returns a working in-process client.
 *
 * The teardown law is stated on the fiber axis now, not the AbortSignal one
 * (D10): a `Stream`'s consumer cancels by interrupting its fiber, and the
 * upstream's finalizers run through the same interruption — the same fact the
 * `AbortController` used to carry, minus the signal.
 */

import { Effect, Exit, Fiber, Schema, Scope, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { defineSurface } from "./define";
import {
  deriveCell,
  deriveEvent,
  deriveStream,
  projectSurface,
  type SurfaceClientOf,
  surfaceClientRef,
} from "./project";
import type { InMemoryChannel, SurfaceCtx, SurfaceHandlers } from "./server";
import {
  implementSurface,
  inMemoryChannel,
  inMemoryStore,
  streamFromAbortableSource,
} from "./server";

// ── Surface A — the source ───────────────────────────────────────────────

// Hoisted to module scope so the (large) `SurfaceClientOf<…>` client unions are
// materialized from a single named `typeof` rather than re-instantiated at every
// test call site — TS's per-file union budget overflows otherwise.
const aSpec = {
  cells: {
    count: { schema: Schema.Number, default: 0 },
  },
  streams: {
    // snapshot-then-deltas: yields `count * 2` on subscribe, then every value
    // the test pushes onto the bus.
    doubled: {
      inputSchema: Schema.Void,
      outputSchema: Schema.Number,
    },
  },
  events: {
    // an occurrence per bump (no snapshot obligation) — drives `deriveEvent`.
    pinged: {
      inputSchema: Schema.Void,
      outputSchema: Schema.Number,
    },
  },
  procedures: {
    counter: {
      bump: { output: Schema.Number },
    },
  },
} as const;

type ASpec = typeof aSpec;
type AClient = SurfaceClientOf<ASpec>;

interface SourceA {
  surface: ReturnType<typeof defineSurface<ASpec>>;
  handlers: SurfaceHandlers;
  ctx: SurfaceCtx<ASpec>;
  doubledBus: InMemoryChannel<number>;
  countStore: ReturnType<typeof inMemoryStore<number>>;
}

function buildSourceA(): SourceA {
  const surface = defineSurface(aSpec);

  // A channel the test can publish to, to feed `doubled`'s deltas. A raw
  // `inMemoryChannel` (not via the by-name publisher) so the test can read
  // `subscriberCount()` to prove upstream teardown on interruption.
  const doubledBus = inMemoryChannel<number>();
  const countStore = inMemoryStore(0);

  const { handlers, ctx } = implementSurface(surface, {
    cells: {
      count: { store: countStore },
    },
    streams: {
      doubled: {
        // Snapshot first (lazily — `Stream.suspend`, so the read happens at
        // SUBSCRIBE time, not when the handler value was built), then the bus.
        // The bus subscription is a SCOPED resource of the stream
        // (`streamFromAbortableSource` — the framework's own producer-edge
        // bridge), so interrupting the consuming fiber drops it. That is exactly
        // what the teardown law below observes through `subscriberCount()`.
        source: () =>
          Stream.concat(
            Stream.suspend(() => Stream.make(countStore.get() * 2)),
            streamFromAbortableSource<number>((signal) =>
              doubledBus.subscribe(signal),
            ),
          ),
      },
    },
    procedures: {
      counter: {
        bump: ({ ctx }) =>
          Effect.sync(() => {
            const next = ctx.cells.count.get() + 1;
            ctx.cells.count.set(next);
            doubledBus.publish(next * 2);
            // fire the `pinged` event (void input) so a B subscriber to the
            // derived `relayed` event sees a mapped occurrence.
            ctx.events.pinged.publish(undefined, next);
            return next;
          }),
      },
    },
  });

  return { surface, handlers, ctx, doubledBus, countStore };
}

// ── Surface B — projected from A ─────────────────────────────────────────

const bSpec = {
  cells: {
    // B's count1 = A.count + 1
    count1: { schema: Schema.Number, default: 1 },
  },
  streams: {
    // B's quad = A.doubled * 2  (= A.count * 4)
    quad: { inputSchema: Schema.Void, outputSchema: Schema.Number },
  },
  events: {
    // B's relayed = A.pinged * 10 (via deriveEvent — no snapshot)
    relayed: { inputSchema: Schema.Void, outputSchema: Schema.Number },
  },
  procedures: {
    counter: {
      // pass-through to A's bump, returning B's view (the bumped count + 1)
      bumpAndView: { output: Schema.Number },
    },
  },
} as const;

type BSpec = typeof bSpec;
type BClient = SurfaceClientOf<BSpec>;

function projectB(a: SourceA) {
  return projectSurface<ASpec, BSpec>(a.surface, {
    spec: bSpec,
    deps: (client) => ({
      cells: {
        count1: deriveCell(client.surface.count.get, (n) => n + 1, 1),
      },
      streams: {
        quad: deriveStream(client.surface.doubled.get, (n) => n * 2),
      },
      events: {
        relayed: deriveEvent(client.surface.pinged.get, (n) => n * 10),
      },
      procedures: {
        counter: {
          // A projection FORWARDS a member call, and the face hands one back as an
          // `Effect` — so B's handler composes A's directly, with no edge to cross
          // and nothing to await. `orDie` because B declares no error for this
          // member: an A failure is UNDECLARED here, so it crosses as a defect
          // rather than collapsing to a value. (The old `Effect.promise` shape said
          // the same thing by turning a rejection into one; this says it outright.)
          bumpAndView: () =>
            Effect.map(
              Effect.orDie(client.surface.counter.bump()),
              (n) => n + 1,
            ),
        },
      },
    }),
  });
}

interface Harness {
  a: SourceA;
  aClient: AClient;
  bClient: BClient;
}

/** Build A, an A-client, project + implement B, and return the typed B-client.
 *  The heavy `SurfaceClientOf<…>` client unions are materialized *once* here
 *  (via the named `AClient` / `BClient` aliases on the `Harness` return type)
 *  rather than per test — TS's per-file union budget overflows if every test
 *  re-spells these large instantiations inline. */
function setup(initialCount?: number): Harness {
  const a = buildSourceA();
  // Seed A's value (and its doubled snapshot) *before* B is implemented, so
  // B's connect/subscribe sees it as the first snapshot — proving B reflects
  // A's CURRENT value, not just future deltas.
  if (initialCount !== undefined) {
    a.countStore.set(initialCount);
  }
  const aClient = surfaceClientRef(a.surface, { handlers: a.handlers });
  const projected = projectB(a);
  const servedB = projected.implement(aClient);
  const bClient = surfaceClientRef(projected.surface, servedB);
  return { a, aClient, bClient };
}

/** Read the first `n` frames of a snapshot+delta stream. */
function take<T>(stream: Stream.Stream<T, unknown>, n: number): Promise<T[]> {
  return Effect.runPromise(Stream.runCollect(Stream.take(stream, n)));
}

/** Hold a live subscription in its own fiber, recording every frame. Returns the
 *  growing log plus a `stop` that INTERRUPTS the fiber — the D10 replacement for
 *  the old `AbortController`, and the same interruption the teardown law below
 *  attributes the upstream drop to. */
function record<T>(stream: Stream.Stream<T, unknown>): {
  frames: T[];
  stop: () => Promise<unknown>;
} {
  const frames: T[] = [];
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (v) =>
      Effect.sync(() => {
        frames.push(v);
      }),
    ),
  );
  return {
    frames,
    stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
  };
}

describe("surfaceClientRef — an in-process client of a sibling surface", () => {
  it("returns a working client over a served surface", async () => {
    const { aClient } = setup();

    // cell snapshot
    expect(await take(aClient.surface.count.get(undefined), 1)).toEqual([0]);

    // procedure round-trip
    expect(await Effect.runPromise(aClient.surface.counter.bump())).toBe(1);
    expect(await take(aClient.surface.count.get(undefined), 1)).toEqual([1]);
  });
});

describe("projectSurface — surface B derived from a client of surface A", () => {
  it("B's cell snapshot reflects A's current value (mapped)", async () => {
    // A seeded to 10 BEFORE B is implemented → B's first snapshot must be 11.
    const { bClient } = setup(10);

    // deriveCell's connect subscription is async — poll until A's snapshot has
    // propagated through B's cell (A.count 10 → B.count1 11).
    await vi.waitFor(async () => {
      expect(await take(bClient.surface.count1.get(undefined), 1)).toEqual([
        11,
      ]);
    });
  });

  it("propagates a mapped delta to B's cell after A mutates", async () => {
    const { a, bClient } = setup();

    const sub = record(bClient.surface.count1.get(undefined));

    // first frame is the snapshot (A.count 0 → 1); wait for the connect
    // subscription to push it, then mutate A.
    await vi.waitFor(() => expect(sub.frames.length).toBeGreaterThanOrEqual(1));
    a.ctx.cells.count.set(5); // A.count 5 → B.count1 6
    await vi.waitFor(() => expect(sub.frames.at(-1)).toBe(6));

    expect(sub.frames[0]).toBe(1);
    await sub.stop();
  });

  it("B's stream yields mapped frames (snapshot-then-deltas preserved)", async () => {
    // A seeded to 3 → A.doubled snapshot = 6 → B.quad snapshot = 12.
    const { a, bClient } = setup(3);

    const sub = record(bClient.surface.quad.get(undefined));

    await vi.waitFor(() => expect(sub.frames).toEqual([12])); // snapshot: 3 * 2 * 2
    // The upstream bus subscription must be live before the delta is published,
    // or the test would be measuring subscription latency, not mapping.
    await vi.waitFor(() => expect(a.doubledBus.subscriberCount()).toBe(1));
    // push an A.doubled delta of 20 → B.quad delta 40
    a.doubledBus.publish(20);
    await vi.waitFor(() => expect(sub.frames.at(-1)).toBe(40));

    expect(sub.frames[0]).toBe(12);
    await sub.stop();
  });

  it("B's pass-through procedure drives A and returns B's view", async () => {
    const { aClient, bClient } = setup();

    // A starts at 0; bump → A.count 1; B's view = 1 + 1 = 2.
    expect(await Effect.runPromise(bClient.surface.counter.bumpAndView())).toBe(
      2,
    );
    // A's cell actually moved.
    expect(await take(aClient.surface.count.get(undefined), 1)).toEqual([1]);
  });

  it("B's derived event relays mapped A occurrences (no snapshot)", async () => {
    const { a, aClient, bClient } = setup();

    // Subscribe to B's `relayed` event first, then trigger A's `pinged`.
    // Events carry no snapshot, so the first frame IS the first occurrence.
    const sub = record(bClient.surface.relayed.get(undefined));

    // Let the upstream A `pinged` subscription attach, then fire it via bump.
    await new Promise((r) => setTimeout(r, 20));
    a.ctx.cells.count.set(2); // so bump → 3 → pinged 3 → relayed 30
    await Effect.runPromise(aClient.surface.counter.bump());

    await vi.waitFor(() => expect(sub.frames).toEqual([30])); // A.pinged 3 * 10
    await sub.stop();
  });

  it("interrupting a B stream subscription tears down the upstream A subscription", async () => {
    const { a, bClient } = setup();

    // Count A's live `doubled` subscribers via the channel the source reads.
    // Before B subscribes: 0. While B holds a quad subscription: 1. After the
    // consuming fiber is interrupted: back to 0 — proving the upstream tore down.
    expect(a.doubledBus.subscriberCount()).toBe(0);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const sub = record(bClient.surface.quad.get(undefined));
      // The snapshot frame proves the subscription is really running, and the
      // fiber keeps pulling — so the upstream stays OPEN and the teardown below
      // is attributable to the interruption, not to a consumer that walked away.
      await vi.waitFor(
        () => expect(sub.frames).toEqual([0]), // A.count 0 → doubled 0 → quad 0
      );
      await vi.waitFor(() => expect(a.doubledBus.subscriberCount()).toBe(1));

      // Interrupting B's subscription must thread through to A and drop it.
      await sub.stop();
      await vi.waitFor(() => expect(a.doubledBus.subscriberCount()).toBe(0));

      // give any swallowed rejection a tick to surface
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("closing the connector's scope tears down the upstream cell subscription", async () => {
    const { a, aClient } = setup();

    const seen: number[] = [];
    const derived = deriveCell(aClient.surface.count.get, (n) => n + 1, 1);
    // Wire it the way implementSurface would: run the connector into a scope the
    // caller owns. The scope IS the teardown point — there is no second
    // `dispose()` path whose completion guarantee differs from this one.
    const scope = Scope.makeUnsafe();
    const fiber = Effect.runFork(
      Scope.provide(derived.connect({ set: (v) => seen.push(v) }), scope),
    );
    await vi.waitFor(() => expect(seen).toEqual([1])); // A.count 0 → 1

    // Closing must not throw…
    fiber.interruptUnsafe();
    await Effect.runPromise(Scope.close(scope, Exit.void));

    // …and must actually END the upstream subscription: a later A mutation
    // reaches nobody. (The old `AbortController` assertion, restated on the
    // observable the teardown is supposed to affect.)
    await new Promise((r) => setTimeout(r, 10));
    a.ctx.cells.count.set(41);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([1]);
  });

  it("interrupting the connector AWAITS the upstream's async teardown (F3)", async () => {
    let finallyDone = false;
    const upstream = (): Stream.Stream<number> =>
      Stream.ensuring(
        // one frame, then park until the disposer interrupts us
        Stream.concat(Stream.make(1), Stream.never),
        Effect.promise(async () => {
          // Async teardown work — `close()` must WAIT for this, rather than
          // resolving the instant it fires the interrupt (#1719). The wait is now
          // the FIBER's: interruption does not complete until every finalizer has.
          await new Promise((r) => setTimeout(r, 20));
          finallyDone = true;
        }),
      );

    const seen: number[] = [];
    const derived = deriveCell(upstream, (n) => n, 0);
    const fiber = Effect.runFork(
      Effect.scoped(derived.connect({ set: (v) => seen.push(v) })),
    );
    await vi.waitFor(() => expect(seen).toEqual([1]));

    fiber.interruptUnsafe();
    // The fiber has not exited — the upstream's finalizer has not finished, so a
    // runtime `close()` awaiting this exit would not yet resolve.
    expect(finallyDone).toBe(false);
    await Effect.runPromise(Fiber.await(fiber));
    // Only after awaiting the exit is the upstream fully torn down.
    expect(finallyDone).toBe(true);
  });

  it("deriveCell routes a non-interrupt upstream failure to onError, not the void (F8)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const boom = new Error("upstream blew up after the first frame");
      const errors: unknown[] = [];
      // An upstream that emits one frame, then FAILS (not an interruption).
      const upstream = (): Stream.Stream<number, Error> =>
        Stream.concat(Stream.make(1), Stream.fail(boom));

      const derived = deriveCell(upstream, (n) => n + 1, 0, {
        onError: (e) => errors.push(e),
      });
      const seen: number[] = [];
      Effect.runFork(
        Effect.scoped(derived.connect({ set: (v) => seen.push(v) })),
      );

      // The first frame lands; then the failure is routed to onError, NOT
      // rethrown into an unhandled rejection.
      await vi.waitFor(() => expect(errors).toEqual([boom]));
      expect(seen).toEqual([2]); // map(1) === 2 made it through
      // Give any stray rejection a tick to surface.
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
