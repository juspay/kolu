/**
 * R1 — the liveness leg of the health FACT is REAL, not a constant `true`.
 *
 * `connectSurface` builds a `createLiveSignal` handle over the `{ dispatch, wire }`
 * its link minted and hands the WHOLE handle to `surfaceClient`, so a
 * `down`/`reconnecting` transport flips `health().live` to `false` and a gate
 * reads `connecting` rather than a confident `ready` over a dead wire. The
 * pre-fix code dropped `live` to its default constant `true` — the exact
 * green-dot-over-a-dead-link lie, one level up, in the very primitive built to
 * end it.
 *
 * Everything below the socket is the REAL production path: the real
 * `createSurfaceSocket` → real `websocketLink` → real `createLiveSignal` → real
 * `surfaceClient`. Only the WebSocket itself is faked (via the link's own
 * `connect` seam — no module mocking), because a live socket in a Node unit test
 * only adds nondeterminism to an assertion about status derivation.
 */

import { defineSurface } from "@kolu/surface/define";
import { surfaceClient, surfaceClients } from "@kolu/surface/solid";
import { createLiveSignal, surfaceClientsHealth } from "@kolu/surface/solid";
import { Schema } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createSurfaceSocket } from "../connect";
import { FakeWebSocket } from "../fakeSocket.testlib";
import { STALE_PROCESS_CLOSE_CODE } from "../index";
import { connectSurface } from "./connectSurface";

const surface = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ s: Schema.String }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

/** Collect the sockets the link dials, so a test can open/close them by hand. */
function dialRecorder() {
  const dialled: FakeWebSocket[] = [];
  return {
    dialled,
    connect: (url: string) => {
      const ws = new FakeWebSocket(url);
      dialled.push(ws);
      return ws as unknown as WebSocket;
    },
    /** The dial runs in the protocol's own fiber. */
    nth: async (n: number): Promise<FakeWebSocket> => {
      await expect
        .poll(() => dialled.length, { timeout: 3_000 })
        .toBeGreaterThanOrEqual(n);
      const ws = dialled[n - 1];
      if (ws === undefined) throw new Error(`no socket #${n}`);
      return ws;
    },
  };
}

