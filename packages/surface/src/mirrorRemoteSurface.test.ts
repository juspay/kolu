/**
 * `mirrorRemoteSurface` over a synthetic surface that exercises all four
 * primitive kinds (cell · collection · stream · event) against fake in-process
 * clients — no transport. Proves the consume-side dual of `implementSurface`:
 * each primitive's frames land in its sink, a departed collection key fires
 * `onRemove`, primitives with no sink (or no client entry) are skipped, and a
 * non-teardown stream error settles rather than rejecting the whole mirror.
 *
 * The fake clients are built from Effect `Stream`s, not async generators, because
 * that is what a client's streaming member IS now (`StreamingProcedure<I,O> =
 * (input) => Stream<O, unknown>`) — and because a parked async generator behind
 * `Stream.fromAsyncIterable` deadlocks on teardown (its `return()` cannot settle
 * until the `await` it is parked on does; see S2 §4). {@link park} is the
 * Stream-native "stay open until this promise settles" the old
 * `yield …; await open` generators expressed.
 */

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { type CollectionDeltasMsg, defineSurface } from "./define";
import {
  ClientSurfaceMismatchError,
  type MirrorFault,
  mirrorRemoteSurface,
} from "./mirrorRemoteSurface";
import { surfaceClientRef } from "./project";
import { implementSurface } from "./server";

const testSurface = defineSurface({
  cells: { count: { schema: Schema.Number, default: 0 } },
  collections: {
    items: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
    },
  },
  streams: {
    ticks: { inputSchema: Schema.Struct({}), outputSchema: Schema.Number },
  },
  events: {
    bells: { inputSchema: Schema.Struct({}), outputSchema: Schema.String },
  },
});

/** Emit `values` in order, then end. */
const emit = <A>(...values: A[]): Stream.Stream<A> =>
  Stream.fromIterable(values);

/** Emit nothing and stay OPEN until `open()` settles — the Stream-native form of
 *  the old `await openPromise` park inside a fake client's async generator.
 *  Interrupting the subscription unblocks it (interruption aborts the effect's
 *  signal), so teardown can never deadlock on it. */
const park = (open: () => Promise<void>): Stream.Stream<never> =>
  Stream.fromEffectDrain(Effect.promise(open));

/** Concatenate stages into one stream — `emit(...)` and `park(...)` segments in
 *  the order a fake client's generator used to write them. */
const seq = <A>(...parts: ReadonlyArray<Stream.Stream<A>>): Stream.Stream<A> =>
  parts.reduce<Stream.Stream<A>>((a, b) => Stream.concat(a, b), Stream.empty);

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// A loose cast for the fake clients — `mirrorRemoteSurface` reads `client.surface`
// structurally, so a partial fake is enough.
// biome-ignore lint/suspicious/noExplicitAny: structural fake client for the test.
const asClient = (c: unknown): any => c;

