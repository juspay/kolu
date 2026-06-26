/**
 * `createLiveSignal` — the single minter of a watchdog-backed `LiveSignal`.
 *
 * Two things must hold, end-to-end:
 *
 *   1. Its output is BRANDED — `surfaceClient`/`surfaceClients` accept it over a
 *      half-openable `websocketLink` (where a bare `() => true` throws). This is
 *      what makes the brand the ONE way to satisfy the guard.
 *   2. The watchdog it wires is REAL — a probe TIMEOUT drives the full chain
 *      `onStale → ws.reconnect() → close → status off "live"`, so `live()` flips
 *      false on a silently half-open socket WITHOUT any manual close. The prior
 *      tests only ever drove the tail of that chain (a hand-fired `close`); this
 *      pins the head (a missed probe) through to the end.
 */

import { defineSurface } from "@kolu/surface/define";
import { websocketLink } from "@kolu/surface/links/websocket";
import { isLiveSignal } from "@kolu/surface/solid";
import { surfaceClient } from "@kolu/surface/solid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLiveSignal } from "./createLiveSignal";

const surface = defineSurface({
  cells: {
    conn: {
      schema: z.object({ s: z.string() }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

/** A reconnecting socket faked at the seams `createLiveSignal` touches: the
 *  open/close events `createSocketStatus` reads, the `readyState`/`OPEN` the
 *  watchdog's live-gate checks, and a `reconnect()` that — like a real partysocket
 *  abandoning a half-open socket — closes it (firing `close`, which is how the
 *  watchdog's recovery becomes visible to `createSocketStatus`). */
function fakeSocket() {
  const listeners: Record<string, Array<(e?: { code?: number }) => void>> = {};
  let readyState = 0; // CONNECTING
  const fire = (type: string, code?: number) => {
    for (const l of (listeners[type] ?? []).slice())
      l(code === undefined ? undefined : { code });
  };
  return {
    socket: {
      addEventListener: (t: string, fn: (e?: { code?: number }) => void) => {
        (listeners[t] ??= []).push(fn);
      },
      removeEventListener: (t: string, fn: (e?: { code?: number }) => void) => {
        listeners[t] = (listeners[t] ?? []).filter((l) => l !== fn);
      },
      send: () => {},
      close: () => {},
      get readyState() {
        return readyState;
      },
      OPEN: 1,
      // The watchdog's on-stale ACTION. A real partysocket reconnect closes the
      // half-open socket (code 1000, a transient drop — NOT the stale-tab code) and
      // opens fresh; the watchdog cares about the close, which flips status off live.
      reconnect: () => {
        readyState = 0;
        fire("close", 1000);
      },
    },
    open: () => {
      readyState = 1;
      fire("open");
    },
  };
}

describe("createLiveSignal — the branded, watchdog-backed live signal", () => {
  afterEach(() => vi.useRealTimers());

  it("mints a BRANDED LiveSignal a surfaceClient accepts over a websocketLink", () => {
    const f = fakeSocket();
    const transport = createLiveSignal(f.socket as never, {
      probe: () => Promise.resolve({}),
      heartbeat: false, // no timer; we're only checking the brand round-trips
    });
    expect(isLiveSignal(transport.live)).toBe(true);
    // The real guard: a websocketLink is half-open-marked, so surfaceClient demands
    // the brand. createLiveSignal's output satisfies it end-to-end (no stub brand).
    const link = websocketLink<typeof surface.contract>(f.socket as never);
    expect(() =>
      surfaceClient(surface, link, { live: transport.live }),
    ).not.toThrow();
    transport.dispose();
  });

  it("a probe TIMEOUT drives the FULL half-open chain: onStale → ws.reconnect() → close → live flips false (no manual close)", async () => {
    vi.useFakeTimers();
    const f = fakeSocket();
    const transport = createLiveSignal(f.socket as never, {
      // A probe that never answers = a silently half-open socket (the round-trip
      // never completes), the exact case partysocket fires neither close nor error.
      probe: () => new Promise<never>(() => {}),
      heartbeat: { intervalMs: 1000, timeoutMs: 500 },
    });
    f.open();
    expect(transport.live()).toBe(true);
    // Advance past one interval (the watchdog probes) plus the timeout (it declares
    // the socket half-open and runs `ws.reconnect()`, which closes it). NOTHING is
    // fired by hand — the close comes from the watchdog's own recovery action.
    await vi.advanceTimersByTimeAsync(1600);
    expect(transport.live()).toBe(false);
    transport.dispose();
  });

  it("heartbeat:false mints the brand but wires NO watchdog (an external layer owns liveness)", async () => {
    vi.useFakeTimers();
    const f = fakeSocket();
    const reconnect = vi.spyOn(f.socket, "reconnect");
    const transport = createLiveSignal(f.socket as never, {
      probe: () => new Promise<never>(() => {}),
      heartbeat: false,
    });
    f.open();
    expect(transport.live()).toBe(true);
    // With the watchdog off, a never-answering probe forces no reconnect — the
    // signal is still branded (an external watchdog, e.g. a provider's
    // createServerLifecycle over the same ws, is responsible for liveness here).
    await vi.advanceTimersByTimeAsync(5000);
    expect(reconnect).not.toHaveBeenCalled();
    expect(transport.live()).toBe(true);
    expect(isLiveSignal(transport.live)).toBe(true);
    transport.dispose();
  });
});
