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

import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "../define";
import { websocketLink } from "../links/websocket";
import type { SurfaceHealth } from "./health";
import { createLiveSignal } from "./liveSignal";
import {
  surfaceClient,
  surfaceClients,
  surfaceClientsHealth,
} from "./surfaceClient";

/** A socket reduced to listeners — tolerant of arbitrary event types so it
 *  survives `websocketLink(ws)` construction without ever sending an RPC. */
function fakeWs(): WebSocket {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    send: () => {},
    close: () => {},
    reconnect: () => {},
    readyState: 0,
    OPEN: 1,
    // biome-ignore lint/suspicious/noExplicitAny: minimal stand-in for the WebSocket shape websocketLink threads through.
  } as any;
}

/** Mint a REAL `LiveSignal` via `createLiveSignal` (the only minter) over a fake
 *  watchable socket — proving the brand round-trips end-to-end (no test-only stub
 *  brander; `brandLiveSignal` is module-private and un-importable now). The 15s
 *  watchdog interval never fires within a sync test; dispose it to be tidy. */
function brandedLive(): {
  live: ReturnType<typeof createLiveSignal>["live"];
  dispose: () => void;
} {
  // biome-ignore lint/suspicious/noExplicitAny: fakeWs is a structural stand-in for a partysocket.
  const t = createLiveSignal(fakeWs() as any, {});
  return { live: t.live, dispose: t.dispose };
}

const surface = defineSurface({
  cells: {
    conn: {
      schema: z.object({ state: z.string() }),
      default: { state: "connecting" },
      verbs: ["get"],
    },
  },
  collections: {
    items: { keySchema: z.string(), schema: z.object({ v: z.number() }) },
  },
  streams: {
    activity: { inputSchema: z.object({}), outputSchema: z.array(z.string()) },
  },
});

/** A wire stream that yields `value` once then completes — the sub goes
 *  past-first-frame (pending → false) and stays healthy. Ignores its
 *  `(input, opts)` args. */
function once<T>(value: T) {
  return (..._args: unknown[]): Promise<AsyncIterable<T>> =>
    Promise.resolve(
      (async function* () {
        yield value;
      })(),
    );
}

/** A wire stream source whose await REJECTS — `createSubscription` catches it and
 *  sets `error()`. */