describe("mirrorRemoteSurface", () => {
  it("mirrors a cell, a collection, a stream, and an event into their sinks", async () => {
    const keysOpen = Promise.withResolvers<void>();
    const client = {
      surface: {
        count: { get: () => emit(1, 2, 3) },
        items: {
          // Keys snapshot then stay open (a real keys stream is long-lived),
          // so the per-key value streams have time to deliver before we close.
          keys: () =>
            seq(
              emit(["a", "b"]),
              park(() => keysOpen.promise),
            ),
          get: ({ key }: { key: string }) => emit({ v: key === "a" ? 10 : 20 }),
        },
        ticks: { get: () => emit(10, 20) },
        bells: { get: () => emit("ding") },
      },
    };

    const cellFrames: number[] = [];
    const upserts: Array<[string, { v: number }]> = [];
    const streamFrames: number[] = [];
    const eventFrames: string[] = [];

    const { done } = mirrorRemoteSurface(testSurface, asClient(client), {
      cells: { count: (v) => cellFrames.push(v) },
      collections: {
        items: {
          upsert: (k, v) => upserts.push([k, v]),
          remove: () => {},
        },
      },
      streams: { ticks: { input: {}, onFrame: (n) => streamFrames.push(n) } },
      events: { bells: { input: {}, onFrame: (s) => eventFrames.push(s) } },
    });

    await delay(20);
    expect(cellFrames).toEqual([1, 2, 3]);
    expect(streamFrames).toEqual([10, 20]);
    expect(eventFrames).toEqual(["ding"]);
    expect([...upserts].sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ["a", { v: 10 }],
      ["b", { v: 20 }],
    ]);

    keysOpen.resolve();
    await done; // every subscription settled (keys closed) → the mirror resolves.
  });

  it("fires onRemove when a key leaves the collection's keys snapshot", async () => {
    const initialUpserts = Promise.withResolvers<void>();
    const allowDeparture = Promise.withResolvers<void>();
    const removed = Promise.withResolvers<void>();
    const closeKeys = Promise.withResolvers<void>();
    const closeVals = Promise.withResolvers<void>();
    const client = {
      surface: {
        items: {
          keys: () =>
            seq(
              emit(["a", "b"]),
              park(() => allowDeparture.promise),
              emit(["a"]), // b departs
              park(() => closeKeys.promise),
            ),
          // Per-key value streams stay open so a key is "present" until removed.
          get: ({ key }: { key: string }) =>
            seq(
              emit({ v: key === "a" ? 1 : 2 }),
              park(() => closeVals.promise),
            ),
        },
      },
    };

    const upserts: string[] = [];
    const removes: string[] = [];
    const { done } = mirrorRemoteSurface(testSurface, asClient(client), {
      collections: {
        items: {
          upsert: (k) => {
            upserts.push(k);
            if (upserts.length === 2) initialUpserts.resolve();
          },
          remove: (k) => {
            removes.push(k);
            removed.resolve();
          },
        },
      },
    });

    await initialUpserts.promise;
    expect([...upserts].sort()).toEqual(["a", "b"]);
    allowDeparture.resolve();
    await removed.promise;
    expect(removes).toEqual(["b"]);

    closeVals.resolve();
    closeKeys.resolve();
    await done;
  });

  it("prunes a carry-over key the fresh snapshot omits (cross-reconnect reconcile)", async () => {
    // A re-serve holds one cache across reconnects; each spawn is a fresh mirror.
    // A key that departs WHILE THE LINK IS DOWN is not in the new spawn's `open`
    // map, so the within-spawn departure sweep can't catch it — `initialKeys` +
    // the first-frame reconcile is what prunes it (no stale ghost row), while a
    // surviving key is left untouched (no empty flash).
    const cache = new Map<string, { v: number }>();
    const removes: string[] = [];
    const sink = {
      collections: {
        items: {
          initialKeys: () => cache.keys(),
          upsert: (k: string, v: { v: number }) => {
            cache.set(k, v);
          },
          remove: (k: string) => {
            cache.delete(k);
            removes.push(k);
          },
        },
      },
    };

    // Spawn 1 serves {a, b}; both land in the cache, then the link drops.
    const open1 = Promise.withResolvers<void>();
    const client1 = {
      surface: {
        items: {
          keys: () =>
            seq(
              emit(["a", "b"]),
              park(() => open1.promise),
            ),
          get: ({ key }: { key: string }) =>
            seq(
              emit({ v: key === "a" ? 1 : 2 }),
              park(() => open1.promise),
            ),
        },
      },
    };
    const m1 = mirrorRemoteSurface(testSurface, asClient(client1), sink);
    await delay(20);
    expect([...cache.keys()].sort()).toEqual(["a", "b"]);
    open1.resolve();
    await m1.done;

    // Spawn 2 (reconnect) serves ONLY {a} — b departed while the link was down.
    const open2 = Promise.withResolvers<void>();
    const client2 = {
      surface: {
        items: {
          keys: () =>
            seq(
              emit(["a"]),
              park(() => open2.promise),
            ),
          get: () =>
            seq(
              emit({ v: 1 }),
              park(() => open2.promise),
            ),
        },
      },
    };
    const m2 = mirrorRemoteSurface(testSurface, asClient(client2), sink);
    await delay(20);
    expect(removes).toContain("b"); // the ghost was pruned on the fresh snapshot
    expect([...cache.keys()]).toEqual(["a"]); // the survivor was held, no flash
    open2.resolve();
    await m2.done;
  });

  it("rejects (does not resolve) when a collection's initialKeys sink throws — fail-fast", async () => {
    // `initialKeys` is a caller-supplied sink callback. A throw from it (a broken
    // local fold) must surface on `done` exactly like a throwing upsert/remove —
    // never collapse to a quietly-resolved mirror. It runs on the subscription's
    // own fiber, before any frame has arrived, so it must be tagged a SinkError
    // the same way, or the raw failure would be logged as an upstream blip.
    const client = {
      surface: {
        items: {
          keys: () =>
            seq(
              emit(["a"]),
              park(() => delay(50)),
            ),
          get: () => emit({ v: 1 }),
        },
      },
    };
    await expect(
      mirrorRemoteSurface(testSurface, asClient(client), {
        collections: {
          items: {
            initialKeys: () => {
              throw new Error("initialKeys fold blew up");
            },
            upsert: () => {},
            remove: () => {},
          },
        },
      }).done,
    ).rejects.toThrow("initialKeys fold blew up");
  });

  it("subscribes only the opted-in primitives and tolerates a missing client entry", async () => {
    // The client serves only `count`; the sink opts into only `count`. The other
    // three primitives (no sink) are skipped, and the missing client entries are
    // never touched — no throw.
    const client = { surface: { count: { get: () => emit(7) } } };
    const cellFrames: number[] = [];
    await mirrorRemoteSurface(testSurface, asClient(client), {
      cells: { count: (v) => cellFrames.push(v) },
    }).done;
    expect(cellFrames).toEqual([7]);
  });

  it("REJECTS (never resolves clean) when a member's upstream stream errors, and faults it LOUD", async () => {
    // juspay/kolu#2101 G5, the mute half-death. This used to RESOLVE — a "clean"
    // end claiming a healthy mirror that had permanently stopped mirroring this
    // member (nothing re-subscribes it) — with one prose line on an un-leveled
    // `log` callback that kolu-server wired to `log.debug` and production filtered
    // away. That combination is how a whole projection layer froze without
    // producing a single log line.
    const client = {
      surface: { ticks: { get: () => Stream.fail(new Error("boom")) } },
    };
    const faults: MirrorFault[] = [];
    await expect(
      mirrorRemoteSurface(
        testSurface,
        asClient(client),
        { streams: { ticks: { input: {}, onFrame: () => {} } } },
        { onFault: (f) => faults.push(f) },
      ).done,
    ).rejects.toThrow("boom");
    // Loud, structured, and carrying the ERROR — not a stringified message.
    expect(faults).toHaveLength(1);
    expect(faults[0]?.scope).toBe("member");
    expect(faults[0]?.label).toContain("ticks");
    expect((faults[0]?.err as Error).message).toBe("boom");
  });

  it("a per-key upstream fault stays KEY-LOCAL but is LOUD — the host's mirror keeps running", async () => {
    // F5 in this file's fiber audit, and the second of the two mute rows #2101 G5
    // closed. Key-local is the right blast radius (one key must not kill a host),
    // which is exactly why the fault has to arrive somewhere an operator reads:
    // that key is now permanently unmirrored, and nothing re-subscribes it.
    const closeKeys = Promise.withResolvers<void>();
    const closeGood = Promise.withResolvers<void>();
    const client = {
      surface: {
        items: {
          keys: () =>
            seq(
              emit(["good", "bad"]),
              park(() => closeKeys.promise),
            ),
          get: ({ key }: { key: string }) =>
            key === "bad"
              ? Stream.fail(new Error("per-key upstream died"))
              : seq(
                  emit({ v: 1 }),
                  park(() => closeGood.promise),
                ),
        },
      },
    };

    const upserts: string[] = [];
    const faults: MirrorFault[] = [];
    const { done } = mirrorRemoteSurface(
      testSurface,
      asClient(client),
      {
        collections: {
          items: { upsert: (k) => upserts.push(k), remove: () => {} },
        },
      },
      { onFault: (f) => faults.push(f) },
    );

    await delay(20);
    // LOUD, key-scoped, and it names the key.
    expect(faults).toHaveLength(1);
    expect(faults[0]?.scope).toBe("key");
    expect(faults[0]?.label).toContain("bad");
    expect((faults[0]?.err as Error).message).toBe("per-key upstream died");
    // KEY-LOCAL: the healthy key still mirrored, and the mirror is still running.
    expect(upserts).toEqual(["good"]);

    closeGood.resolve();
    closeKeys.resolve();
    // …and it ends CLEANLY — a dead key is not a dead mirror.
    await expect(done).resolves.toBeUndefined();
  });

  it("surfaces a SYNCHRONOUSLY throwing client verb on `done`, never out of the call", async () => {
    // Under the oRPC-era API a client verb was `async`, so a throw could only ever
    // arrive as a rejection. A member ref now returns a `Stream` and can throw
    // SYNCHRONOUSLY (a plain-object stub built from the wrong surface). The file's
    // contract is that every streaming failure arrives on `done` — a caller may fire
    // `done` `void`-style (the daemon does), where a sync throw out of the call would
    // crash inline instead of surfacing as a rejection it can flip a host on. So the
    // verb must be called on the SUBSCRIPTION fiber, not while setup is assembling
    // programs.
    const client = {
      surface: {
        ticks: {
          get: () => {
            throw new Error("wrong surface");
          },
        },
      },
    };
    const faults: MirrorFault[] = [];
    let handle: ReturnType<typeof mirrorRemoteSurface> | undefined;
    expect(() => {
      handle = mirrorRemoteSurface(
        testSurface,
        asClient(client),
        { streams: { ticks: { input: {}, onFrame: () => {} } } },
        { onFault: (f) => faults.push(f) },
      );
    }).not.toThrow();
    // It is an UPSTREAM fault, so it takes the upstream disposition — which since
    // #2101 G5 is "fault loud and reject", the same as a stream that fails after
    // subscribing. What stays true is WHERE it arrives: on `done`, never out of
    // the call.
    await expect(handle?.done).rejects.toThrow("wrong surface");
    expect(faults.map((f) => f.scope)).toEqual(["member"]);
  });

  it("rejects (does not log/swallow) when a stream SINK throws — fail-fast", async () => {
    // A throw from the caller's `onFrame` is a broken local fold, not an upstream
    // blip: it must reject the whole mirror (no-fallback: a caught error can't
    // collapse to a quietly-resolved mirror), and never be hidden as a logged
    // remote-stream error — even when the logger is a no-op.
    const client = { surface: { ticks: { get: () => emit(1) } } };
    const logs: string[] = [];
    await expect(
      mirrorRemoteSurface(
        testSurface,
        asClient(client),
        {
          streams: {
            ticks: {
              input: {},
              onFrame: () => {
                throw new Error("fold blew up");
              },
            },
          },
        },
        { log: (l) => logs.push(l) },
      ).done,
    ).rejects.toThrow("fold blew up");
    // The sink failure was NOT logged as an upstream blip.
    expect(logs.some((l) => l.includes("fold blew up"))).toBe(false);
  });

  it("rejects when a collection UPSERT sink throws — fail-fast", async () => {
    const client = {
      surface: {
        items: {
          // Stay open; the sink throw ends the mirror first.
          keys: () =>
            seq(
              emit(["a"]),
              park(() => delay(50)),
            ),
          get: () => emit({ v: 1 }),
        },
      },
    };
    await expect(
      mirrorRemoteSurface(testSurface, asClient(client), {
        collections: {
          items: {
            upsert: () => {
              throw new Error("upsert fold blew up");
            },
            remove: () => {},
          },
        },
      }).done,
    ).rejects.toThrow("upsert fold blew up");
  });

  it("rejects (does not no-op) when a sink is supplied but the client lacks the entry", async () => {
    // Omitting a sink is non-interest; SUPPLYING one for a primitive the client
    // doesn't expose is a client/surface mismatch — fail-fast, never silent
    // no-data while the caller still thinks it's connected.
    const client = { surface: {} };
    await expect(
      mirrorRemoteSurface(testSurface, asClient(client), {
        cells: { count: () => {} },
      }).done,
    ).rejects.toThrow(/client\/surface mismatch/);
  });

  it("starts NO subscription when a later opted-in primitive fails validation", async () => {
    // Setup is all-or-nothing: a valid earlier sink (the cell) must not begin
    // subscribing if a later opted-in sink (the stream) has no client entry. If
    // setup started tasks before validating everything, the cell's long-lived
    // subscription would keep pushing frames into the sink after the caller already
    // observed the rejection.
    let cellSubscribed = false;
    const client = {
      surface: {
        // A valid cell entry, declared first so its `start` would run first…
        count: {
          get: () => {
            cellSubscribed = true;
            return emit(1, 2, 3);
          },
        },
        // …but `ticks` is absent, so validating the stream sink throws.
      },
    };
    await expect(
      mirrorRemoteSurface(testSurface, asClient(client), {
        cells: { count: () => {} },
        streams: { ticks: { input: {}, onFrame: () => {} } },
      }).done,
    ).rejects.toThrow(/client\/surface mismatch/);
    // Give any erroneously-started task a tick to call `get`.
    await delay(10);
    expect(cellSubscribed).toBe(false);
  });
});

