// @vitest-environment happy-dom
/**
 * `createLiveSignal` — the single, UNFORGEABLE minter of a watchdog-backed
 * `LiveSignalHandle`. It lives in `@kolu/surface` (beside the module-private brand
 * set), so there is no importable stamper and a branded handle can only come from
 * here. Three things must hold, end-to-end:
 *
 *   1. Its input is REFUSED unless the dispatch carries the wire-link brand — so a
 *      hand-assembled `{ dispatch, wire }` that pairs the two halves of DIFFERENT
 *      transports ("watch ws1, dispatch over ws2") cannot be handed in at all.
 *   2. Its output is BRANDED — `surfaceClient`/`surfaceClients` accept it over a
 *      half-openable wire (where a bare `() => true` throws).
 *   3. The watchdog it wires is REAL and MANDATORY — there is no `heartbeat:false`
 *      to mint a blind brand, and a probe TIMEOUT drives the full chain
 *      `onStale → status "reconnecting" → wire.forceReconnect()`, so `live()` flips
 *      false on a silently half-open wire WITHOUT any manual close. A `LiveSignal`
 *      existing is therefore PROOF a watchdog backs it, not a marker the guard trusts.
 *
 * Post-Effect-port shape: `createLiveSignal(transport, opts)` takes the ONE
 * `WireTransport` (`{ dispatch, wire }`) a wire link factory minted, probes the
 * reserved `surface/system/live` member as a UNARY call over that dispatch, and
 * recovers via `wire.forceReconnect()`. The old `retireOnStaleClose` /
 * `restartCloseCode` options are gone: terminal-close classification now arrives
 * from the link as the `"retired"` `WireStatus`, pinned below.
 */

import { Effect, Schema, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineSurface, SURFACE_TAG_PREFIX, surfaceTag } from "../define";
import {
  brandHalfOpenDispatch,
  type SurfaceDispatch,
  type WatchableWire,
  type WireStatus,
  type WireTransport,
} from "../link";
import { LIVENESS_NAMESPACE, LIVENESS_VERB } from "../liveness";
import { createLiveSignal, isLiveSignalHandle } from "./liveSignal";
import { surfaceClient } from "./surfaceClient";

const surface = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ s: Schema.String }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

/** The reserved liveness member's tag, minted through the SAME algebra
 *  `defineSurface` and `createLiveSignal` mint it with — so the probe assertion
 *  below pins the real wire tag rather than a hand-copied string. */
const LIVE_TAG = surfaceTag(
  SURFACE_TAG_PREFIX,
  LIVENESS_NAMESPACE,
  LIVENESS_VERB,
);

/** A reconnecting wire faked at exactly the seam `createLiveSignal` touches — the
 *  transport-neutral {@link WatchableWire}: the status it derives `live` from, the
 *  `onStatus` subscription it must detach on dispose, and the `forceReconnect()`
 *  that is the watchdog's recovery action (which, like a real link abandoning a
 *  half-open socket, drops the wire to `closed`). */
function fakeWire() {
  let status: WireStatus = "connecting";
  let forceReconnects = 0;
  const watchers = new Set<(s: WireStatus) => void>();
  const set = (next: WireStatus) => {
    if (next === status) return;
    status = next;
    for (const w of [...watchers]) w(next);
  };
  const wire: WatchableWire = {
    status: () => status,
    onStatus: (cb) => {
      watchers.add(cb);
      return () => {
        watchers.delete(cb);
      };
    },
    forceReconnect: () => {
      forceReconnects += 1;
      set("closed");
    },
  };
  return {
    wire,
    open: () => set("open"),
    close: () => set("closed"),
    retire: () => set("retired"),
    /** How many `onStatus` subscriptions are still attached. */
    listenerCount: () => watchers.size,
    forceReconnects: () => forceReconnects,
  };
}

/** The SILENTLY half-open case: a branded wire dispatch whose `unary` for the
 *  reserved liveness member returns an Effect that NEVER settles — the wire is
 *  "open" at the OS level with no bytes flowing, so it fires neither close nor
 *  error and only a watchdog can tell. Every dispatched tag is recorded, so the
 *  probe assertion can prove the watchdog probed the reserved member over THIS
 *  dispatch (a probe that resolved off an in-memory literal, never touching the
 *  transport, is exactly the forgery the brand exists to prevent). */
function silentTransport() {
  const f = fakeWire();
  const probes: string[] = [];
  const dispatch = brandHalfOpenDispatch<SurfaceDispatch>({
    unary: (tag) => {
      probes.push(tag);
      return Effect.callback<never>(() => {});
    },
    stream: () => Stream.never,
  });
  const transport: WireTransport = { dispatch, wire: f.wire };
  return { ...f, dispatch, transport, probes };
}