function rejecting() {
  return (..._args: unknown[]): Promise<AsyncIterable<never>> =>
    Promise.reject(new Error("stream boom"));
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
    procedure: (..._args: unknown[]): Promise<AsyncIterable<T>> =>
      Promise.resolve(iterable),
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
    const link = {
      surface: {
        conn: { get: once({ state: "connected" }) },
        items: {
          keys: once(["a", "b"]),
          get: once({ v: 1 }),
          upsert: noop,
          delete: noop,
        },
        activity: { get: once<string[]>([]) },
      },
    };
    await createRoot(async (dispose) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed ContractRouterClient.
      const app = surfaceClient(surface, link as any);
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
    const link = {
      surface: {
        conn: { get: rejecting() },
        items: {
          keys: once<string[]>([]),
          get: once({ v: 1 }),
          upsert: noop,
          delete: noop,
        },
        activity: { get: once<string[]>([]) },
      },
    };
    await createRoot(async (dispose) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed ContractRouterClient.
      const app = surfaceClient(surface, link as any);
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

  it("threads a transport `live` accessor into health().live", async () => {
    const link = { surface: { conn: { get: once({ state: "x" }) } } };
    await createRoot(async (dispose) => {
      let alive = true;
      const app = surfaceClient(
        surface,
        // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed ContractRouterClient.
        link as any,
        { live: () => alive },
      );
      app.cells.conn.use();
      await settle();
      expect(app.health().live).toBe(true);
      alive = false;
      expect(app.health().live).toBe(false);
      dispose();
    });
  });

  it("surfaceClients threads ONE transport `live` into every sibling (not a constant true)", async () => {
    // The siblings ride ONE combined socket, so they share ONE liveness.
    // `surfaceClients` threads its `{ live }` opt to each sibling client, so
    // `surfaceClientsHealth`'s AND-reduce can flip the merged fact `live: false`
    // when that socket dies — instead of the structurally-constant `true` the
    // un-threaded path leaves (a dead combined socket invisible to every sibling).
    const combined = {
      surface: {
        a: { conn: { get: once({ state: "x" }) } },
        b: { conn: { get: once({ state: "x" }) } },
      },
    };
    await createRoot(async (dispose) => {
      let alive = true;
      const clients = surfaceClients(
        // biome-ignore lint/suspicious/noExplicitAny: stub combined link.
        combined as any,
        { a: surface, b: surface },
        { live: () => alive },
      );
      clients.a.cells.conn.use();
      clients.b.cells.conn.use();
      await settle();
      expect(surfaceClientsHealth(clients).live).toBe(true);
      alive = false;
      expect(surfaceClientsHealth(clients).live).toBe(false);
      dispose();
    });
  });
});

describe("surfaceClient.rawStream — structural raw-stream enrolment (Leak A)", () => {
  const link = { surface: { conn: { get: once({ state: "x" }) } } };

  it("THROWS when driven outside a reactive owner (structural, not a doc warning)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed ContractRouterClient.
    const app = surfaceClient(surface, link as any);
    // No `createRoot` ⇒ no owner ⇒ the enrolment would leak. It must THROW (the
    // `reduce`-without-`initial` precedent), never silently bypass health().
    expect(() =>
      app.rawStream(
        "raw",
        // biome-ignore lint/suspicious/noExplicitAny: trivial stub procedure (never reached — the owner check throws first).
        once<number>(1) as any,
        undefined,
        { onItem: () => {} },
      ),
    ).toThrow(/reactive owner/);
  });

  it("enrols structurally — a raw-stream failure surfaces through health()", async () => {
    await createRoot(async (dispose) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(surface, link as any);
      // A raw stream whose await rejects — the example's processesSnapshot 500.
      app.rawStream(
        "processesSnapshot",
        // biome-ignore lint/suspicious/noExplicitAny: rejecting stub procedure.
        rejecting() as any,
        undefined,
        { onItem: () => {} },
      );
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
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(surface, link as any);
      const got: number[] = [];
      const src = app.rawStream(
        "snap",
        // biome-ignore lint/suspicious/noExplicitAny: yielding stub procedure.
        once<number>(7) as any,
        undefined,
        { onItem: (n) => got.push(n as number) },
      );
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
  // readiness predicate, exactly as `surface-nix-host`'s `connectionCell` does.
  // The VOCABULARY (`state === "connected"`) rides the cell; the framework only
  // invokes it. Gate-closed default (`connecting`) so cold start reads not-live.
  const mirrored = defineSurface({
    cells: {
      connection: {
        schema: z.object({ state: z.string() }),
        default: { state: "connecting" },
        verbs: ["get"],
        liveWhen: (v: { state: string }) => v.state === "connected",
      },
    },
  });

  it("folds the liveWhen cell into health().live EAGERLY — no `.use()`, by construction", async () => {
    const f = feed<{ state: string }>();
    const link = { surface: { connection: { get: f.procedure } } };
    await createRoot(async (dispose) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed ContractRouterClient.
      const app = surfaceClient(mirrored, link as any);
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
    const link = { surface: { connection: { get: f.procedure } } };
    await createRoot(async (dispose) => {
      let transport = true;
      const app = surfaceClient(
        mirrored,
        // biome-ignore lint/suspicious/noExplicitAny: stub link.
        link as any,
        { live: () => transport },
      );
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
    const link = { surface: { connection: { get: f.procedure } } };
    await createRoot(async (dispose) => {
      // biome-ignore lint/suspicious/noExplicitAny: stub link.
      const app = surfaceClient(mirrored, link as any);
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

  it("surfaceClientsHealth AND-folds a sibling's mirror leg (Leak D × readiness)", async () => {
    const fa = feed<{ state: string }>();
    const fb = feed<{ state: string }>();
    const combined = {
      surface: {
        a: { connection: { get: fa.procedure } },
        b: { connection: { get: fb.procedure } },
      },
    };
    await createRoot(async (dispose) => {
      const clients = surfaceClients(
        // biome-ignore lint/suspicious/noExplicitAny: stub combined link.
        combined as any,
        { a: mirrored, b: mirrored },
      );
      fa.push({ state: "connected" });
      fb.push({ state: "connected" });
      await settle();
      expect(surfaceClientsHealth(clients).live).toBe(true);
      // One sibling's mirror fails — the merged fact is not-live (AND-reduce).
      fb.push({ state: "failed" });
      await settle();
      expect(surfaceClientsHealth(clients).live).toBe(false);
      for (const c of Object.values(clients)) c.dispose();
      dispose();
    });
  });
});

describe("a half-openable (websocket) link demands a watchdog-backed `LiveSignal` — the half-open-blind leg is UNSPELLABLE", () => {
  // The round-5-found relocation, one seam upstream of the dot: `surfaceClient`'s
  // transport leg used to SILENTLY default to constant-`true` when `{ live }` was
  // omitted; round 5.2 made omitting it crash. But a TRUTHY-but-half-open-blind
  // `{ live }` — `() => true`, or an open/close-only `() => socketStatus() ===
  // "live"` — still read `live` forever over a silently dead websocket, so it was
  // a lie a future viewer could still SPELL. Now the guard requires a `LiveSignal`,
  // the brand only `createLiveSignal` mints (THROUGH the half-open watchdog it
  // wires). So a bare `() => true` is refused exactly like a missing one — the lie
  // can't be spelled, not merely not-rendered.

  it("surfaceClient over a bare websocketLink throws, naming connectSurface / the cure", () => {
    const link = websocketLink(fakeWs());
    expect(() => surfaceClient(surface, link)).toThrow(
      /websocket link can silently half-open/,
    );
    // The message points at the cure (the turnkey seams / `createLiveSignal`).
    expect(() => surfaceClient(surface, link)).toThrow(/connectSurface/);
  });

  it("surfaceClient over a websocketLink with a BARE (unbranded) `{ live }` STILL throws — a half-open-blind signal is refused even though it's truthy", () => {
    const link = websocketLink(fakeWs());
    // `() => true` is the canonical half-open-blind signal: truthy forever, blind
    // to a silently dead socket. Round 5.2 would have accepted it (it only checked
    // presence); the brand refuses it.
    expect(() => surfaceClient(surface, link, { live: () => true })).toThrow(
      /watchdog-backed `LiveSignal`/,
    );
  });

  it("surfaceClient over a websocketLink with a BRANDED `LiveSignal` is accepted — the watchdog-backed brand is the cure", () => {
    const link = websocketLink(fakeWs());
    // The brand is minted ONLY by `createLiveSignal` (which wires the watchdog);
    // there is no importable `brandLiveSignal` to forge one with.
    const t = brandedLive();
    expect(() => surfaceClient(surface, link, { live: t.live })).not.toThrow();
    t.dispose();
  });

  it("surfaceClients (the multi-surface bundle) refuses a bare or unbranded `{ live }`, accepts a branded one", () => {
    const link = websocketLink(fakeWs());
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: combined link is walk-by-string.
      surfaceClients(link as any, { a: surface, b: surface }),
    ).toThrow(/websocket link can silently half-open/);
    // Unbranded `{ live }` over the combined socket is the green-over-dead lie for
    // EVERY sibling — refused.
    expect(() =>
      surfaceClients(
        // biome-ignore lint/suspicious/noExplicitAny: combined link is walk-by-string.
        link as any,
        { a: surface, b: surface },
        { live: () => true },
      ),
    ).toThrow(/watchdog-backed `LiveSignal`/);
    const t = brandedLive();
    expect(() =>
      surfaceClients(
        // biome-ignore lint/suspicious/noExplicitAny: combined link is walk-by-string.
        link as any,
        { a: surface, b: surface },
        { live: t.live },
      ),
    ).not.toThrow();
    t.dispose();
  });

  it("a direct/in-process link (not half-openable) is accepted with NO `{ live }` — and with a plain accessor too — constant-true is honest there", () => {
    // A plain stub link stands in for `directLink`/`stdioLink`: it was never
    // recorded in the half-open set, so the brand is NOT required — an in-process
    // transport can't silently half-open, so any `{ live }` (or none) is honest.
    const direct = { surface: { conn: { get: once({ state: "ok" }) } } };
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: stub direct link.
      surfaceClient(surface, direct as any),
    ).not.toThrow();
    // A plain (unbranded) accessor is fine over a direct link — the brand gates
    // only half-openable links.
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: stub direct link.
      surfaceClient(surface, direct as any, { live: () => true }),
    ).not.toThrow();
  });
});