// ── Declared `deltas` collection — one protocol across the wire (SR5) ──────
//
// A collection that DECLARES the `deltas` verb is mirrored through its SINGLE
// batched snapshot-then-delta stream, not the per-key `keys`+`get` fan-out — the
// same protocol the local `.use()` takes, now carried across the wire. Routing is
// SPEC-driven (`collectionHasDeltas`), never a link probe: the fake clients below
// make `keys`/`get` THROW to prove the mirror never reaches for them on a
// delta-declaring collection.

const deltaSurface = defineSurface({
  collections: {
    procs: {
      keySchema: Schema.Number,
      schema: Schema.Struct({ name: Schema.String }),
      verbs: ["keys", "get", "upsert", "delete", "deltas"],
    },
  },
});

/** One frame of `procs`' batched deltas stream — the exact wire union the mirror
 *  folds, so a fake client can't drift from `mirrorCollectionDeltas`' contract. */
type ProcFrame = CollectionDeltasMsg<number, { name: string }>;

describe("mirrorRemoteSurface — declared `deltas` collection (SR5)", () => {
  it("folds the single snapshot-then-delta stream into upsert/remove (never per-key)", async () => {
    const open = Promise.withResolvers<void>();
    const client = {
      surface: {
        procs: {
          deltas: () =>
            seq<ProcFrame>(
              emit<ProcFrame>(
                {
                  kind: "snapshot",
                  entries: [
                    [1, { name: "a" }],
                    [2, { name: "b" }],
                  ],
                },
                {
                  kind: "delta",
                  upserts: [[3, { name: "c" }]],
                  removes: [1],
                },
              ),
              park(() => open.promise),
            ),
          // Spec-driven routing: a delta-declaring collection must NEVER take the
          // per-key path, so a `keys`/`get` reach is a test failure, not a fallback.
          keys: () => {
            throw new Error("keys must not be used for a deltas collection");
          },
          get: () => {
            throw new Error("get must not be used for a deltas collection");
          },
        },
      },
    };

    const upserts: Array<[number, { name: string }]> = [];
    const removes: number[] = [];
    const { done } = mirrorRemoteSurface(deltaSurface, asClient(client), {
      collections: {
        procs: {
          upsert: (k, v) => upserts.push([k, v]),
          remove: (k) => removes.push(k),
        },
      },
    });

    await delay(20);
    expect(upserts).toEqual([
      [1, { name: "a" }],
      [2, { name: "b" }],
      [3, { name: "c" }],
    ]);
    expect(removes).toEqual([1]);

    open.resolve();
    await done;
  });

  it("prunes a carry-over key the fresh deltas snapshot omits (cross-reconnect reconcile)", async () => {
    // The deltas twin of the per-key reconcile test: a re-serve holds one cache
    // across reconnects; a key that departed while the link was down is not in the
    // new spawn's snapshot, so `initialKeys` + the first-snapshot reconcile prunes
    // it (no ghost) while the survivor is untouched (no empty flash).
    const cache = new Map<number, { name: string }>([
      [1, { name: "a" }],
      [2, { name: "b" }],
    ]);
    const removes: number[] = [];
    const open = Promise.withResolvers<void>();
    const client = {
      surface: {
        procs: {
          deltas: () =>
            seq<ProcFrame>(
              // Reconnect snapshot serves ONLY {1} — 2 departed while down.
              emit<ProcFrame>({
                kind: "snapshot",
                entries: [[1, { name: "a" }]],
              }),
              park(() => open.promise),
            ),
        },
      },
    };
    const { done } = mirrorRemoteSurface(deltaSurface, asClient(client), {
      collections: {
        procs: {
          initialKeys: () => cache.keys(),
          upsert: (k, v) => {
            cache.set(k, v);
          },
          remove: (k) => {
            cache.delete(k);
            removes.push(k);
          },
        },
      },
    });
    await delay(20);
    expect(removes).toEqual([2]); // the ghost was pruned on the fresh snapshot
    expect([...cache.keys()]).toEqual([1]); // survivor held, no flash
    open.resolve();
    await done;
  });

  it("rejects when the client lacks the `deltas` verb the collection declares", async () => {
    // A sink for a delta-declaring collection whose client has no `deltas` verb is a
    // client/surface mismatch — fail-fast, never a silent per-key fallback.
    const client = { surface: { procs: { keys: () => emit([]) } } };
    await expect(
      mirrorRemoteSurface(deltaSurface, asClient(client), {
        collections: { procs: { upsert: () => {}, remove: () => {} } },
      }).done,
    ).rejects.toThrow(/client\/surface mismatch/);
  });

  it("rejects when a deltas UPSERT sink throws — fail-fast", async () => {
    const client = {
      surface: {
        procs: {
          deltas: () =>
            seq<ProcFrame>(
              emit<ProcFrame>({
                kind: "snapshot",
                entries: [[1, { name: "a" }]],
              }),
              park(() => delay(50)),
            ),
        },
      },
    };
    await expect(
      mirrorRemoteSurface(deltaSurface, asClient(client), {
        collections: {
          procs: {
            upsert: () => {
              throw new Error("deltas upsert fold blew up");
            },
            remove: () => {},
          },
        },
      }).done,
    ).rejects.toThrow("deltas upsert fold blew up");
  });
});

