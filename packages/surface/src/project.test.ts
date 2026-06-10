/**
 * `projectSurface` — deriving surface B from a live client of surface A.
 *
 * Surface A is an ordinary in-memory surface (a `count` cell + a `doubled`
 * stream of `count * 2`). Surface B is projected from A: a `count1` cell that
 * tracks A's `count` + 1 via `deriveCell`, a `quad` stream that maps A's
 * `doubled` * 2 via `deriveStream`, and a `bump` procedure that passes through
 * to A's `bump`. These tests pin that:
 *
 *   - B's cell snapshot reflects A's *current* value (snapshot, not just deltas);
 *   - mutating A propagates a mapped delta to B's cell;
 *   - B's stream yields mapped frames (snapshot-then-deltas preserved);
 *   - aborting a B stream subscription tears down the upstream A subscription
 *     with no leak and no unhandled rejection;
 *   - `surfaceClientRef` alone returns a working in-process client.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import {
  deriveCell,
  deriveEvent,
  deriveStream,
  projectSurface,
  type SurfaceClientOf,
  surfaceClientRef,
} from "./project";
import type { InMemoryChannel, SurfaceCtx } from "./server";
import {
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
  inMemoryStore,
} from "./server";

// ── Surface A — the source ───────────────────────────────────────────────

// Hoisted to module scope so the (large) `SurfaceClientOf<…>` client unions are
// materialized from a single named `typeof` rather than re-instantiated at every
// test call site — TS's per-file union budget overflows otherwise.
const aSpec = {
  cells: {
    count: { schema: z.number(), default: 0 },
  },
  streams: {
    // snapshot-then-deltas: yields `count * 2` on subscribe, then again on
    // each abort-driven re-read. For the test we drive deltas via a channel.
    doubled: {
      inputSchema: z.void(),
      outputSchema: z.number(),
    },
  },
  events: {
    // an occurrence per bump (no snapshot obligation) — drives `deriveEvent`.
    pinged: {
      inputSchema: z.void(),
      outputSchema: z.number(),
    },
  },
  procedures: {
    counter: {
      bump: { output: z.number() },
    },
  },
} as const;

type ASpec = typeof aSpec;
type AClient = SurfaceClientOf<ASpec>;

interface SourceA {
  surface: ReturnType<typeof defineSurface<ASpec>>;
  router: ReturnType<typeof implementSurface<ASpec>>["router"];
  ctx: SurfaceCtx<ASpec>;
  doubledBus: InMemoryChannel<number>;
  countStore: ReturnType<typeof inMemoryStore<number>>;
}

function buildSourceA(): SourceA {
  const surface = defineSurface(aSpec);

  // A channel the test can publish to, to feed `doubled`'s deltas. A raw
  // `inMemoryChannel` (not via the by-name publisher) so the test can read
  // `subscriberCount()` to prove upstream teardown on abort.
  const doubledBus = inMemoryChannel<number>();
  const countStore = inMemoryStore(0);

  const { router, ctx } = implementSurface(surface, {
    channel: inMemoryChannelByName(),
    cells: {
      count: { store: countStore },
    },
    streams: {
      doubled: {
        source: async function* (_input, signal) {
          // Attach the bus subscriber BEFORE the snapshot yield so the
          // subscription is live as soon as the consumer pulls the first
          // frame. (A real poll-on-event source attaches its listener up
          // front too.) The abort test relies on `subscriberCount() === 1`
          // being observable after the snapshot frame, with the iterator
          // still open.
          const deltas = doubledBus.subscribe(signal);
          // snapshot first
          yield countStore.get() * 2;
          // then deltas pushed onto the bus
          for await (const v of deltas) yield v;
        },
      },
    },
    procedures: {
      counter: {
        bump: ({ ctx }) => {
          const next = ctx.cells.count.get() + 1;
          ctx.cells.count.set(next);
          doubledBus.publish(next * 2);
          // fire the `pinged` event (void input) so a B subscriber to the
          // derived `relayed` event sees a mapped occurrence.
          ctx.events.pinged.publish(undefined, next);
          return next;
        },
      },
    },
  });

  return { surface, router, ctx, doubledBus, countStore };
}

// ── Surface B — projected from A ─────────────────────────────────────────

const bSpec = {
  cells: {
    // B's count1 = A.count + 1
    count1: { schema: z.number(), default: 1 },
  },
  streams: {
    // B's quad = A.doubled * 2  (= A.count * 4)
    quad: { inputSchema: z.void(), outputSchema: z.number() },
  },
  events: {
    // B's relayed = A.pinged * 10 (via deriveEvent — no snapshot)
    relayed: { inputSchema: z.void(), outputSchema: z.number() },
  },
  procedures: {
    counter: {
      // pass-through to A's bump, returning B's view (the bumped count + 1)
      bumpAndView: { output: z.number() },
    },
  },
} as const;

type BSpec = typeof bSpec;
type BClient = SurfaceClientOf<BSpec>;

function projectB(a: SourceA) {
  return projectSurface<ASpec, BSpec>(a.surface, {
    spec: bSpec,
    deps: (client) => ({
      channel: inMemoryChannelByName(),
      cells: {
        count1: deriveCell(
          (opts) => client.surface.count.get(undefined, opts),
          (n) => n + 1,
          1,
        ),
      },
      streams: {
        quad: deriveStream(
          (input, opts) => client.surface.doubled.get(input, opts),
          (n) => n * 2,
        ),
      },
      events: {
        relayed: deriveEvent(
          (input, opts) => client.surface.pinged.get(input, opts),
          (n) => n * 10,
        ),
      },
      procedures: {
        counter: {
          bumpAndView: async () => {
            const bumped = await client.surface.counter.bump();
            return bumped + 1;
          },
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
 *  The heavy `directLink<…B…>` / `surfaceClientRef<…A…>` client unions are
 *  materialized *once* here (via the named `AClient` / `BClient` aliases on the
 *  `Harness` return type) rather than per test — TS's per-file union budget
 *  overflows if every test re-spells these large instantiations inline. */
