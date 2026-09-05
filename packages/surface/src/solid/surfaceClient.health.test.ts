/**
 * `surfaceClient` enrols EVERY subscription it creates into `client.health()` —
 * the registry must be TOTAL (`./health`). A `health()` that reads `ready` while
 * a real sub is dead, behind a confident `<SurfaceGate>`, is worse than an
 * honest hand-rolled gate, so this pins each birth site by name:
 *
 *   - a cell                          → `"<cell>"`
 *   - the collection keys-stream      → `"<coll>.keys"`        (Leak B)
 *   - each per-key collection value   → `"<coll>[<id>]"`
 *   - a stream                        → `"<stream>"`
 *
 * Reverting any one enrol site drops its name from this set, so the totality
 * assertion fails — exactly the acceptance criterion. A second test pins that a
 * forced stream failure surfaces through `health()` (not a silent `error()`).
 *
 * The per-key subs here fan out from the DEFAULT keys-stream's own yield (not a
 * hand-fed signal): the package's vitest config inlines `solid-js`, so a
 * `createStore`-backed subscription value re-runs the `mapArray` keyed off it —
 * exactly as a real Solid render tree does in production (kolu's terminal
 * collection). The byKey-reading effect is what makes those per-key owners go
 * LIVE; without an observer `mapArray` never instantiates a key's sub.
 */

import { Effect, Schema, Stream } from "effect";
import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { defineSurface, defineSurfaceWithPolicy } from "../define";
import {
  brandHalfOpenDispatch,
  type SurfaceDispatch,
  type WatchableWire,
} from "../link";
import type { SurfaceHealth } from "./health";
import { createLiveSignal, type LiveSignalHandle } from "./liveSignal";
import {
  buildSurfaceClient,
  surfaceClient,
  surfaceClients,
  surfaceClientsHealth,
} from "./surfaceClient";

/** A tag-keyed {@link SurfaceDispatch} — the shape `surfaceClient` consumes now.
 *  The client builds the nested `surface.<member>.<verb>` face ITSELF
 *  (`buildSurfaceFace`), so a test stubs the DISPATCH one layer down, keyed by the
 *  flat wire tag `surface/<member>/<verb>`. Each streaming entry is a FACTORY run
 *  per subscribe; an unlisted tag FAILS loudly rather than reading `undefined`. */
function fakeDispatch(
  streams: Record<string, () => Stream.Stream<unknown, unknown>> = {},
  unaries: Record<string, () => Promise<unknown>> = {},
): SurfaceDispatch {
  return {
    unary: (tag) => {
      const fn = unaries[tag];
      if (!fn) return Effect.fail(new Error(`no member served at "${tag}"`));
      return Effect.tryPromise({ try: () => fn(), catch: (e) => e });
    },
    stream: (tag) => {
      const fn = streams[tag];
      if (!fn) return Stream.fail(new Error(`no member served at "${tag}"`));
      return Stream.suspend(fn);
    },
  };
}

/** A dispatch BRANDED as crossing a half-openable WIRE — literally what every wire
 *  link factory (websocket / stdio / unix-socket) hands back, because they all
 *  apply this brand at the ONE seam they cross (`links/wire.ts`'s `openWireLink`).
 *  `resolveTransport` reads exactly that brand, so branding a bare fake exercises
 *  the guard at the precise seam it consults — no socket to stand up, and a future
 *  wire leg is covered by the same chokepoint. */
function halfOpenWireDispatch(): SurfaceDispatch {
  return brandHalfOpenDispatch(
    fakeDispatch({}, { "surface/system/live": () => Promise.resolve({}) }),
  );
}

/** A watchable wire whose socket is (and stays) open — the observability +
 *  recovery seam `createLiveSignal`'s watchdog needs. */
function fakeWire(): WatchableWire {
  return {
    status: () => "open",
    onStatus: () => () => {},
    forceReconnect: () => {},
  };
}