// ── Procedures — the pull-side half of the total dual ─────────────────────
//
// A streaming primitive is PUSH (frames flow into a sink); a procedure is PULL
// (a local call runs on the remote and returns). So procedures don't live in the
// SurfaceSink — they come back as forwarding stubs on `mirrorRemoteSurface`'s
// return (`{ procedures, done }`). These tests pin that the stubs forward, that
// `serve ∘ mirror ≈ identity` holds once a re-served surface grafts them, and
// that a missing client entry fails loud (no silent undefined).

const procSurface = defineSurface({
  procedures: {
    math: {
      double: {
        input: Schema.Struct({ x: Schema.Number }),
        output: Schema.Struct({ y: Schema.Number }),
      },
      // no input — exercises the void-input forwarder shape.
      ping: { output: Schema.Struct({ pong: Schema.Boolean }) },
      // no output — exercises the void-output forwarder shape.
      reset: { input: Schema.Struct({ to: Schema.Number }) },
    },
  },
});

/** Serve `procSurface` in-process and hand back a client of it — the "remote" the
 *  mirror consumes. `surfaceClientRef` is the direct-dispatch face over the served
 *  handlers (what `directLink(router)` used to mint). `recordedResets` lets a test
 *  assert a no-output procedure actually ran on the far side. */
