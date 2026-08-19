/**
 * `holders` — the contract, which is a LIFETIME.
 *
 * What the seam is and why it is not a wire member is stated once, on
 * {@link CollectionHolders}. What is left to get right is the lifetime itself, so
 * the ways a per-key subscription ENDS are what this suite is: a reader taking its
 * frame and leaving, and a fiber being interrupted (which is what a dropped socket
 * and a torn-down runtime both arrive as). Plus the pull order, which is contract
 * rather than accident and which a comment cannot keep true.
 *
 * The end-to-end case is the most load-bearing one here: `holders` reaches the wire
 * through three hand-written sites (`CollectionImplDeps`, `walkSurface`'s narrowed
 * dep type, the `collectionHandlers` call), and it once landed on the first of them
 * only — documented as shipped, dropped on the floor.
 */

import { Effect, Fiber, Queue, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface, surfaceTag } from "./define";
import { firstFrame, flush } from "./handlerDispatch.testlib";
import {
  type Channel,
  type CollectionHolders,
  collectionHandlers,
  implementSurface,
  inMemoryChannel,
} from "./server";

interface V {
  readonly name: string;
}

/** A hold that SAYS so, and says so again when its scope closes — the whole of what
 *  a consumer of this seam has to be given. */
function watchingHold(events: string[]): CollectionHolders<unknown> {
  return (key) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        events.push(`hold ${String(key)}`);
      }),
      () =>
        Effect.sync(() => {
          events.push(`release ${String(key)}`);
        }),
    );
}

function handlersFor(
  store: Map<string, V>,
  perKey: Channel<V>,
  holders?: CollectionHolders<string>,
) {
  return collectionHandlers<"documents", string, V>(
    { name: "documents" } as never,
    {
      readAll: () => store,
      perKeyBus: () => perKey,
      keysBus: inMemoryChannel<string[]>(),
      upsert: (k, v) => {
        store.set(k, v);
      },
      remove: (k) => {
        store.delete(k);
      },
      holders,
    },
  );
}

/** One reader, one frame, then gone — an agent's `resources/read`, and the shape
 *  every finite reader of a `get` has, since a collection's `get` is held open and
 *  never ends on its own. */
const readOnce = (stream: Stream.Stream<V>): Promise<readonly V[]> =>
  Effect.runPromise(Stream.runCollect(Stream.take(stream, 1)));

describe("collection get — `holders` is the subscription's own lifetime", () => {
  it("a reader that takes its frame and leaves holds the key for exactly as long as it read", async () => {
    const events: string[] = [];
    const perKey = inMemoryChannel<V>();
    const handlers = handlersFor(
      new Map([["notes/a.md", { name: "a" }]]),
      perKey,
      watchingHold(events),
    );

    // BUILDING the answer holds nothing: the acquire hangs off the STREAM's scope,
    // so a subscription nobody runs is a subscription nobody has.
    const frames = handlers.get({ key: "notes/a.md" });
    expect(events).toEqual([]);

    expect([...(await readOnce(frames))]).toEqual([{ name: "a" }]);
    expect(events).toEqual(["hold notes/a.md", "release notes/a.md"]);
    // The channel subscription went with it — one scope, both resources.
    expect(perKey.subscriberCount()).toBe(0);
  });

  it("an interrupted subscription releases the key", async () => {
    // A dropped socket and a closed runtime both arrive as an interruption of the
    // fiber running the handler's stream — fiber interruption IS the unsubscribe.
    const events: string[] = [];
    const handlers = handlersFor(
      new Map([["report.html", { name: "r" }]]),
      inMemoryChannel<V>(),
      watchingHold(events),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        // The frame is the barrier: taking one says the stream is RUNNING (so the
        // hold is taken) and parked on the open tail — a reader sitting on a page.
        const frames = yield* Queue.unbounded<V>();
        const reading = yield* Effect.forkChild(
          Stream.runForEach(handlers.get({ key: "report.html" }), (frame) =>
            Queue.offer(frames, frame),
          ),
        );
        yield* Queue.take(frames);
        expect(events).toEqual(["hold report.html"]);

        // `Fiber.interrupt` waits for the exit, so the finalizers have run by the
        // time it returns — nothing here is timing.
        yield* Fiber.interrupt(reading);
        expect(events).toEqual(["hold report.html", "release report.html"]);
      }).pipe(Effect.scoped),
    );
  });

  it("two readers of one key are two holds and two releases", async () => {
    const events: string[] = [];
    const handlers = handlersFor(
      new Map([["report.html", { name: "r" }]]),
      inMemoryChannel<V>(),
      watchingHold(events),
    );

    await Effect.runPromise(
      Effect.all(
        [
          Stream.runCollect(
            Stream.take(handlers.get({ key: "report.html" }), 1),
          ),
          Stream.runCollect(
            Stream.take(handlers.get({ key: "report.html" }), 1),
          ),
        ],
        { concurrency: 2 },
      ),
    );
    expect(events.filter((e) => e === "hold report.html")).toHaveLength(2);
    expect(events.filter((e) => e === "release report.html")).toHaveLength(2);
  });

  it("THE PULL ORDER: hold, then subscribe, then `readOne`", async () => {
    // The contract, not an implementation accident. A consumer whose `readOne` acts
    // on the hold — asking for a body only a held path is read for — would otherwise
    // ask about a path nobody was holding yet, and drop the answer.
    const order: string[] = [];
    const perKey = inMemoryChannel<V>();
    const watched: Channel<V> = {
      ...perKey,
      subscribe: (signal) => {
        order.push("subscribe");
        return perKey.subscribe(signal);
      },
    };
    const handlers = collectionHandlers<"documents", string, V>(
      { name: "documents" } as never,
      {
        readAll: () => new Map(),
        readOne: (k) => {
          order.push(`readOne ${k}`);
          return { name: k };
        },
        perKeyBus: () => watched,
        keysBus: inMemoryChannel<string[]>(),
        upsert: () => {},
        remove: () => {},
        holders: watchingHold(order),
      },
    );

    await readOnce(handlers.get({ key: "report.html" }));
    expect(order).toEqual([
      "hold report.html",
      "subscribe",
      "readOne report.html",
      "release report.html",
    ]);
  });

  it("a subscription nobody runs never even CALLS `holders`", async () => {
    // The call is inside the stream's own effect, not just the effect it returns, so
    // building an answer and dropping it does nothing at all on the consumer's behalf.
    let called = 0;
    const handlers = handlersFor(
      new Map([["report.html", { name: "r" }]]),
      inMemoryChannel<V>(),
      () => {
        called++;
        return Effect.void;
      },
    );
    handlers.get({ key: "report.html" });
    await flush();
    expect(called).toBe(0);
  });
});