/** Mint a REAL `LiveSignalHandle` via `createLiveSignal` (the only minter) over a
 *  branded wire dispatch + a fake watchable wire — proving the brand round-trips
 *  end-to-end (no test-only stub brander; the handle is branded at mint and there is
 *  no importable stamper). The handle bundles the `live` and the DISPATCH the
 *  watchdog probes as ONE object, so a client accepts the WHOLE handle (real usage —
 *  `surfaceClient(surface, transport)`). The 15s watchdog interval never fires within
 *  a sync test; dispose it to be tidy. */
function brandedHandle(): LiveSignalHandle {
  return createLiveSignal(
    { dispatch: halfOpenWireDispatch(), wire: fakeWire() },
    {},
  );
}

const surface = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ state: Schema.String }),
      default: { state: "connecting" },
      verbs: ["get"],
    },
  },
  collections: {
    items: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
    },
  },
  streams: {
    activity: {
      inputSchema: Schema.Struct({}),
      outputSchema: Schema.Array(Schema.String),
    },
  },
});

/** A wire stream that yields `value` once then completes — the sub goes
 *  past-first-frame (pending → false) and stays healthy.
 *
 *  Deliberately ASYNC (an async generator, not `Stream.make`): a real wire stream
 *  always crosses an await before its first frame, and a SYNCHRONOUS stream runs to
 *  completion inside `Effect.runFork` — its typed end would land before `.use()`
 *  even returned, evicting the dedup slot mid-construction. */
function once<T>(value: T): Stream.Stream<T, unknown> {
  return Stream.fromAsyncIterable(
    (async function* () {
      yield value;
    })(),
    (e) => e,
  );
}

/** A wire stream that FAILS — `runStreamScoped` reports it and
 *  `createSubscription` records it in `error()`. A plain `Error` (not an
 *  `RpcClientError`), so the face's retry fence refuses to retry it. */
function rejecting(): Stream.Stream<never, unknown> {
  return Stream.fail(new Error("stream boom"));
}

/** A DRIVEABLE wire stream: each `push(v)` delivers `v` as the next frame (or
 *  queues it for the next `next()`), so a test can drive a cell's `value()` over
 *  time — exactly what a server-pushed `connection` cell does in production. */
function feed<T>() {
  let waiting: ((r: IteratorResult<T>) => void) | null = null;
  const queue: IteratorResult<T>[] = [];
  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          const next = queue.shift();
          if (next) return Promise.resolve(next);
          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };
  return {
    stream: (): Stream.Stream<T, unknown> =>
      Stream.fromAsyncIterable(iterable, (e) => e),
    push(value: T): void {
      const frame: IteratorResult<T> = { value, done: false };
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(frame);
      } else {
        queue.push(frame);
      }
    },
  };
}

const noop = () => Promise.resolve();

