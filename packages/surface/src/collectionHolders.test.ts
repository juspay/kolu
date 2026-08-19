/**
 * `holders` — who is still reading a key, taken from the lifetime that already
 * knows.
 *
 * The wire says when a reader OPENS a key: a per-key `get` IS a subscription, and
 * `readOne` is where the server hears one arrive. Nothing said when the last reader
 * LET GO, so a server that had to know inferred it from opens and aged the answer
 * out — a bound with no honest number in it. The fact was never missing, only
 * unpublished: a handler answers with a `Stream`, that stream's scope IS the
 * subscription, and the scope closes when the tab navigates, the socket drops, the
 * runtime tears down, or a one-shot reader takes its frame and leaves.
 *
 * So the lifetime is the whole of what this has to get right, and the ways a
 * subscription ENDS are what these tests are: the stream running out, a reader taking
 * one frame and leaving, and a fiber being interrupted (which is what a dropped socket
 * and a torn-down runtime both arrive as). Nothing here is about what a hold is worth
 * — that belongs to whoever asked for one.
 *
 * The ORDER is pinned here too, and it is the reason this suite is upstream rather
 * than in the consumer that first wanted it: `Stream.unwrap` runs the hold before the
 * inner stream is built, so the sequence is hold → channel subscribe → `readOne`. A
 * consumer whose `readOne` ACTS on the hold — reading a body only a held path is read
 * for — depends on exactly that, and a comment cannot keep it true.
 */

import { Effect, Fiber, Queue, Schema, type Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface, surfaceTag } from "./define";
import {
  type Channel,
  type CollectionHandlerDeps,
  collectionHandlers,
  implementSurface,
  inMemoryChannel,
} from "./server";

interface V {
  readonly name: string;
}

/** A hold that SAYS so, and says so again when its scope closes — the whole of what
 *  a consumer of this seam has to be given. */
function watchingHold(events: string[]) {
  return (key: unknown): Effect.Effect<unknown, never, Scope.Scope> =>
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
  holders?: CollectionHandlerDeps<string, V>["holders"],
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

describe("collection get — `holders` is the subscription's own lifetime", () => {
  it("a stream that runs out holds the key for exactly as long as it ran", async () => {
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

    const collected = await Effect.runPromise(
      Stream.runCollect(Stream.take(frames, 1)),
    );
    expect([...collected]).toEqual([{ name: "a" }]);
    expect(events).toEqual(["hold notes/a.md", "release notes/a.md"]);
    // The channel subscription went with it — one scope, both resources.
    expect(perKey.subscriberCount()).toBe(0);
  });

  it("a reader that takes one frame and leaves lets the key go", async () => {
    // The one-shot reader — an agent's `resources/read`, which takes the first frame
    // and leaves. The stream itself never ends.
    const events: string[] = [];
    const handlers = handlersFor(
      new Map([["report.html", { name: "r" }]]),
      inMemoryChannel<V>(),
      watchingHold(events),
    );

    await Effect.runPromise(
      Stream.runCollect(Stream.take(handlers.get({ key: "report.html" }), 1)),
    );
    expect(events).toEqual(["hold report.html", "release report.html"]);
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
        holders: (key) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              order.push(`hold ${key}`);
            }),
            () =>
              Effect.sync(() => {
                order.push(`release ${key}`);
              }),
          ),
      },
    );

    await Effect.runPromise(
      Stream.runCollect(Stream.take(handlers.get({ key: "report.html" }), 1)),
    );
    expect(order).toEqual([
      "hold report.html",
      "subscribe",
      "readOne report.html",
      "release report.html",
    ]);
  });

  it("a subscription nobody runs never even CALLS `holders`", async () => {
    // `holders` is invoked inside the stream's own effect, so building an answer and
    // dropping it neither takes a hold nor calls the consumer's function at all.
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
    await new Promise((r) => setTimeout(r, 0));
    expect(called).toBe(0);
  });

  it("a subscription nobody runs holds nothing", async () => {
    const events: string[] = [];
    const handlers = handlersFor(
      new Map([["report.html", { name: "r" }]]),
      inMemoryChannel<V>(),
      watchingHold(events),
    );
    // The stream is lazy: `unwrap`'s effect runs on the first pull, not at
    // construction, so building an answer and dropping it holds nothing.
    handlers.get({ key: "report.html" });
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([]);
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

    const collected = await Effect.runPromise(
      Stream.runCollect(Stream.take(handlers.get({ key: "a" }), 1)),
    );
    expect([...collected]).toEqual([{ name: "a" }]);
    expect(perKey.subscriberCount()).toBe(0);
  });

  it("still holds open on an absent key, emitting nothing (#1681)", async () => {
    const perKey = inMemoryChannel<V>();
    const handlers = handlersFor(new Map(), perKey, undefined);
    let ended = false;
    const fiber = Effect.runFork(
      Stream.runForEach(handlers.get({ key: "later" }), () =>
        Effect.sync(() => {}),
      ).pipe(Effect.tap(() => Effect.sync(() => (ended = true)))),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(ended).toBe(false);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });
});