describe("collection get — a hold cannot fail, so a defect in one is loud", () => {
  it("a throwing hold kills THAT subscription; the next one is served normally", async () => {
    // The error channel is `never`: failure is unspellable, so the only way a hold
    // can go wrong is a DEFECT. It propagates — the subscription dies — rather than
    // degrading to an unheld read, because a reader nobody is counted for is exactly
    // the state this seam exists to make impossible. A synchronous throw (rather than
    // one inside the effect) is the case `suspend` is there for.
    let fail = true;
    const perKey = inMemoryChannel<V>();
    const handlers = handlersFor(
      new Map([["a", { name: "a" }]]),
      perKey,
      () => {
        if (fail) throw new Error("the consumer's hold blew up");
        return Effect.void;
      },
    );

    const exit = await Effect.runPromiseExit(
      Stream.runCollect(Stream.take(handlers.get({ key: "a" }), 1)),
    );
    expect(exit._tag).toBe("Failure");
    // It took nothing else with it: no channel subscription left standing, and the
    // next subscription is served as if nothing had happened.
    expect(perKey.subscriberCount()).toBe(0);

    fail = false;
    expect([...(await readOnce(handlers.get({ key: "a" })))]).toEqual([
      { name: "a" },
    ]);
  });
});

describe("collection get — absent `holders` is the stream it always was", () => {
  it("serves the same frames, and releases the channel subscription the same way", async () => {
    const perKey = inMemoryChannel<V>();
    const handlers = handlersFor(
      new Map([["a", { name: "a" }]]),
      perKey,
      undefined,
    );

    expect([...(await readOnce(handlers.get({ key: "a" })))]).toEqual([
      { name: "a" },
    ]);
    expect(perKey.subscriberCount()).toBe(0);
  });
});

describe("collection get — the seam an app author actually writes", () => {
  it("`implementSurface` threads `holders` from the collection's deps to its `get`", async () => {
    // The internal handler type is not the boundary a consumer crosses: an app
    // declares its collection's deps inside `implementSurface`. A `holders` that
    // typechecks there and is dropped on the way to `collectionHandlers` would be a
    // seam that reads as shipped and does nothing — which is exactly what landed
    // first. So this drives the whole path, through a real surface and its wire tag.
    const surface = defineSurface({
      collections: {
        documents: {
          keySchema: Schema.String,
          schema: Schema.Struct({ name: Schema.String }),
          verbs: ["keys", "get"],
        },
      },
    });
    const events: string[] = [];
    const store = new Map<string, { name: string }>([["a.md", { name: "a" }]]);
    const runtime = implementSurface(surface, {
      collections: {
        documents: {
          readAll: () => store,
          upsert: (k, v) => {
            store.set(k, v);
          },
          remove: (k) => {
            store.delete(k);
          },
          holders: watchingHold(events),
        },
      },
    });

    const tag = surfaceTag(surface.tagPrefix, "documents", "get");
    expect(await firstFrame(runtime.handlers, tag, { key: "a.md" })).toEqual({
      name: "a",
    });
    expect(events).toEqual(["hold a.md", "release a.md"]);
    await runtime.close();
  });
});