/** Flush past the microtask queue (async stream consumption) AND the macrotask
 *  boundary, matching this package's other subscription tests (`setTimeout(0)`).
 *  Two macrotasks: the keys-stream yields on the first, the per-key fan-out it
 *  triggers settles its own first frame on the second. */
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe("surfaceClient health registry — totality", () => {
  it("enrols a cell, the keys-stream, every per-key value sub, and a stream", async () => {
    const dispatch = fakeDispatch(
      {
        "surface/conn/get": () => once({ state: "connected" }),
        "surface/items/keys": () => once(["a", "b"]),
        "surface/items/get": () => once({ v: 1 }),
        "surface/activity/get": () => once<string[]>([]),
      },
      { "surface/items/upsert": noop, "surface/items/delete": noop },
    );
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      app.cells.conn.use();
      const items = app.collections.items.use({});
      app.streams.activity.use(() => ({}));
      // Consume the per-key subs so `mapArray` goes LIVE and creates (and thus
      // enrols) them — mirroring a component reading `byKey(id)`. An unobserved
      // per-key sub is never created, so it has nothing to be unhealthy about;
      // the registry tracks what's actually on screen.
      createEffect(() => {
        for (const id of items.keys()) items.byKey(id);
      });
      await settle();

      const names = app
        .health()
        .subs.map((s) => s.name)
        .sort();
      // Every birth site is present. Drop any one enrol → this set shrinks → fail.
      expect(names).toEqual(
        ["activity", "conn", "items.keys", "items[a]", "items[b]"].sort(),
      );
      // All healthy: no errors, none pending (each yielded its first frame).
      const h = app.health();
      expect(h.live).toBe(true);
      expect(h.subs.every((s) => s.error === undefined && !s.pending)).toBe(
        true,
      );
      dispose();
    });
  });

  it("surfaces a forced stream failure through health() (not a silent error())", async () => {
    const dispatch = fakeDispatch(
      {
        "surface/conn/get": rejecting,
        "surface/items/keys": () => once<string[]>([]),
        "surface/items/get": () => once({ v: 1 }),
        "surface/activity/get": () => once<string[]>([]),
      },
      { "surface/items/upsert": noop, "surface/items/delete": noop },
    );
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      app.cells.conn.use();
      app.collections.items.use({});
      app.streams.activity.use(() => ({}));
      await settle();

      const conn = app.health().subs.find((s) => s.name === "conn");
      expect(conn?.error?.message).toMatch(/stream boom/);
      dispose();
    });
  });

  it("surfaceClientsHealth folds sibling clients into ONE prefixed FACT (Leak D)", () => {
    // `surfaceClients` hands back N independent clients; this folds their health
    // into one fact a single `<SurfaceGate>` can gate on — prefixing each sub's
    // name with its surface key and AND-reducing `live` (one dead sibling makes
    // the composed app not-live). Stubbed `health()` accessors stand in for the
    // real per-client registries (whose folding `health.test.ts` already pins).
    const clients = {
      kolu: {
        health: (): SurfaceHealth => ({
          live: true,
          subs: [{ name: "conn", pending: false, error: undefined }],
        }),
      },
      surfaceApp: {
        health: (): SurfaceHealth => ({
          live: false,
          subs: [{ name: "buildInfo", pending: true, error: undefined }],
        }),
      },
    };
    const merged = surfaceClientsHealth(clients);
    expect(merged.live).toBe(false);
    expect(merged.subs).toEqual([
      { name: "kolu/conn", pending: false, error: undefined },
      { name: "surfaceApp/buildInfo", pending: true, error: undefined },
    ]);
  });

  it("folds a transport `live` accessor into health().live", async () => {
    // The fold itself, exercised through the internal builder so a stub dispatch and
    // a toggling `live` can be driven together (the public `surfaceClient` collapses
    // dispatch+live into one `LiveSignalHandle` — the end-to-end fold over a real
    // watchdog-backed handle is pinned in `createLiveSignal`/`transportLive` tests).
    const dispatch = fakeDispatch({
      "surface/conn/get": () => once({ state: "x" }),
    });
    await createRoot(async (dispose) => {
      let alive = true;
      const app = buildSurfaceClient(surface, dispatch, () => alive);
      app.cells.conn.use();
      await settle();
      expect(app.health().live).toBe(true);
      alive = false;
      expect(app.health().live).toBe(false);
      dispose();
    });
  });
});

describe("surfaceClient.rawStream — structural raw-stream enrolment (Leak A)", () => {
  const dispatch = fakeDispatch({
    "surface/conn/get": () => once({ state: "x" }),
  });

  it("THROWS when driven outside a reactive owner (structural, not a doc warning)", () => {
    const app = surfaceClient(surface, dispatch);
    // No `createRoot` ⇒ no owner ⇒ the enrolment would leak. It must THROW (the
    // `reduce`-without-`initial` precedent), never silently bypass health().
    expect(() =>
      app.rawStream(
        "raw",
        // A trivial stub procedure — never reached, the owner check throws first.
        () => once<number>(1),
        undefined,
        { onItem: () => {} },
      ),
    ).toThrow(/reactive owner/);
  });

  it("enrols structurally — a raw-stream failure surfaces through health()", async () => {
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      // A raw stream that fails — the example's processesSnapshot 500.
      app.rawStream("processesSnapshot", rejecting, undefined, {
        onItem: () => {},
      });
      await settle();
      const raw = app.health().subs.find((s) => s.name === "processesSnapshot");
      expect(raw).toBeDefined();
      expect(raw?.error?.message).toMatch(/stream boom/);
      // Errored-on-first-frame clears pending → reads `degraded`, not a stuck
      // `connecting`.
      expect(raw?.pending).toBe(false);
      dispose();
    });
  });

  it("goes healthy once its stream yields (pending → false, no error), returning the enrolled source", async () => {
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const got: number[] = [];
      const src = app.rawStream("snap", () => once<number>(7), undefined, {
        onItem: (n) => got.push(n),
      });
      await settle();
      expect(got).toEqual([7]);
      const raw = app.health().subs.find((s) => s.name === "snap");
      expect(raw?.pending).toBe(false);
      expect(raw?.error).toBeUndefined();
      // The returned source IS the enrolled one.
      expect(src.pending()).toBe(false);
      expect(src.error()).toBeUndefined();
      dispose();
    });
  });
});

