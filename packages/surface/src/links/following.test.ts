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
import { describe, expect, it } from "vitest";
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

  it("releases the held generation on dispose — idempotently — and refuses a later adopt", async () => {
    const first = generation("first");
    const wire = followingWire(first);
    await wire.dispose();
    await wire.dispose();
    expect(first.disposals()).toBe(1);
    const orphan = generation("orphan");
    await expect(wire.adopt(orphan)).rejects.toThrow(
      /`adopt` on a disposed wire/,
    );
    // The refused generation is the caller's to release: the wire never took it.
    expect(orphan.disposals()).toBe(0);
  });
});