function setup(initialCount?: number): Harness {
  const a = buildSourceA();
  // Seed A's value (and its doubled snapshot) *before* B is implemented, so
  // B's connect/subscribe sees it as the first snapshot — proving B reflects
  // A's CURRENT value, not just future deltas.
  if (initialCount !== undefined) {
    a.countStore.set(initialCount);
  }
  const aClient = surfaceClientRef(a.surface, a.router);
  const projected = projectB(a);
  const { router } = projected.implement(aClient);
  const bClient = directLink<typeof projected.surface.contract>(
    router,
  ) as BClient;
  return { a, aClient, bClient };
}

/** Read the first `n` frames of a cell/stream snapshot+delta iterable. */
async function take<T>(iterable: AsyncIterable<T>, n: number): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iterable) {
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

describe("surfaceClientRef — an in-process client of a sibling surface", () => {
  it("returns a working client over a served router", async () => {
    const { aClient } = setup();

    // cell snapshot
    const snap = await take(await aClient.surface.count.get(undefined), 1);
    expect(snap).toEqual([0]);

    // procedure round-trip
    expect(await aClient.surface.counter.bump()).toBe(1);
    expect(await take(await aClient.surface.count.get(undefined), 1)).toEqual([
      1,
    ]);
  });
});

describe("projectSurface — surface B derived from a client of surface A", () => {
  it("B's cell snapshot reflects A's current value (mapped)", async () => {
    // A seeded to 10 BEFORE B is implemented → B's first snapshot must be 11.
    const { bClient } = setup(10);

    // deriveCell's connect loop is async — poll until A's snapshot has
    // propagated through B's cell (A.count 10 → B.count1 11).
    await vi.waitFor(async () => {
      const [snap] = await take(await bClient.surface.count1.get(undefined), 1);
      expect(snap).toBe(11);
    });
  });

  it("propagates a mapped delta to B's cell after A mutates", async () => {
    const { a, bClient } = setup();

    const got: number[] = [];
    const sub = await bClient.surface.count1.get(undefined);
    const reader = (async () => {
      for await (const v of sub) {
        got.push(v);
        if (got.length >= 2) break;
      }
    })();

    // first frame is the snapshot (A.count 0 → 1); wait for the connect loop
    // to push it, then mutate A.
    await vi.waitFor(() => expect(got.length).toBeGreaterThanOrEqual(1));
    a.ctx.cells.count.set(5); // A.count 5 → B.count1 6
    await reader;

    expect(got[0]).toBe(1);
    expect(got[got.length - 1]).toBe(6);
  });

  it("B's stream yields mapped frames (snapshot-then-deltas preserved)", async () => {
    // A seeded to 3 → A.doubled snapshot = 6 → B.quad snapshot = 12.
    const { a, bClient } = setup(3);

    const got: number[] = [];
    const sub = await bClient.surface.quad.get();
    const reader = (async () => {
      for await (const v of sub) {
        got.push(v);
        if (got.length >= 2) break;
      }
    })();

    await vi.waitFor(() => expect(got.length).toBeGreaterThanOrEqual(1));
    // push an A.doubled delta of 20 → B.quad delta 40
    a.doubledBus.publish(20);
    await reader;

    expect(got[0]).toBe(12); // snapshot: A.count 3 * 2 * 2
    expect(got[got.length - 1]).toBe(40); // delta: 20 * 2
  });

  it("B's pass-through procedure drives A and returns B's view", async () => {
    const { aClient, bClient } = setup();

    // A starts at 0; bump → A.count 1; B's view = 1 + 1 = 2.
    expect(await bClient.surface.counter.bumpAndView()).toBe(2);
    // A's cell actually moved.
    expect(await take(await aClient.surface.count.get(undefined), 1)).toEqual([
      1,
    ]);
  });

  it("B's derived event relays mapped A occurrences (no snapshot)", async () => {
    const { a, aClient, bClient } = setup();

    // Subscribe to B's `relayed` event first, then trigger A's `pinged`.
    // Events carry no snapshot, so the first frame IS the first occurrence.
    const sub = await bClient.surface.relayed.get();
    const iterator = sub[Symbol.asyncIterator]();
    const firstFrame = iterator.next();

    // Let the upstream A `pinged` subscription attach, then fire it via bump.
    await new Promise((r) => setTimeout(r, 20));
    a.ctx.cells.count.set(2); // so bump → 3 → pinged 3 → relayed 30
    await aClient.surface.counter.bump();

    const { value } = await firstFrame;
    expect(value).toBe(30); // A.pinged 3 mapped * 10
    await iterator.return?.();
  });

  it("aborting a B stream subscription tears down the upstream A subscription", async () => {
    const { a, bClient } = setup();

    // Count A's live `doubled` subscribers via the channel the source reads.
    // Before B subscribes: 0. While B holds a quad subscription: 1. After
    // abort: back to 0 — proving the upstream tore down.
    expect(a.doubledBus.subscriberCount()).toBe(0);

    const controller = new AbortController();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const sub = await bClient.surface.quad.get(undefined, {
        signal: controller.signal,
      });
      // Drive the iterator MANUALLY (not `for await`): pull the snapshot frame
      // so the upstream iterator is actually attached, but keep the iterator
      // OPEN. A `for await … break` would call `iterator.return()` and tear the
      // upstream down before we could observe it live — which is exactly the
      // teardown we want to attribute to `abort()`, not to leaving the loop.
      const iterator = sub[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.value).toBe(0); // A.count 0 → doubled 0 → quad 0

      // Upstream is now live: A's `doubled` source has one subscriber.
      await vi.waitFor(() => expect(a.doubledBus.subscriberCount()).toBe(1));

      // Aborting B's subscription must thread through to A and drop it.
      controller.abort();

      await vi.waitFor(() => expect(a.doubledBus.subscriberCount()).toBe(0));

      // give any swallowed rejection a tick to surface
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("deriveCell.dispose() tears down the upstream cell subscription", async () => {
    const { a, aClient } = setup();

    const derived = deriveCell(
      (opts) => aClient.surface.count.get(undefined, opts),
      (n) => n + 1,
      1,
    );
    // wire it the way implementSurface would: fire connect with a no-op setter.
    derived.connect({ set: () => {} });

    await vi.waitFor(() => expect(a.surface).toBeDefined());
    // dispose must not throw and must abort the upstream subscription cleanly.
    expect(() => derived.dispose()).not.toThrow();
  });
});
