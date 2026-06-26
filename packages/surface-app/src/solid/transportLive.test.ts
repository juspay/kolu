/**
 * R1 — the liveness leg of the health FACT is REAL, not a constant `true`.
 *
 * `connectSurface` builds a `createLiveSignal` handle over its socket and hands the
 * WHOLE handle (its watchdog-backed `live` + link) to `surfaceClient`, so a
 * `down`/`reconnecting` transport flips `health().live` to `false` and a gate
 * reads `connecting` rather than a confident `ready` over a dead socket. The
 * pre-fix code dropped `live` to its default constant `true` — the exact
 * green-dot-over-a-dead-link lie, one level up, in the very primitive built to
 * end it.
 *
 * This drives the SAME `createLiveSignal` handle `connectSurface` builds (over a
 * fake open/close socket), folded into a real `surfaceClient`, and asserts
 * `health().live` tracks the transport — NOT a hand-toggled boolean. A live
 * partysocket flakes in a Node unit test (see `connect.test.ts`), so the socket is
 * faked at its two observable events; everything else — the status derivation and
 * the live fold — is the real production code.
 */

import { defineSurface } from "@kolu/surface/define";
import { websocketLink } from "@kolu/surface/links/websocket";
import {
  surfaceClient,
  surfaceClients,
  surfaceClientsHealth,
} from "@kolu/surface/solid";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { STALE_PROCESS_CLOSE_CODE } from "../index";
import { createLiveSignal } from "@kolu/surface/solid";
import { connectSurface } from "./connectSurface";

// `connectSurface` builds its OWN socket via `createSurfaceSocket`. To exercise
// its real threading (not a hand-rebuilt predicate), mock ONLY that seam to hand
// back a fake socket the test drives; everything else — the `createLiveSignal`
// handle `connectSurface` builds, the whole-handle hand-off to `surfaceClient`, the
// `surfaceClient` fold — is the real production path. A `vi.hoisted` holder lets
// each test swap in its fake before calling `connectSurface`.
const mocked = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: the fake socket stands in for a PartySocket.
  ws: undefined as any,
}));
vi.mock("../connect", async (importActual) => {
  const actual = await importActual<typeof import("../connect")>();
  return {
    ...actual,
    createSurfaceSocket: () => ({
      ws: mocked.ws,
      echo: { remember: () => {}, appendTo: (u: string) => u },
    }),
  };
});

const surface = defineSurface({
  cells: {
    conn: {
      schema: z.object({ s: z.string() }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

/** A socket reduced to listeners fired by hand. Tolerant of ARBITRARY event
 *  types (and a no-op `send`/`close`/`readyState`) so it survives `RPCLink`
 *  construction inside the real `websocketLink(ws)` `createLiveSignal`/`connectSurface`
 *  build — not just the `open`/`close` the status derivation reads. No RPC is ever
 *  sent, so the no-op transport never has to actually carry a frame. */
function fakeWs() {
  const listeners: Record<
    string,
    Array<(event?: { code?: number }) => void>
  > = {};
  return {
    ws: {
      addEventListener: (
        type: string,
        fn: (event?: { code?: number }) => void,
      ) => {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener: (
        type: string,
        fn: (event?: { code?: number }) => void,
      ) => {
        listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn);
      },
      send: () => {},
      close: () => {},
      reconnect: () => {},
      readyState: 0,
      OPEN: 1,
    },
    fire: (type: string, code?: number) => {
      const event = code === undefined ? undefined : { code };
      for (const l of (listeners[type] ?? []).slice()) l(event);
    },
  };
}

describe("transport live → health().live (createLiveSignal's branded handle)", () => {
  it("a socket that opens then transiently drops flips health().live true → false → true", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      // `createLiveSignal` derives the same status `connectSurface` reads and bundles
      // the watchdog-backed `live` with the link on ONE handle; `surfaceClient` reads
      // both off it. (`.live` is independent of any sub, so no `.use()` is needed.)
      const transport = createLiveSignal(t.ws as never, {});
      const app = surfaceClient(surface, transport);
      // Before the first open the transport is `connecting` → NOT live. The
      // pre-fix default would have read `true` here.
      expect(app.health().live).toBe(false);
      t.fire("open");
      expect(app.health().live).toBe(true);
      // A transient drop → `reconnecting` → not live: the half-open-over-ready
      // lie is closed — the gate reads `connecting`, not `ready`.
      t.fire("close", 1006);
      expect(app.health().live).toBe(false);
      // Recovers transparently on reconnect.
      t.fire("open");
      expect(app.health().live).toBe(true);
      transport.dispose();
      dispose();
    });
  });

  it("a retired stale-close (terminally `down`) reads not-live", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      const transport = createLiveSignal(t.ws as never, {
        retireOnStaleClose: true,
        restartCloseCode: STALE_PROCESS_CLOSE_CODE,
      });
      const app = surfaceClient(surface, transport);
      t.fire("open");
      expect(app.health().live).toBe(true);
      t.fire("close", STALE_PROCESS_CLOSE_CODE);
      expect(app.health().live).toBe(false);
      transport.dispose();
      dispose();
    });
  });
});

