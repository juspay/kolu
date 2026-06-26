/**
 * `createLiveSignal` — the single, UNFORGEABLE minter of a watchdog-backed
 * `LiveSignal`. It lives in `@kolu/surface` (beside the module-private brand
 * symbol), so `brandLiveSignal` is un-importable and a brand can only come from
 * here. Two things must hold, end-to-end:
 *
 *   1. Its output is BRANDED — `surfaceClient`/`surfaceClients` accept it over a
 *      half-openable `websocketLink` (where a bare `() => true` throws).
 *   2. The watchdog it wires is REAL and MANDATORY — there is no `heartbeat:false`
 *      to mint a blind brand, and a probe TIMEOUT drives the full chain
 *      `onStale → ws.reconnect() → close → status off "live"`, so `live()` flips
 *      false on a silently half-open socket WITHOUT any manual close. A `LiveSignal`
 *      existing is therefore PROOF a watchdog backs it, not a marker the guard trusts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineSurface } from "../define";
import { websocketLink } from "../links/websocket";
import { createLiveSignal, isLiveSignal } from "./liveSignal";
import { surfaceClient } from "./surfaceClient";

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
 *  open/close events the status derivation reads, the `readyState`/`OPEN` the
 *  watchdog's live-gate checks, and a `reconnect()` that — like a real partysocket
 *  abandoning a half-open socket — closes it (firing `close`, which is how the
 *  watchdog's recovery becomes visible to the status). */
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

/** A probe TARGET thunk. `createLiveSignal` hardcodes `probeSurfaceLive` over the
 *  link it returns (no caller-supplied `probe`), so the test drives liveness via
 *  this fake link's `system.live` behaviour. */
function liveLink(systemLive: () => Promise<unknown>): () => unknown {
  return () => ({ surface: { system: { live: systemLive } } });
}

describe("createLiveSignal — the unforgeable, watchdog-backed live signal", () => {
  afterEach(() => vi.useRealTimers());

  it("mints a BRANDED LiveSignal a surfaceClient accepts over a websocketLink", () => {
    const f = fakeSocket();
    const transport = createLiveSignal(f.socket as never, {
      link: liveLink(() => Promise.resolve({})),
    });
    expect(isLiveSignal(transport.live)).toBe(true);
    // The real guard: a websocketLink is half-open-marked, so surfaceClient demands
    // the brand. createLiveSignal's output satisfies it end-to-end (no stub brand —
    // `brandLiveSignal` is module-private and cannot be imported to forge one).
    const link = websocketLink<typeof surface.contract>(f.socket as never);
    expect(() =>
      surfaceClient(surface, link, { live: transport.live }),
    ).not.toThrow();
    transport.dispose();
  });

  it("a probe TIMEOUT drives the FULL half-open chain — proving the brand implies a real watchdog (no manual close)", async () => {
    vi.useFakeTimers();
    const f = fakeSocket();
    const transport = createLiveSignal(f.socket as never, {
      // `system.live` never answers = a silently half-open socket (the round-trip
      // never completes), the exact case partysocket fires neither close nor error.
      link: liveLink(() => new Promise<never>(() => {})),
      intervalMs: 1000,
      timeoutMs: 500,
    });
    f.open();
    expect(transport.live()).toBe(true);
    // Advance past one interval (the watchdog probes) plus the timeout (it declares
    // the socket half-open and runs `ws.reconnect()`, which closes it). NOTHING is
    // fired by hand — the close comes from the watchdog's own recovery action. A
    // `LiveSignal` that did NOT have a watchdog could never flip here.
    await vi.advanceTimersByTimeAsync(1600);
    expect(transport.live()).toBe(false);
    transport.dispose();
  });

  it("the brand is un-reflectable — a real LiveSignal exposes no brand symbol to copy (round-8 WeakSet)", () => {
    const f = fakeSocket();
    const transport = createLiveSignal(f.socket as never, {
      link: liveLink(() => Promise.resolve({})),
    });
    // The round-7 symbol brand could be lifted off a genuine instance via
    // `Object.getOwnPropertySymbols` and copied onto a blind accessor. With the
    // WeakSet brand there is NO own symbol to find, and a forged copy is not a member.
    expect(Object.getOwnPropertySymbols(transport.live)).toHaveLength(0);
    const forged = Object.assign(() => true, {});
    expect(isLiveSignal(forged)).toBe(false);
    transport.dispose();
  });
});
