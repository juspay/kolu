// @vitest-environment happy-dom
/**
 * `createLiveSignal` — the single, UNFORGEABLE minter of a watchdog-backed
 * `LiveSignalHandle`. It lives in `@kolu/surface` (beside the module-private brand
 * set), so there is no importable stamper and a branded handle can only come from
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
import { createLiveSignal, isLiveSignalHandle } from "./liveSignal";
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
    listenerCount: (type: string) => (listeners[type] ?? []).length,
  };
}

describe("createLiveSignal — the unforgeable, watchdog-backed live signal", () => {
  afterEach(() => vi.useRealTimers());

  it("mints a BRANDED LiveSignalHandle a surfaceClient accepts WHOLE", () => {
    const f = fakeSocket();
    const transport = createLiveSignal<typeof surface.contract>(
      f.socket as never,
      {},
    );
    expect(isLiveSignalHandle(transport)).toBe(true);
    // `createLiveSignal` built the oRPC link over `f.socket` itself and bundled it
    // with the branded `live` on ONE handle, so `surfaceClient` accepts the WHOLE
    // handle. There is no caller-supplied link/probe to fabricate.
    expect(() => surfaceClient(surface, transport)).not.toThrow();
    transport.dispose();
  });

  it("a probe TIMEOUT over the OWNED socket drives the full half-open chain — the watchdog probes the socket it reconnects (no manual close)", async () => {
    vi.useFakeTimers();
    const f = fakeSocket();
    // No caller `link`: createLiveSignal builds the oRPC link over `f.socket` and
    // probes `system.live` over THAT link. `f.socket` never answers (its `send` is a
    // no-op) — the silently half-open case partysocket fires neither close nor error.
    const transport = createLiveSignal(f.socket as never, {
      intervalMs: 1000,
      timeoutMs: 500,
    });
    f.open();
    expect(transport.live()).toBe(true);
    // Advance past one interval (the watchdog probes the owned socket) plus the
    // timeout (no answer → half-open → `status` forced `reconnecting` + `reconnect()`).
    // NOTHING is fired by hand. A brand whose probe ran off an in-memory literal —
    // round-8's `link: () => ({ surface: { system: { live: () => resolve() } } })` —
    // could never flip here, because it never touches the socket.
    await vi.advanceTimersByTimeAsync(1600);
    expect(transport.live()).toBe(false);
    transport.dispose();
  });

  it("the brand is un-reflectable — a real LiveSignalHandle exposes no brand symbol to copy (round-8 WeakSet)", () => {
    const f = fakeSocket();
    const transport = createLiveSignal(f.socket as never, {});
    // The round-7 symbol brand could be lifted off a genuine instance via
    // `Object.getOwnPropertySymbols` and copied onto a look-alike. With the WeakSet
    // brand on the HANDLE there is NO own symbol to find, and a hand-rolled
    // `{ live, link, … }` look-alike is not a member.
    expect(Object.getOwnPropertySymbols(transport)).toHaveLength(0);
    const forged = {
      live: () => true,
      status: () => "live" as const,
      link: {},
      dispose: () => {},
    };
    expect(isLiveSignalHandle(forged)).toBe(false);
    transport.dispose();
  });

  it("dispose() detaches every listener it attached — the socket's open/close AND the window/document wake events (no leak across a remount)", () => {
    const f = fakeSocket();
    const winAdd = vi.spyOn(window, "addEventListener");
    const docAdd = vi.spyOn(document, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const transport = createLiveSignal(f.socket as never, {});
    // On mount: the browser wake events (window focus / tab visible) AND the
    // socket's own open/close are wired. (The owned `websocketLink` attaches its
    // OWN open/close too, so we track our pair by the count DELTA, not the total.)
    const focusHandler = winAdd.mock.calls.find(([t]) => t === "focus")?.[1];
    const visHandler = docAdd.mock.calls.find(
      ([t]) => t === "visibilitychange",
    )?.[1];
    expect(focusHandler).toBeTypeOf("function");
    expect(visHandler).toBeTypeOf("function");
    const openAfterMount = f.listenerCount("open");
    const closeAfterMount = f.listenerCount("close");
    transport.dispose();
    // After dispose: the EXACT same wake handlers are detached — not "a" listener,
    // the ones we added — so a remount leaks nothing. Removing the wrong/no handler
    // fails these.
    expect(winRemove).toHaveBeenCalledWith("focus", focusHandler);
    expect(docRemove).toHaveBeenCalledWith("visibilitychange", visHandler);
    // ...and our one open + one close socket listener are gone (the link's remain).
    expect(f.listenerCount("open")).toBe(openAfterMount - 1);
    expect(f.listenerCount("close")).toBe(closeAfterMount - 1);
    winAdd.mockRestore();
    docAdd.mockRestore();
    winRemove.mockRestore();
    docRemove.mockRestore();
  });
});
