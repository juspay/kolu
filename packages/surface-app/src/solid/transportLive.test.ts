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
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { STALE_PROCESS_CLOSE_CODE } from "../index";
import { createSocketStatus } from "./socketStatus";

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

/** A socket reduced to the open/close listeners `createSocketStatus` reads, fired
 *  by hand — the same harness `socketStatus.test.ts` uses. */
function fakeWs() {
  const listeners: Record<
    "open" | "close",
    Array<(event?: { code?: number }) => void>
  > = { open: [], close: [] };
  return {
    ws: {
      addEventListener: (
        type: "open" | "close",
        fn: (event?: { code?: number }) => void,
      ) => listeners[type].push(fn),
    },
    fire: (type: "open" | "close", code?: number) => {
      const event = code === undefined ? undefined : { code };
      for (const l of listeners[type].slice()) l(event);
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
