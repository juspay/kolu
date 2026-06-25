/**
 * R1 — the liveness leg of the health FACT is REAL, not a constant `true`.
 *
 * `connectSurface` threads the socket's reactive transport `status` into
 * `surfaceClient`'s `live` option (`{ live: () => status() === "live" }`), so a
 * `down`/`reconnecting` transport flips `health().live` to `false` and a gate
 * reads `connecting` rather than a confident `ready` over a dead socket. The
 * pre-fix code dropped `live` to its default constant `true` — the exact
 * green-dot-over-a-dead-link lie, one level up, in the very primitive built to
 * end it.
 *
 * This drives the SAME `createSocketStatus` accessor `connectSurface` builds
 * (over the fake open/close socket `socketStatus.test.ts` uses), threaded into a
 * real `surfaceClient` by the SAME predicate, and asserts `health().live` tracks
 * the transport — NOT a hand-toggled boolean. A live partysocket flakes in a
 * Node unit test (see `connect.test.ts`), so the socket is faked at its two
 * observable events; everything else — the status derivation and the live fold —
 * is the real production code.
 */

import { defineSurface } from "@kolu/surface/define";
import { surfaceClient } from "@kolu/surface/solid";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { STALE_PROCESS_CLOSE_CODE } from "../index";
import { connectSurface } from "./connectSurface";
import { createSocketStatus } from "./socketStatus";

// `connectSurface` builds its OWN socket via `createSurfaceSocket`. To exercise
// its real threading (not a hand-rebuilt predicate), mock ONLY that seam to hand
// back a fake socket the test drives; everything else — `createSocketStatus`, the
// `{ live: () => status() === "live" }` thread at connectSurface.ts:101, the
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

/** A wire stream that yields once — enough to build a real `.use()` subscription
 *  whose health is folded; `live` is independent of it, but a realistic client
 *  has at least one sub. */
function once<T>(value: T) {
  return (..._args: unknown[]): Promise<AsyncIterable<T>> =>
    Promise.resolve(
      (async function* () {
        yield value;
      })(),
    );
}

/** A socket reduced to listeners fired by hand. Tolerant of ARBITRARY event
 *  types (and a no-op `send`/`close`/`readyState`) so it survives `RPCLink`
 *  construction inside `connectSurface`'s real `websocketLink(ws)` — not just the
 *  `open`/`close` `createSocketStatus` reads. No RPC is ever sent (no `.use()`),
 *  so the no-op transport never has to actually carry a frame. */
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
      readyState: 0,
      OPEN: 1,
    },
    fire: (type: string, code?: number) => {
      const event = code === undefined ? undefined : { code };
      for (const l of (listeners[type] ?? []).slice()) l(event);
    },
  };
}

const link = { surface: { conn: { get: once({ s: "ok" }) } } };

describe("transport live → health().live (connectSurface's threading)", () => {
  it("a socket that opens then transiently drops flips health().live true → false → true", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      const status = createSocketStatus(t.ws);
      const app = surfaceClient(
        surface,
        // biome-ignore lint/suspicious/noExplicitAny: stub link stands in for the typed ContractRouterClient.
        link as any,
        // The EXACT predicate `connectSurface` threads.
        { live: () => status() === "live" },
      );
      app.cells.conn.use();
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
      dispose();
    });
  });

  it("a retired stale-close (terminally `down`) reads not-live", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      const status = createSocketStatus(t.ws, {
        retireOnStaleClose: true,
        restartCloseCode: STALE_PROCESS_CLOSE_CODE,
      });
      const app = surfaceClient(
        surface,
        // biome-ignore lint/suspicious/noExplicitAny: stub link.
        link as any,
        { live: () => status() === "live" },
      );
      app.cells.conn.use();
      t.fire("open");
      expect(app.health().live).toBe(true);
      t.fire("close", STALE_PROCESS_CLOSE_CODE);
      expect(app.health().live).toBe(false);
      dispose();
    });
  });
});

describe("connectSurface threads the real socket liveness into health().live", () => {
  it("the client connectSurface BUILDS reads live off the socket — reverting the thread to a constant `true` breaks this", () => {
    const t = fakeWs();
    mocked.ws = t.ws;
    createRoot((dispose) => {
      // The REAL connectSurface: it builds `createSocketStatus(ws)` and threads
      // `{ live: () => status() === "live" }` into its OWN `surfaceClient` at
      // connectSurface.ts:101. We assert THAT client's `health().live`, so the
      // assertion exercises the actual thread — drop it back to the default
      // constant `true` and these expectations fail (the regression the first
      // re-review flagged: the old test rebuilt the predicate by hand and never
      // called connectSurface). `heartbeat: false` keeps the watchdog (which would
      // probe `system.live` over the fake socket) out of the way.
      const conn = connectSurface({
        surface,
        url: "ws://test",
        heartbeat: false,
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
