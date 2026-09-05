/**
 * `followingWire` — the wire that keeps standing while the link underneath it is
 * replaced.
 *
 * Three things make it usable at all, and each is pinned here rather than inferred
 * from the seam that consumes it:
 *
 *   1. calls follow the CURRENT generation, and the dispatch is branded half-open
 *      so `createLiveSignal` accepts it (an unbranded one would be handed a
 *      constant-`true` liveness leg — the #1564 lie);
 *   2. a call IN FLIGHT across an `adopt` fails as a TRANSPORT error, because that
 *      is the only failure the face's per-subscription retry fence re-subscribes
 *      on — the whole recovery story rests on this one `_tag`;
 *   3. the status funnel and the superseded generation's release are the wire's
 *      own, so nothing above it has to know a generation changed.
 */

import { Cause, Effect, Exit, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { isTransportError } from "../client";
import {
  brandHalfOpenDispatch,
  isHalfOpenDispatch,
  type SurfaceDispatch,
  type WatchableWire,
  type WireStatus,
  type WireTransport,
} from "../link";
import { followingWire, type WireGeneration } from "./following";

/** A generation with a driveable wire and a dispatch that reports which
 *  generation answered — enough to tell "the call went to the new link" from
 *  "the call went to the old one". */
function generation(
  name: string,
  initial: WireStatus = "open",
  refuseRelease?: Error,
): WireGeneration & {
  set: (status: WireStatus) => void;
  reconnects: () => number;
  disposals: () => number;
  watchers: () => number;
} {
  let status = initial;
  let reconnects = 0;
  let disposals = 0;
  const cbs = new Set<(s: WireStatus) => void>();
  const wire: WatchableWire = {
    status: () => status,
    onStatus: (cb) => {
      cbs.add(cb);
      return () => {
        cbs.delete(cb);
      };
    },
    forceReconnect: () => {
      reconnects += 1;
    },
  };
  const dispatch: SurfaceDispatch = brandHalfOpenDispatch({
    // `surface/never` never answers, so a call on it is still in flight when the
    // test adopts underneath it.
    unary: (tag: string) =>
      tag === "surface/never" ? Effect.never : Effect.succeed(name),
    stream: (tag: string) =>
      tag === "surface/never" ? Stream.never : Stream.make(name),
  });
  const transport: WireTransport = { dispatch, wire };
  return {
    transport,
    dispose: async () => {
      disposals += 1;
      if (refuseRelease) throw refuseRelease;
    },
    set: (next) => {
      if (next === status) return;
      status = next;
      for (const cb of [...cbs]) cb(next);
    },
    reconnects: () => reconnects,
    disposals: () => disposals,
    watchers: () => cbs.size,
  };
}

/** Flush past the microtask queue AND the macrotask boundary. */
const settle = (): Promise<unknown> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("followingWire — one wire over a succession of links", () => {
  it("dispatches over the CURRENT generation, through a branded half-open dispatch", async () => {
    const first = generation("first");
    const wire = followingWire(first);
    // Branded: `createLiveSignal` refuses a dispatch no link factory minted, and
    // `surfaceClient` refuses a bare wire dispatch — a following wire is a wire,
    // so it wears the brand its own generations wear.
    expect(isHalfOpenDispatch(wire.dispatch)).toBe(true);
    expect(await Effect.runPromise(wire.dispatch.unary("surface/x", {}))).toBe(
      "first",
    );

    const second = generation("second");
    await wire.adopt(second);
    expect(await Effect.runPromise(wire.dispatch.unary("surface/x", {}))).toBe(
      "second",
    );
    expect(wire.current()).toBe(second.transport);
    // The superseded generation was released by the wire that held it — not by
    // a caller that had to remember to.
    expect(first.disposals()).toBe(1);
    // ...and its status subscription went with it, so a long-lived wire does not
    // accumulate one watcher per roster move.
    expect(first.watchers()).toBe(0);
  });

  it("FAILS a stream in flight across an adopt, as the transport error the fence retries on", async () => {
    const first = generation("first");
    const wire = followingWire(first);
    const running = Effect.runPromiseExit(
      Stream.runDrain(wire.dispatch.stream("surface/never", {})),
    );
    await wire.adopt(generation("second"));
    const exit = await running;
    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
    // THE fact the whole recovery story rests on: `isTransportError` is what
    // `shouldRetryStreamError` consults, so a supersession that failed as
    // anything else would strand every standing subscription.
    expect(isTransportError(error)).toBe(true);
    expect(String(error)).toMatch(/adopted a new generation beneath this call/);
  });

  it("FAILS a unary in flight across an adopt", async () => {
    const first = generation("first");
    const wire = followingWire(first);
    const running = Effect.runPromise(
      wire.dispatch.unary("surface/never", {}),
    ).then(
      () => "resolved",
      (err: unknown) => String(err),
    );
    await wire.adopt(generation("second"));
    expect(await running).toMatch(/adopted a new generation beneath this call/);
  });

  it("funnels status: a generation's own changes, and the change an adopt itself is", async () => {
    const first = generation("first", "open");
    const wire = followingWire(first);
    const seen: WireStatus[] = [];
    wire.wire.onStatus((s) => seen.push(s));
    expect(wire.wire.status()).toBe("open");

    // The held generation's own drop reaches the funnel.
    first.set("closed");
    expect(seen).toEqual(["closed"]);
    expect(wire.wire.status()).toBe("closed");

    // Adopting a generation in a DIFFERENT state publishes the difference — a
    // reader and a watcher can never disagree about what this wire is doing.
    const second = generation("second", "open");
    await wire.adopt(second);
    expect(seen).toEqual(["closed", "open"]);
    expect(wire.wire.status()).toBe("open");

    // ...and the NEW generation's changes are the ones that reach it now.
    second.set("connecting");
    expect(seen).toEqual(["closed", "open", "connecting"]);
    // Adopting a generation in the SAME state says nothing — the wire never went
    // anywhere, which is the whole claim a roster move makes.
    const third = generation("third", "connecting");
    await wire.adopt(third);
    expect(seen).toEqual(["closed", "open", "connecting"]);
  });

  it("forwards forceReconnect to the generation currently held", async () => {
    const first = generation("first");
    const wire = followingWire(first);
    wire.wire.forceReconnect();
    expect(first.reconnects()).toBe(1);
    const second = generation("second");
    await wire.adopt(second);
    wire.wire.forceReconnect();
    expect(first.reconnects()).toBe(1);
    expect(second.reconnects()).toBe(1);
  });

  it("LOGS a superseded generation's failed release rather than rejecting the adopt", async () => {
    // The value `adopt` exists to produce — the new generation, live, with every
    // superseded call already failed — is delivered BEFORE the old one is closed.
    // Rejecting over that teardown would tell the caller a move which completed
    // did not, and there is no other channel for it to hear the real outcome on.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = generation("first", "open", new Error("release refused"));
    const wire = followingWire(first);
    const second = generation("second");
    await expect(wire.adopt(second)).resolves.toBeUndefined();
    // The move happened...
    expect(wire.current()).toBe(second.transport);
    expect(await Effect.runPromise(wire.dispatch.unary("surface/x", {}))).toBe(
      "second",
    );
    // ...and the leak is NAMED rather than swallowed.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toMatch(
      /releasing the superseded generation FAILED/,
    );
    errors.mockRestore();
  });

  it("sweeps the superseded calls even when a status watcher THROWS", async () => {
    // The ordering law is advance → notify → sweep, and the sweep runs in a
    // `finally`: a consumer callback that throws must not leave calls bound below
    // the mark with nothing left to fail them — they would park forever over a
    // wire that reports itself healthy, which is the whole class this fence exists
    // to close.
    const first = generation("first", "closed");
    const wire = followingWire(first);
    wire.wire.onStatus(() => {
      throw new Error("a consumer's status handler threw");
    });
    const running = Effect.runPromise(
      wire.dispatch.unary("surface/never", {}),
    ).then(
      () => "resolved",
      (err: unknown) => String(err),
    );
    // The throw escapes `adopt` (it is the consumer's, not this wire's to
    // swallow) — SYNCHRONOUSLY, and the sweep still ran.
    const second = generation("second", "open");
    expect(() => wire.adopt(second)).toThrow(
      /a consumer's status handler threw/,
    );
    expect(await running).toMatch(/adopted a new generation beneath this call/);
    // ...AND the superseded generation was still RELEASED. Written as a plain
    // statement after the advance, this was a leak: the swap had already
    // happened, so the old link was reachable from nothing, and its reconnect
    // schedule, ping fiber and observers lived for the rest of the page. The
    // caller cannot clean it up either — the wire HAS taken the new generation,
    // so its own `dispose()` closes that one and the corpse is unreachable.
    await settle();
    expect(first.disposals()).toBe(1);
    expect(wire.current()).toBe(second.transport);
  });

  it("counts a usable connection ESTABLISHED — the reconnect edge and the adopt edge", async () => {
    // The fact the status funnel cannot carry, because it is DEDUPLICATED. A
    // consumer whose answer came FROM the connection (a viewer identity resolved
    // from the upgrade's headers) has no other way to hear that a different
    // socket is carrying its calls now.
    const first = generation("first", "connecting");
    const wire = followingWire(first);
    const seen: number[] = [];
    const off = wire.onEstablished((n) => seen.push(n));
    expect(wire.establishments()).toBe(0);

    // The first connection.
    first.set("open");
    expect(seen).toEqual([1]);
    // A RECONNECT inside this generation is a second establishment...
    first.set("closed");
    first.set("open");
    expect(seen).toEqual([1, 2]);
    // ...and a status that is not a connection is not one.
    first.set("connecting");
    expect(seen).toEqual([1, 2]);
    first.set("open");
    expect(seen).toEqual([1, 2, 3]);

    // THE ADOPT EDGE, open → open: the funnel has nothing to publish, and this
    // is the case the whole fact exists for.
    const statuses: WireStatus[] = [];
    wire.wire.onStatus((next) => statuses.push(next));
    await wire.adopt(generation("second", "open"));
    expect(statuses).toEqual([]); // the funnel said nothing...
    expect(seen).toEqual([1, 2, 3, 4]); // ...and a connection was established.

    // An adopt onto a replacement that is still CONNECTING counts when it
    // OPENS, not when it is adopted.
    const third = generation("third", "connecting");
    await wire.adopt(third);
    expect(seen).toEqual([1, 2, 3, 4]);
    third.set("open");
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    // MONOTONIC across generations — it never restarts with the underlying link.
    expect(wire.establishments()).toBe(5);

    // Unsubscribing stops the handler and nothing else.
    off();
    third.set("closed");
    third.set("open");
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(wire.establishments()).toBe(6);
  });

  it("counts the connection a wire is BORN holding, and none it never took", async () => {
    // A first generation that is already open IS an established connection — a
    // consumer keying a fetch on the count must not have to wait for a reconnect
    // to make its first one.
    const born = followingWire(generation("first", "open"));
    expect(born.establishments()).toBe(1);

    // "A failed replacement attempt that leaves the existing connection in place
    // must not claim a new established connection." A refused adopt throws before
    // the swap; a dial that failed never reaches `adopt` at all.
    await born.dispose();
    const orphan = generation("orphan", "open");
    expect(() => born.adopt(orphan)).toThrow(/`adopt` on a disposed wire/);
    expect(born.establishments()).toBe(1);
  });

  it("counts the establishment even when a status watcher THROWS", async () => {
    // The same class as the superseded release, one line further in. `publish`
    // runs consumer callbacks; the throw must escape, but it must not take the
    // count with it — and it would have taken it PERMANENTLY, because the
    // detector is armed `false` before the swap and a status reports CHANGES
    // only, so the newly-open generation would never announce itself again and
    // that socket would go uncounted for the life of the connection.
    //
    // The throw is only reachable where there IS something to publish, so the
    // statuses here DIFFER across the adopt — open → open, the other
    // establishment edge, notifies nobody and so has no consumer to throw.
    const first = generation("first", "closed");
    const wire = followingWire(first);
    const seen: number[] = [];
    wire.onEstablished((n) => seen.push(n));
    wire.wire.onStatus(() => {
      throw new Error("a consumer's status handler threw");
    });
    expect(wire.establishments()).toBe(0);

    // The ADOPT edge, closed → open.
    const second = generation("second", "open");
    expect(() => wire.adopt(second)).toThrow(
      /a consumer's status handler threw/,
    );
    expect(seen).toEqual([1]);
    expect(wire.establishments()).toBe(1);
    // The wire really did move — this is not a refusal.
    expect(wire.current()).toBe(second.transport);

    // ...and the RECONNECT edge, same guarantee.
    expect(() => second.set("closed")).toThrow(
      /a consumer's status handler threw/,
    );
    expect(() => second.set("open")).toThrow(
      /a consumer's status handler threw/,
    );
    expect(seen).toEqual([1, 2]);
    expect(wire.establishments()).toBe(2);
    await settle();
    await wire.dispose();
  });

  it("releases the held generation on dispose — idempotently — and refuses a later adopt", async () => {
    const first = generation("first");
    const wire = followingWire(first);
    await wire.dispose();
    await wire.dispose();
    expect(first.disposals()).toBe(1);
    const orphan = generation("orphan");
    expect(() => wire.adopt(orphan)).toThrow(/`adopt` on a disposed wire/);
    // The refused generation is the caller's to release: the wire never took it.
    expect(orphan.disposals()).toBe(0);
  });

  it("REFUSES SYNCHRONOUSLY — the caller's next statement never runs over a wire that did not move", async () => {
    // Declared `async`, the refusal came back as a rejected promise a microtask
    // later: a caller reading the return as "the superseded release" ran its
    // whole handover — moved its clients, announced the new roster — over a wire
    // that had refused the generation, and heard about it only afterwards. The
    // guard now lands where it decides.
    const first = generation("first");
    const wire = followingWire(first);
    await wire.dispose();
    const orphan = generation("orphan");
    let ranAfter = false;
    expect(() => {
      void wire.adopt(orphan);
      // Unreachable: the line a caller writes after `adopt` is exactly what must
      // not run when the wire refused.
      ranAfter = true;
    }).toThrow(/`adopt` on a disposed wire/);
    expect(ranAfter).toBe(false);
    // ...and no rejected promise was left unhandled: there is no promise at all
    // on the refusing path.
    expect(orphan.disposals()).toBe(0);
  });

  it("hands back the superseded generation's release — a promise the caller may await LAST", async () => {
    // The swap is the statement; the release is the promise. A caller that never
    // awaits it still gets a wire that has fully moved.
    const first = generation("first");
    const wire = followingWire(first);
    const second = generation("second");
    const superseded = wire.adopt(second);
    // Already moved, in the same tick, before anything is awaited — including
    // the dispatch, which is what makes "the wire is never between generations"
    // a claim about the caller's next STATEMENT.
    expect(wire.current()).toBe(second.transport);
    expect(await Effect.runPromise(wire.dispatch.unary("surface/x", {}))).toBe(
      "second",
    );
    await expect(superseded).resolves.toBeUndefined();
    expect(first.disposals()).toBe(1);
  });

  it("gives a second `dispose()` the SAME promise, so neither can claim a teardown that has not happened", async () => {
    // An early `return` resolved while the generation's teardown was still
    // running — a `dispose()` that says "done" over a socket still closing. The
    // walk is memoized instead, which is the law `trackConnectAllocations` states
    // one layer up and `surfaceClients`' bundle raises rather than break.
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    let disposals = 0;
    const first: WireGeneration = {
      transport: generation("first").transport,
      dispose: async () => {
        disposals += 1;
        await slow;
      },
    };
    const wire = followingWire(first);
    const one = wire.dispose();
    const two = wire.dispose();
    // The SAME promise — not a fresh, already-resolved one for the second caller.
    expect(two).toBe(one);
    let secondSettled = false;
    void two.then(() => {
      secondSettled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    // The teardown is still running, so NEITHER call has resolved.
    expect(secondSettled).toBe(false);
    release();
    await Promise.all([one, two]);
    expect(secondSettled).toBe(true);
    expect(disposals).toBe(1);
  });
});