function serveProc(recordedResets: number[] = []) {
  const served = implementSurface(procSurface, {
    procedures: {
      math: {
        double: ({ input }) => Effect.succeed({ y: input.x * 2 }),
        ping: () => Effect.succeed({ pong: true }),
        reset: ({ input }) =>
          Effect.sync(() => {
            recordedResets.push(input.to);
          }),
      },
    },
  });
  return surfaceClientRef(procSurface, served);
}

describe("mirrorRemoteSurface — procedures (the total dual)", () => {
  it("forwards each procedure kind (in+out, no-input, no-output) to the remote", async () => {
    const resets: number[] = [];
    const mirror = mirrorRemoteSurface(procSurface, serveProc(resets), {});

    expect(
      await Effect.runPromise(mirror.procedures.math.double({ x: 21 })),
    ).toEqual({ y: 42 });
    expect(await Effect.runPromise(mirror.procedures.math.ping())).toEqual({
      pong: true,
    });
    await expect(
      Effect.runPromise(mirror.procedures.math.reset({ to: 7 })),
    ).resolves.toBeUndefined();
    expect(resets).toEqual([7]); // the no-output call actually ran on the far side
  });

  it("serve ∘ mirror ≈ identity — a re-served forwarded procedure round-trips", async () => {
    // Mirror the remote, then RE-SERVE the mirror by grafting its forwarders into
    // a second `implementSurface`. The re-served surface must behave like the
    // remote — the location-transparency the whole epic rests on. The graft is a
    // passthrough now: a handler wants an `Effect` and a forwarder IS one, so
    // there is no adapter between them to get wrong. `orDie` only because THIS
    // surface declares no error for these members — a remote failure is undeclared
    // here, so it crosses as a defect (exactly what the old `Effect.promise` did
    // to a rejection). A surface that DID declare one would graft bare.
    const mirror = mirrorRemoteSurface(procSurface, serveProc(), {});
    const reServedRuntime = implementSurface(procSurface, {
      procedures: {
        math: {
          double: ({ input }) =>
            Effect.orDie(mirror.procedures.math.double(input)),
          ping: () => Effect.orDie(mirror.procedures.math.ping()),
          reset: ({ input }) =>
            Effect.orDie(mirror.procedures.math.reset(input)),
        },
      },
    });
    const reServed = surfaceClientRef(procSurface, reServedRuntime);
    expect(
      await Effect.runPromise(reServed.surface.math.double({ x: 21 })),
    ).toEqual({ y: 42 });
    expect(await Effect.runPromise(reServed.surface.math.ping())).toEqual({
      pong: true,
    });
  });

  it("mirrors a stream into a sink AND forwards a procedure in one call", async () => {
    // The headline: one declarative call drives BOTH halves of the dual — the
    // streaming sink (push) and the procedure forwarder (pull) — over one client.
    const mixed = defineSurface({
      streams: {
        ticks: {
          inputSchema: Schema.Struct({ n: Schema.Number }),
          outputSchema: Schema.Struct({ i: Schema.Number }),
        },
      },
      procedures: {
        math: {
          double: {
            input: Schema.Struct({ x: Schema.Number }),
            output: Schema.Struct({ y: Schema.Number }),
          },
        },
      },
    });
    const served = implementSurface(mixed, {
      streams: {
        ticks: {
          source: (input) =>
            Stream.fromIterable(
              Array.from({ length: input.n }, (_, i) => ({ i })),
            ),
        },
      },
      procedures: {
        math: { double: ({ input }) => Effect.succeed({ y: input.x * 2 }) },
      },
    });
    const client = surfaceClientRef(mixed, served);

    const frames: number[] = [];
    const mirror = mirrorRemoteSurface(mixed, client, {
      streams: { ticks: { input: { n: 3 }, onFrame: (f) => frames.push(f.i) } },
    });
    expect(
      await Effect.runPromise(mirror.procedures.math.double({ x: 4 })),
    ).toEqual({ y: 8 });
    await mirror.done; // the ticks stream yielded 3 frames then closed → settles.
    expect(frames).toEqual([0, 1, 2]);
  });

  it("a forwarder for a procedure the client lacks FAILS (client/surface mismatch)", async () => {
    // Omitting a streaming sink is non-interest; a procedure stub is always
    // present (the dual is total), but calling one the client doesn't expose is a
    // mismatch — it must fail loudly, never succeed with undefined.
    const client = { surface: {} };
    const mirror = mirrorRemoteSurface(procSurface, asClient(client), {});
    await expect(
      Effect.runPromise(mirror.procedures.math.double({ x: 1 })),
    ).rejects.toThrow(/client\/surface mismatch/);
    // The lazy procedure channel and the eager streaming channel raise the SAME
    // type, so a consumer can `instanceof`-discriminate the one fault regardless
    // of which channel delivered it.
    await expect(
      Effect.runPromise(mirror.procedures.math.double({ x: 1 })),
    ).rejects.toBeInstanceOf(ClientSurfaceMismatchError);
  });

  it("exposes an empty procedures map for a surface with no procedures", () => {
    const client = { surface: { count: { get: () => emit(0) } } };
    const mirror = mirrorRemoteSurface(testSurface, asClient(client), {
      cells: { count: () => {} },
    });
    expect(mirror.procedures).toEqual({});
  });

  // F1 (R7 breaking change): the return is the plain handle `{ procedures, done }`,
  // NOT a thenable. A stale consumer that kept the old `await mirrorRemoteSurface(...)`
  // form must NOT silently get the old settle semantics — `await handle` resolves to
  // the handle itself at once and does not wait for the link to close. The settle is
  // `.done`. This pins that contract in CI so nobody re-introduces a back-compat
  // thenable shim (which `await` would silently honour, hiding the changed contract)
  // and so the doc note's claim is machine-checked, not just prose.
  it("returns a non-thenable handle — a bare `await` does NOT wait for the link", async () => {
    // A stream that stays OPEN: `done` must still be pending after a bare await, so
    // the bare await provably did not wait for the link to close.
    const ticksOpen = Promise.withResolvers<void>();
    const client = {
      surface: {
        ticks: {
          get: () =>
            seq(
              emit(0),
              park(() => ticksOpen.promise),
            ),
        },
      },
    };
    const handle = mirrorRemoteSurface(testSurface, asClient(client), {
      streams: { ticks: { input: {}, onFrame: () => {} } },
    });

    // The handle is not a promise — `await` on it is the identity, not a settle.
    expect(typeof (handle as { then?: unknown }).then).toBe("undefined");
    const awaited = await handle;
    expect(awaited).toBe(handle); // `await` gave back the object, not `undefined`

    // The link is still open, so the REAL settle (`.done`) is still pending — proof
    // the bare await did not behave like the old `Promise<void>` return.
    let settled = false;
    void handle.done.then(() => {
      settled = true;
    });
    await delay(10);
    expect(settled).toBe(false);

    ticksOpen.resolve();
    await handle.done; // now the link closed → `.done` settles
    expect(settled).toBe(true);
  });
});