describe("surfaceClient readiness fold — `liveWhen` completes the fact (round-5)", () => {
  // A mirror-shaped surface: a get-only `connection` cell that declares the
  // readiness `liveWhen` predicate (the framework mechanism a readiness cell rides).
  // The VOCABULARY (`state === "connected"`) rides the cell; the framework only
  // invokes it. Gate-closed default (`connecting`) so cold start reads not-live.
  const mirrored = defineSurface({
    cells: {
      connection: {
        schema: Schema.Struct({ state: Schema.String }),
        default: { state: "connecting" },
        verbs: ["get"],
        liveWhen: (v: { state: string }) => v.state === "connected",
      },
    },
  });

  it("folds the liveWhen cell into health().live EAGERLY — no `.use()`, by construction", async () => {
    const f = feed<{ state: string }>();
    const dispatch = fakeDispatch({ "surface/connection/get": f.stream });
    await createRoot(async (dispose) => {
      const app = surfaceClient(mirrored, dispatch);
      // CRITICAL: NO `.use()` anywhere. The readiness fold must be eager — a
      // dot-only viewer (or `<SurfaceGate>`/`<HostStatusPip>` that never mounts
      // the cell for presentation) must STILL read the complete fact, or the
      // green-over-dead-mirror lie has a `.use()`-conditional escape.
      await settle();
      // Cold start: gate-closed default ("connecting") → liveWhen false → NOT live.
      expect(app.health().live).toBe(false);
      // Totality: the connection cell's own sub is in `subs` (eagerly enrolled)
      // even with zero `.use()`.
      expect(app.health().subs.map((s) => s.name)).toEqual(["connection"]);

      // A genuine "connected" frame flips the fact live.
      f.push({ state: "connected" });
      await settle();
      expect(app.health().live).toBe(true);

      // A "failed" mirror flips it back — transport never moved; the fact carries
      // the mirror leg. THIS is the round-4 lie made unrenderable at the fact.
      f.push({ state: "failed" });
      await settle();
      expect(app.health().live).toBe(false);

      app.dispose();
      dispose();
    });
  });

  it("AND-folds the transport leg AND the mirror leg — both must hold for live", async () => {
    const f = feed<{ state: string }>();
    const dispatch = fakeDispatch({ "surface/connection/get": f.stream });
    await createRoot(async (dispose) => {
      let transport = true;
      // Internal builder: drive a stub mirror cell (feed) AND a toggling transport
      // leg together — the public `surfaceClient` collapses the pair into a handle.
      const app = buildSurfaceClient(mirrored, dispatch, () => transport);
      f.push({ state: "connected" });
      await settle();
      expect(app.health().live).toBe(true); // transport ∧ mirror both hold
      // Transport dies even though the mirror is still "connected" — a half-open
      // ws over a connected mirror must read NOT live.
      transport = false;
      expect(app.health().live).toBe(false);
      app.dispose();
      dispose();
    });
  });

  it("`.use()` SHARES the eager standing sub — ONE `connection` member, same value", async () => {
    const f = feed<{ state: string }>();
    const dispatch = fakeDispatch({ "surface/connection/get": f.stream });
    await createRoot(async (dispose) => {
      const app = surfaceClient(mirrored, dispatch);
      const cell = app.cells.connection.use();
      f.push({ state: "connected" });
      await settle();
      // Exactly ONE "connection" sub — the eager standing one, shared by `.use()`
      // — never a second `connection.get` stream / duplicate member.
      expect(
        app.health().subs.filter((s) => s.name === "connection"),
      ).toHaveLength(1);
      // `.use()` projects the SAME value as the standing sub.
      expect(cell.value()).toEqual({ state: "connected" });
      app.dispose();
      dispose();
    });
  });

  it("`.use({ onError })` on a shared `liveWhen` cell still fires on the standing sub's error (MINOR fix regression pin)", async () => {
    // The read-only `liveWhen` branch used to hand-roll its own TRACKED
    // `createEffect(() => { if (shared.error()) cb(...) })` instead of reusing
    // `wireSubscriptionError` — the same edge-wiring every other `onError` in
    // this file goes through. This pins that the shared-standing-sub `onError`
    // contract still fires after routing it through the shared helper.
    let reject: ((e: unknown) => void) | null = null;
    const iterable: AsyncIterable<{ state: string }> = {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise<IteratorResult<{ state: string }>>((_resolve, rej) => {
              reject = rej;
            }),
        };
      },
    };
    const dispatch = fakeDispatch({
      "surface/connection/get": () =>
        Stream.fromAsyncIterable(iterable, (e) => e),
    });
    await createRoot(async (dispose) => {
      const app = surfaceClient(mirrored, dispatch);
      const errors: Error[] = [];
      app.cells.connection.use({ onError: (e) => errors.push(e) });
      await settle();
      // Fault the standing sub's stream — a real rejection, the exact path
      // `runStreamScoped`'s failure channel takes.
      reject?.(new Error("mirror stream broke"));
      await settle();
      // The forwarded callback fires exactly once for the one fault, proving the
      // shared branch's `onError` still reaches the caller after the refactor.
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe("mirror stream broke");
      app.dispose();
      dispose();
    });
  });

  it("surfaceClientsHealth AND-folds a sibling's mirror leg (Leak D × readiness)", async () => {
    const fa = feed<{ state: string }>();
    const fb = feed<{ state: string }>();
    // The COMBINED dispatch: `surfaceClients` scopes each sibling's tags by
    // splicing the key in (`surface/<key>/<member>/<verb>`), so the stub is keyed
    // by exactly those composed tags.
    const combined = fakeDispatch({
      "surface/a/connection/get": fa.stream,
      "surface/b/connection/get": fb.stream,
    });
    await createRoot(async (dispose) => {
      const bundle = surfaceClients(combined, { a: mirrored, b: mirrored });
      const clients = bundle.clients;
      fa.push({ state: "connected" });
      fb.push({ state: "connected" });
      await settle();
      expect(surfaceClientsHealth(clients).live).toBe(true);
      // One sibling's mirror fails — the merged fact is not-live (AND-reduce).
      fb.push({ state: "failed" });
      await settle();
      expect(surfaceClientsHealth(clients).live).toBe(false);
      bundle.dispose();
      dispose();
    });
  });
});