/** `health().live` is derived through a Solid signal the WIRE's status callback
 *  sets, so give the reactive graph a turn after driving the socket. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("transport live → health().live (createLiveSignal's branded handle)", () => {
  it("a wire that opens then transiently drops flips health().live true → false → true", async () => {
    const d = dialRecorder();
    const { link } = await createSurfaceSocket({
      group: surface.group,
      url: "ws://test",
      connect: d.connect,
    });
    await createRoot(async (dispose) => {
      // `createLiveSignal` takes the WHOLE `{ dispatch, wire }` the link minted
      // and bundles the watchdog-backed `live` with it; `surfaceClient` reads both
      // off the handle. (`.live` is independent of any sub, so no `.use()` is
      // needed.)
      const transport = createLiveSignal(link, {});
      const app = surfaceClient(surface, transport);
      // Before the first open the transport is `connecting` → NOT live. The
      // pre-fix default would have read `true` here.
      expect(app.health().live).toBe(false);
      const first = await d.nth(1);
      first.open();
      await settle();
      expect(app.health().live).toBe(true);
      // A transient drop → `reconnecting` → not live: the half-open-over-ready
      // lie is closed — the gate reads `connecting`, not `ready`.
      first.close(1006);
      await settle();
      expect(app.health().live).toBe(false);
      // Recovers transparently on the link's re-dial.
      (await d.nth(2)).open();
      await settle();
      expect(app.health().live).toBe(true);
      transport.dispose();
      app.dispose();
      dispose();
    });
    await link.dispose();
  });

  it("a retired stale-close (terminally `down`) reads not-live", async () => {
    const d = dialRecorder();
    const { link } = await createSurfaceSocket({
      group: surface.group,
      url: "ws://test",
      connect: d.connect,
    });
    await createRoot(async (dispose) => {
      const transport = createLiveSignal(link, {});
      const app = surfaceClient(surface, transport);
      const ws = await d.nth(1);
      ws.open();
      await settle();
      expect(app.health().live).toBe(true);
      // The link's terminal-close classifier (fed surface-app's
      // `isStaleProcessClose`) retires the wire — terminally not-live, and no
      // re-dial can ever revive it.
      ws.close(STALE_PROCESS_CLOSE_CODE);
      await settle();
      expect(app.health().live).toBe(false);
      expect(transport.status()).toBe("down");
      transport.dispose();
      app.dispose();
      dispose();
    });
    await link.dispose();
  });
});

describe("connectSurface threads the real wire liveness into health().live", () => {
  it("the client connectSurface BUILDS reads live off the wire — reverting the thread to a constant `true` breaks this", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      // The REAL connectSurface: it dials, builds `createLiveSignal(link)` and
      // hands the WHOLE handle to its OWN `surfaceClient`. We assert THAT
      // client's `health().live`, so the assertion exercises the actual thread —
      // drop it back to the default constant `true` and these expectations fail.
      // The watchdog is always-on (no disable knob), but its 15s probe never
      // fires within this test, and `conn.dispose()` clears the interval — so the
      // live FOLD is exercised cleanly.
      const conn = await connectSurface({
        surface,
        url: "ws://test",
        connect: d.connect,
      });
      // Before the first open: `connecting` → not live (NOT the default `true`).
      expect(conn.client.health().live).toBe(false);
      const first = await d.nth(1);
      first.open();
      await settle();
      expect(conn.client.health().live).toBe(true);
      // A transient drop flips the FACT connectSurface's own client exposes.
      first.close(1006);
      await settle();
      expect(conn.client.health().live).toBe(false);
      (await d.nth(2)).open();
      await settle();
      expect(conn.client.health().live).toBe(true);
      await conn.dispose();
      dispose();
    });
  });
});

describe("kolu's wire pattern: a multi-surface bundle MUST pass the BRANDED handle", () => {
  // kolu's main app (packages/client/src/wire.ts) builds `surfaceClients(transport,
  // surfaces)` over ONE wire, exactly like `connectSurfaces` does — minting the
  // handle with `createLiveSignal` (which wires the half-open watchdog AND bundles
  // the branded live with the dispatch). It used to omit `{ live }`, leaving the
  // transport leg a silent constant `true`; then it threaded a BARE
  // `() => status() === "live"`, half-open-blind. Collapsing dispatch+live into the
  // handle makes BOTH unspellable — a bare wire dispatch is refused outright — so a
  // half-open kolu wire can't read `health().live === true`. This pins the FIXED
  // pattern: a real `createLiveSignal` handle builds cleanly AND folds the transport
  // into the merged fact; pass the bare dispatch and the build throws.
  it("builds with createLiveSignal's handle and folds the wire's liveness into the merged fact", async () => {
    const d = dialRecorder();
    const { link } = await createSurfaceSocket({
      group: surface.group,
      url: "ws://test",
      connect: d.connect,
    });
    await createRoot(async (dispose) => {
      const transport = createLiveSignal(link, { siblingKey: "a" });
      const clients = surfaceClients(transport, { a: surface, b: surface });
      // Before the first open: connecting → not live → merged fact not-live.
      expect(surfaceClientsHealth(clients).live).toBe(false);
      const ws = await d.nth(1);
      ws.open();
      await settle();
      expect(surfaceClientsHealth(clients).live).toBe(true);
      // A drop (the half-open watchdog forces a reconnect → close) → not live.
      ws.close(1006);
      await settle();
      expect(surfaceClientsHealth(clients).live).toBe(false);
      transport.dispose();
      for (const c of Object.values(clients))
        (c as { dispose: () => void }).dispose();
      dispose();
    });
    await link.dispose();
  });

  it("CRASHES if a bare wire dispatch is passed — the silent constant-true transport is unbuildable over a wire", async () => {
    const d = dialRecorder();
    const { link } = await createSurfaceSocket({
      group: surface.group,
      url: "ws://test",
      connect: d.connect,
    });
    expect(() => surfaceClients(link.dispatch, { a: surface })).toThrow(
      /can silently half-open/,
    );
    await link.dispose();
  });
});