describe("createLiveSignal — the unforgeable, watchdog-backed live signal", () => {
  afterEach(() => vi.useRealTimers());

  it("REFUSES a transport no wire link factory minted (an unbranded dispatch)", () => {
    // The forgery this guard exists to make unspellable: a hand-assembled
    // `{ dispatch, wire }` pairing the two halves of DIFFERENT transports, so the
    // watchdog would probe one wire and reconnect another.
    const f = fakeWire();
    const unbranded: SurfaceDispatch = {
      unary: () => Effect.succeed({}),
      stream: () => Stream.never,
    };
    expect(() =>
      createLiveSignal({ dispatch: unbranded, wire: f.wire }, {}),
    ).toThrow(/half-open brand/);
  });

  it("mints a BRANDED LiveSignalHandle a surfaceClient accepts WHOLE", () => {
    const f = silentTransport();
    const handle = createLiveSignal(f.transport, {});
    expect(isLiveSignalHandle(handle)).toBe(true);
    // The handle bundles the watchdog-backed `live` with the dispatch the watchdog
    // probes as ONE object, so `surfaceClient` accepts the WHOLE handle. There is no
    // caller-supplied probe target to fabricate.
    expect(() => surfaceClient(surface, handle)).not.toThrow();
    handle.dispose();
  });

  it("a probe TIMEOUT over the OWNED dispatch drives the full half-open chain — the watchdog probes the transport it reconnects (no manual close)", async () => {
    vi.useFakeTimers();
    const f = silentTransport();
    // No caller-supplied probe: createLiveSignal dispatches the reserved
    // `surface/system/live` member over the transport's own dispatch. That dispatch
    // never answers — the silently half-open case, where the wire fires neither
    // close nor error.
    const handle = createLiveSignal(f.transport, {
      intervalMs: 1000,
      timeoutMs: 500,
    });
    f.open();
    expect(handle.live()).toBe(true);
    expect(handle.status()).toBe("live");
    // Advance past one interval (the watchdog probes the owned dispatch) plus the
    // timeout (no answer → half-open → `status` forced `reconnecting` +
    // `wire.forceReconnect()`). NOTHING is fired by hand. A brand whose probe ran
    // off an in-memory literal could never flip here, because it never touches the
    // transport.
    await vi.advanceTimersByTimeAsync(1600);
    expect(f.probes).toEqual([LIVE_TAG]);
    expect(f.forceReconnects()).toBe(1);
    expect(handle.live()).toBe(false);
    expect(handle.status()).toBe("reconnecting");
    handle.dispose();
  });

  it("a RETIRED wire is terminal — status `down`, live false (the close-code classification the link now owns)", () => {
    // `retireOnStaleClose` / `restartCloseCode` are gone from this module: the link's
    // own close classifier raises the terminal `"retired"` status instead. The fact
    // those options existed for must still hold here.
    const f = silentTransport();
    const handle = createLiveSignal(f.transport, {});
    f.open();
    expect(handle.status()).toBe("live");
    f.retire();
    expect(handle.status()).toBe("down");
    expect(handle.live()).toBe(false);
    handle.dispose();
  });

  it("the brand is un-reflectable — a real LiveSignalHandle exposes no brand symbol to copy (round-8 WeakSet)", () => {
    const f = silentTransport();
    const handle = createLiveSignal(f.transport, {});
    // The round-7 symbol brand could be lifted off a genuine instance via
    // `Object.getOwnPropertySymbols` and copied onto a look-alike. With the WeakSet
    // brand on the HANDLE there is NO own symbol to find, and a hand-rolled
    // `{ live, status, dispatch, dispose }` look-alike is not a member — not even
    // one carrying the genuine, branded dispatch.
    expect(Object.getOwnPropertySymbols(handle)).toHaveLength(0);
    const forged = {
      live: () => true,
      status: () => "live" as const,
      dispatch: f.dispatch,
      dispose: () => {},
    };
    expect(isLiveSignalHandle(forged)).toBe(false);
    handle.dispose();
  });

  it("dispose() detaches every listener it attached — the wire's onStatus AND the window/document wake events (no leak across a remount)", () => {
    const f = silentTransport();
    const winAdd = vi.spyOn(window, "addEventListener");
    const docAdd = vi.spyOn(document, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const handle = createLiveSignal(f.transport, {});
    // On mount: the browser wake events (window focus / tab visible / page resume)
    // AND the wire's own status subscription are wired.
    const focusHandler = winAdd.mock.calls.find(([t]) => t === "focus")?.[1];
    const visHandler = docAdd.mock.calls.find(
      ([t]) => t === "visibilitychange",
    )?.[1];
    const resumeHandler = docAdd.mock.calls.find(([t]) => t === "resume")?.[1];
    expect(focusHandler).toBeTypeOf("function");
    expect(visHandler).toBeTypeOf("function");
    expect(resumeHandler).toBeTypeOf("function");
    expect(f.listenerCount()).toBe(1);
    handle.dispose();
    // After dispose: the EXACT same wake handlers are detached — not "a" listener,
    // the ones we added — so a remount leaks nothing. Removing the wrong/no handler
    // fails these.
    expect(winRemove).toHaveBeenCalledWith("focus", focusHandler);
    expect(docRemove).toHaveBeenCalledWith("visibilitychange", visHandler);
    expect(docRemove).toHaveBeenCalledWith("resume", resumeHandler);
    // ...and the `onStatus` unsubscriber RAN, so the wire holds no reference back
    // into a disposed handle's status signal.
    expect(f.listenerCount()).toBe(0);
    winAdd.mockRestore();
    docAdd.mockRestore();
    winRemove.mockRestore();
    docRemove.mockRestore();
  });
});