describe("collection get — a hold cannot fail, so a defect in one is loud", () => {
  it("a throwing hold kills THAT subscription rather than serving it unheld", async () => {
    // The error channel is `never`: failure is unspellable, so the only way a hold
    // can go wrong is a DEFECT. It propagates — the subscription dies — rather than
    // degrading to an unheld read, because a reader nobody is counted for is exactly
    // the state this seam exists to make impossible.
    const perKey = inMemoryChannel<V>();
    const handlers = handlersFor(
      new Map([["a", { name: "a" }]]),
      perKey,
      () => {
        throw new Error("the consumer's hold blew up");
      },
    );

    const exit = await Effect.runPromiseExit(
      Stream.runCollect(Stream.take(handlers.get({ key: "a" }), 1)),
    );
    expect(exit._tag).toBe("Failure");
    // And it took nothing else with it: no channel subscription was left standing.
    expect(perKey.subscriberCount()).toBe(0);
  });

  it("a sibling subscription on the same collection is untouched", async () => {
    let fail = true;
    const perKey = inMemoryChannel<V>();
    const handlers = handlersFor(new Map([["a", { name: "a" }]]), perKey, () =>
      fail
        ? Effect.sync(() => {
            throw new Error("the consumer's hold blew up");
          })
        : Effect.void,
    );

    const bad = await Effect.runPromiseExit(
      Stream.runCollect(Stream.take(handlers.get({ key: "a" }), 1)),
    );
    expect(bad._tag).toBe("Failure");

    fail = false;
    const good = await Effect.runPromise(
      Stream.runCollect(Stream.take(handlers.get({ key: "a" }), 1)),
    );
    expect([...good]).toEqual([{ name: "a" }]);
  });
});

describe("collection get — the seam an app author actually writes", () => {
  it("`implementSurface` threads `holders` from the collection's deps to its `get`", async () => {
    // The internal handler type is not the boundary a consumer crosses: an app
    // declares its collection's deps inside `implementSurface`. A `holders` that
    // typechecks there and is dropped on the way to `collectionHandlers` would be a
    // seam that reads as shipped and does nothing — so this drives the whole path,
    // through a real surface and its real wire tag.
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
          holders: (key) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                events.push(`hold ${key}`);
              }),
              () =>
                Effect.sync(() => {
                  events.push(`release ${key}`);
                }),
            ),
        },
      },
    });

    const tag = surfaceTag(surface.tagPrefix, "documents", "get");
    const handler = runtime.handlers[tag];
    if (handler === undefined) throw new Error(`no handler at "${tag}"`);
    const frames = await Effect.runPromise(
      Stream.runCollect(
        Stream.take(
          handler({ key: "a.md" }) as Stream.Stream<{ name: string }>,
          1,
        ),
      ),
    );
    expect([...frames]).toEqual([{ name: "a" }]);
    expect(events).toEqual(["hold a.md", "release a.md"]);
    await runtime.close();
  });
});
