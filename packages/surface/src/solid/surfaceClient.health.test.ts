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
import type { SurfaceHealth } from "./health";
import {
  surfaceClient,
  surfaceClients,
  surfaceClientsHealth,
} from "./surfaceClient";

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