describe("connectSurface threads the real socket liveness into health().live", () => {
  it("the client connectSurface BUILDS reads live off the socket — reverting the thread to a constant `true` breaks this", () => {
    const t = fakeWs();
    mocked.ws = t.ws;
    createRoot((dispose) => {
      // The REAL connectSurface: it builds `createLiveSignal(ws)` and hands the WHOLE
      // handle (its watchdog-backed `live` + link) to its OWN `surfaceClient`. We
      // assert THAT client's `health().live`, so the assertion exercises the actual
      // thread — drop it back to the default constant `true` and these expectations
      // fail (the regression the first re-review flagged: the old test rebuilt the
      // predicate by hand and never called connectSurface). The watchdog is always-on
      // now (no disable knob),
      // but its 15s probe never fires within this synchronous test, and
      // `conn.dispose()` clears the interval — so the live FOLD is exercised cleanly.
      const conn = connectSurface({
        surface,
        url: "ws://test",
      });
      // Before the first open: `connecting` → not live (NOT the default `true`).
      expect(conn.client.health().live).toBe(false);
      t.fire("open");
      expect(conn.client.health().live).toBe(true);
      // A transient drop flips the FACT connectSurface's own client exposes.
      t.fire("close", 1006);
      expect(conn.client.health().live).toBe(false);
      t.fire("open");
      expect(conn.client.health().live).toBe(true);
      conn.dispose();
      dispose();
    });
  });
});

describe("kolu's wire pattern: a multi-surface bundle over a websocket link MUST pass the BRANDED handle", () => {
  // kolu's main app (packages/client/src/wire.ts) builds `surfaceClients(transport,
  // surfaces)` over ONE `websocketLink`, exactly like `connectSurfaces` does —
  // minting the handle with `createLiveSignal` (which wires the half-open watchdog
  // AND bundles the branded live with the link). It used to omit `{ live }`, leaving
  // the transport leg a silent constant `true`; then it threaded a BARE
  // `() => status() === "live"`, half-open-blind. Collapsing link+live into the
  // handle makes BOTH unspellable — a bare websocket link is refused outright — so a
  // half-open kolu socket can't read `health().live === true`. This pins the FIXED
  // pattern: a real `createLiveSignal` handle builds cleanly AND folds the transport
  // into the merged fact; pass the bare link and the build throws.
  it("builds with createLiveSignal's handle and folds the socket's liveness into the merged fact", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      // The wire.ts pattern: `createLiveSignal` BUILDS the combined link over the
      // socket and bundles the branded live with it; the bundle is built over the
      // WHOLE handle. The always-on watchdog's 15s probe never fires within this
      // synchronous test, and `transport.dispose()` clears the interval, so the live
      // FOLD is exercised cleanly (the half-open chain is pinned in `createLiveSignal.test.ts`).
      const transport = createLiveSignal(t.ws as never, { siblingKey: "a" });
      const clients = surfaceClients(transport, { a: surface, b: surface });
      // Before the first open: connecting → not live → merged fact not-live.
      expect(surfaceClientsHealth(clients).live).toBe(false);
      t.fire("open");
      expect(surfaceClientsHealth(clients).live).toBe(true);
      // A drop (the half-open watchdog forces a reconnect → close) → not live.
      t.fire("close", 1006);
      expect(surfaceClientsHealth(clients).live).toBe(false);
      transport.dispose();
      for (const c of Object.values(clients))
        (c as { dispose: () => void }).dispose();
      dispose();
    });
  });

  it("CRASHES if a bare websocket link is passed — the silent constant-true transport is unbuildable over a socket", () => {
    const t = fakeWs();
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: the combined link is walk-by-string.
      surfaceClients(websocketLink(t.ws as never) as any, { a: surface }),
    ).toThrow(/websocket link can silently half-open/);
  });
});