describe("every half-openable WIRE link (websocket / stdio / unix-socket) demands a watchdog-backed `LiveSignal` — the half-open-blind leg is UNSPELLABLE", () => {
  // The round-5-found relocation, one seam upstream of the dot: `surfaceClient`'s
  // transport leg used to SILENTLY default to constant-`true` when `{ live }` was
  // omitted; round 5.2 made omitting it crash. But a TRUTHY-but-half-open-blind
  // `{ live }` — `() => true`, or an open/close-only `() => socketStatus() ===
  // "live"` — still read `live` forever over a silently dead websocket, so it was
  // a lie a future viewer could still SPELL. Now the guard requires a `LiveSignal`,
  // the brand only `createLiveSignal` mints (THROUGH the half-open watchdog it
  // wires). So a bare `() => true` is refused exactly like a missing one — the lie
  // can't be spelled, not merely not-rendered.
  //
  // And it is refused for EVERY wire link, not just websocket: the half-open brand
  // is applied at `openWireLink` — the one chokepoint every wire link crosses — so a
  // bare `stdioLink` / `unixSocketLink` (a pipe that wedges or an ssh tunnel that
  // partitions half-opens exactly like a websocket; `surface-remote`'s
  // `hostSession.startLiveness` hand-wires a watchdog over stdio for that reason)
  // is refused too, and a FUTURE wire link inherits the guard by construction.
  //
  // The guard reads exactly ONE thing — `isHalfOpenDispatch(transport)` — so the
  // tests below drive it with a `brandHalfOpenDispatch`-branded dispatch, which is
  // literally what a wire link factory hands back. That every real factory APPLIES
  // the brand is the transports tier's own contract, pinned where those factories
  // live (`links/*.test.ts`); what belongs HERE is that the face refuses a branded
  // dispatch, for every leg that carries the brand.

  it("surfaceClient over a bare half-openable WIRE dispatch throws, naming connectSurface / the cure", () => {
    const wire = halfOpenWireDispatch();
    expect(() => surfaceClient(surface, wire)).toThrow(
      /can silently half-open/,
    );
    // The message points at the cure (the turnkey seams / `createLiveSignal`).
    expect(() => surfaceClient(surface, wire)).toThrow(/connectSurface/);
  });

  it("surfaceClient over a BRANDED `LiveSignalHandle` is accepted — the watchdog-backed handle is the cure", () => {
    // The handle is minted ONLY by `createLiveSignal` (which wires the watchdog);
    // there is no importable stamper to forge one with. The client takes the WHOLE
    // handle — `dispatch` and `live` paired on one object, the only shape
    // `resolveTransport` accepts over a half-openable dispatch.
    const t = brandedHandle();
    expect(() => surfaceClient(surface, t)).not.toThrow();
    t.dispose();
  });

  it("the `watch ws1, build over ws2` forge is UNSPELLABLE — there is no API to pass a `live` paired with a separate dispatch", () => {
    // The old forge handed a genuine brand alongside a self-rolled second link.
    // Collapsing dispatch+live into ONE handle removes the seam: a caller has only
    // the handle (whose dispatch the watchdog probes) or a bare dispatch (no live at
    // all). A bare SECOND wire dispatch is still refused — pass the handle.
    const otherWire = halfOpenWireDispatch();
    expect(() => surfaceClient(surface, otherWire)).toThrow(
      /can silently half-open/,
    );
  });

  it("surfaceClients (the multi-surface bundle) refuses a bare combined wire dispatch, accepts a branded handle", () => {
    const wire = halfOpenWireDispatch();
    expect(() => surfaceClients(wire, { a: surface, b: surface })).toThrow(
      /can silently half-open/,
    );
    // Accepted as the WHOLE handle (built by `createLiveSignal`), the real
    // multi-surface shape: `surfaceClients(transport, surfaces)`.
    const t = brandedHandle();
    expect(() => surfaceClients(t, { a: surface, b: surface })).not.toThrow();
    t.dispose();
  });

  it("the NON-websocket wire legs (stdio, hence unixSocketLink) are REFUSED bare too — the green-dot lie #1568 closed for websocket relocated one transport over", () => {
    // The class, not the websocket PoC: a stdio/ssh pipe wedges or partitions
    // with no FIN exactly as a websocket half-opens (`closed` never flips, the
    // stream hangs on the last frame, `health().live` would read true forever).
    // `surface-remote` proves this is real by hand-wiring
    // `hostSession.startLiveness` over its own stdioLink.
    //
    // One branded fake covers ALL of them, and that is not a shortcut — it is the
    // structure of the guard. `brandHalfOpenDispatch` is the SINGLE chokepoint
    // every wire link factory (websocket, stdio, unix-socket — `unixSocketLink`
    // literally wraps `stdioLink`) crosses in `links/wire.ts`'s `openWireLink`, and
    // `resolveTransport` reads exactly that brand. So a per-leg reconstruction
    // would re-test one `WeakSet` membership check three times, while a FUTURE wire
    // leg inherits the guard from the same chokepoint without a test at all.
    const stdioLike = halfOpenWireDispatch();
    expect(() => surfaceClient(surface, stdioLike)).toThrow(
      /can silently half-open/,
    );
    // …and the message still names the STDIO cure, not only the websocket one.
    expect(() => surfaceClient(surface, stdioLike)).toThrow(
      /STDIO\/UNIX-SOCKET/,
    );
  });

  it("a direct/in-process dispatch (no wire — directDispatch) is accepted bare — constant-true is honest there", () => {
    // `directDispatch` is the ONE dispatch with no transport (a handler call in
    // process), so it never crosses `openWireLink` and is never branded
    // half-openable — its constant-`true` transport leg is honest by construction.
    // A plain UNBRANDED stub stands in for it here (the same by-exclusion path); a
    // real wire dispatch, by contrast, throws (above).
    const direct = fakeDispatch({
      "surface/conn/get": () => once({ state: "ok" }),
    });
    expect(() => surfaceClient(surface, direct)).not.toThrow();
  });
});

describe("surfaceClients builds a bundle ALL-OR-NOTHING", () => {
  // `buildSurfaceClient` opens REAL side effects before it returns — a mirrored
  // surface's eager `liveWhen` readiness subscription is live the moment the client
  // exists — and it can THROW: a sibling whose spec declares a `client.onError`
  // policy reached with no interpreter is refused at construction (design §D/F5).
  //
  // Built by a bare `.map`, the SECOND sibling's throw would propagate with the
  // first already subscribed and its only `dispose` handle inside the array element
  // the exception discards: a subscription running over the wire that nothing can
  // ever close. The guarantee has to live in `surfaceClients` itself, because a
  // caller can only ever see the value it returns — `connectSurfaces`' own unwind
  // cannot reach a child that was never handed back.
  const mirrored = defineSurface({
    cells: {
      connection: {
        schema: Schema.Struct({ state: Schema.String }),
        default: { state: "connecting" },
        verbs: ["get"],
        liveWhen: (v: { state: string }) => v.state === "connected",
      },
    },
  });
  const policied = defineSurfaceWithPolicy<{ kind: "toast"; label: string }>()({
    cells: {
      watch: {
        schema: Schema.Struct({ n: Schema.Number }),
        default: { n: 0 },
        verbs: ["get"],
        client: { onError: { kind: "toast", label: "watch" } },
      },
    },
  });

  it("releases the siblings it already built when a later one refuses", async () => {
    const torn: string[] = [];
    const f = feed<{ state: string }>();
    const dispatch = fakeDispatch({
      // The FIRST sibling's eager readiness sub, with a finalizer that records the
      // teardown. Its scoped tag carries the sibling key `surfaceClients` splices in.
      "surface/first/connection/get": () =>
        Stream.ensuring(
          f.stream(),
          Effect.sync(() => {
            torn.push("first");
          }),
        ),
    });
    // The bundle throws — the second sibling's declared policy has nowhere to go.
    expect(() =>
      surfaceClients(dispatch, { first: mirrored, second: policied }),
    ).toThrow(/no `onClientError` interpreter was threaded/);
    // …and the first sibling's subscription, opened before that throw, was closed
    // on the way out. Without the unwind inside `surfaceClients` this stays empty
    // and the stream runs for the life of the page.
    await settle();
    expect(torn).toEqual(["first"]);
  });

  it("keeps the whole bundle when every sibling builds", async () => {
    const torn: string[] = [];
    const f = feed<{ state: string }>();
    const dispatch = fakeDispatch({
      "surface/first/connection/get": () =>
        Stream.ensuring(
          f.stream(),
          Effect.sync(() => {
            torn.push("first");
          }),
        ),
    });
    const bundle = surfaceClients(dispatch, { first: mirrored });
    await settle();
    // Nothing torn down on the success path — the unwind is the failure exit only.
    expect(torn).toEqual([]);
    expect(Object.keys(bundle.clients)).toEqual(["first"]);
    bundle.clients.first.dispose();
    await settle();
    expect(torn).toEqual(["first"]);
  });
});
