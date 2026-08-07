/**
 * `@kolu/surface-app/connect` — the client transport assembly: the `pid`-echo
 * (URL-param threading), the stale-close classifier surface-app hands the link,
 * and the wire-shaped heartbeat wrapper. Solid-free, like the kernel suite.
 *
 * The retire tests moved with the mechanism (PLAN D5 / review #5): there is no
 * `retireOnStaleClose` listener and no `retireSocket` send-poisoning any more —
 * the LINK owns the terminal-close classifier. `@kolu/surface`'s
 * `links/websocket.test.ts` pins the link's law (one close, zero re-dials,
 * `SurfaceTransportRetired` on every call); what is pinned HERE is the APP-side
 * contract: `createSurfaceSocket` is what feeds that link surface-app's close-code
 * vocabulary, so a wire it dials retires on 4001 and re-dials on anything else.
 */

import { defineSurface } from "@kolu/surface/define";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHeartbeat,
  createProcessIdEcho,
  createSurfaceSocket,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  isStaleProcessClose,
} from "./connect";
import { FakeWebSocket, fakeWire } from "./fakeSocket.testlib";
import { FRAME_TOO_LARGE_CLOSE_CODE } from "@kolu/surface/frame-limit";
import { STALE_PROCESS_CLOSE_CODE } from "./index";
import { DEFAULT_SERVER_HEARTBEAT_INTERVAL_MS } from "./server";

describe("heartbeat timing — client reconnect wins the race vs the server reaper", () => {
  it("the server's reap window exceeds the client's worst-case recovery", () => {
    // The client detects a half-open socket and reconnects within (one probe
    // interval + one probe timeout); the server terminates a socket that misses
    // ONE ping window. If the server window were <= the client's worst case, the
    // reaper could terminate a socket the client is about to revive — a spurious
    // double-recovery. The server window must comfortably exceed it. This pins
    // the cross-file relationship between two constants in two modules so an edit
    // to either can't silently break the race.
    const clientWorstCase =
      DEFAULT_HEARTBEAT_INTERVAL_MS + DEFAULT_HEARTBEAT_TIMEOUT_MS;
    expect(DEFAULT_SERVER_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(
      clientWorstCase,
    );
  });
});

describe("createProcessIdEcho", () => {
  it("is a no-op until an id is observed (the first-ever connect omits `pid`)", () => {
    const echo = createProcessIdEcho();
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws");
  });

  it("appends `?pid=` to a bare URL once an id is remembered", () => {
    const echo = createProcessIdEcho();
    echo.remember("p1");
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws?pid=p1");
  });

  it("appends `&pid=` when the base URL already carries a query (drishti's ?host=)", () => {
    const echo = createProcessIdEcho();
    echo.remember("p1");
    expect(echo.appendTo("ws://h/rpc/ws?host=zest")).toBe(
      "ws://h/rpc/ws?host=zest&pid=p1",
    );
  });

  it("url-encodes the id", () => {
    const echo = createProcessIdEcho();
    echo.remember("a b/c");
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws?pid=a%20b%2Fc");
  });

  it("re-presents the LATEST observed id (each reconnect re-reads it)", () => {
    const echo = createProcessIdEcho();
    echo.remember("p1");
    echo.remember("p2");
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws?pid=p2");
  });

  it("its `remember` is safe to detach (closure-based, no `this`)", () => {
    const echo = createProcessIdEcho();
    const remember = echo.remember; // kolu re-exports this as `rememberServerProcessId`
    remember("p9");
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws?pid=p9");
  });
});

describe("isStaleProcessClose — surface-app's close-code vocabulary", () => {
  it("classifies the stale-tab close as TERMINAL", () => {
    expect(isStaleProcessClose(STALE_PROCESS_CLOSE_CODE)).toBe(true);
  });

  it("leaves every ordinary close code retriable", () => {
    // 1006 (abnormal), 1000 (normal — the watchdog's own forceReconnect), 1001
    // (going away): all ordinary drops the link must re-dial through.
    for (const code of [1000, 1001, 1006, 1011, 4000, 4002]) {
      expect(isStaleProcessClose(code)).toBe(false);
    }
  });

  it("leaves the frame-cap close (1009) retriable — juspay/kolu#2101 G9c(ii)", () => {
    // Effect's ndjson decoder answers an oversized inbound frame by closing the
    // socket with 1009, which takes every subscription on the tab's multiplexed
    // wire with it. That close is inside Effect and we cannot stop it, so the
    // contract we hold is that it stays RECOVERABLE: classifying 1009 terminal
    // would halt the retry schedule and strand the tab with no subscriptions
    // and no way back short of a reload — turning a bad frame into a dead tab.
    // Reconnect re-subscribes, and the per-subscription retry fence restores
    // what the close dropped.
    expect(isStaleProcessClose(FRAME_TOO_LARGE_CLOSE_CODE)).toBe(false);
  });
});

const surface = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ s: Schema.String }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

/** Dial through `createSurfaceSocket` with a fake WebSocket constructor, so the
 *  test drives the socket the REAL link built (no mocking of surface-app's own
 *  seam — that is the thing under test). */
function dial(opts: { url?: string | (() => string) } = {}) {
  const dialled: FakeWebSocket[] = [];
  const socket = createSurfaceSocket({
    group: surface.group,
    url: opts.url ?? "ws://test/rpc/ws",
    connect: (url) => {
      const ws = new FakeWebSocket(url);
      dialled.push(ws);
      return ws as unknown as WebSocket;
    },
  });
  return { socket, dialled };
}

/** The dial runs in the protocol's own fiber, so wait for the socket rather than
 *  assuming it exists the moment the link resolves. */
async function nthSocket(
  dialled: FakeWebSocket[],
  n: number,
): Promise<FakeWebSocket> {
  await expect
    .poll(() => dialled.length, { timeout: 3_000 })
    .toBeGreaterThanOrEqual(n);
  const ws = dialled[n - 1];
  if (ws === undefined) throw new Error(`no socket #${n}`);
  return ws;
}

describe("createSurfaceSocket — the stale-tab handshake, app side", () => {
  it("echoes the remembered `pid` on EVERY re-dial (the URL is a thunk)", async () => {
    const d = dial();
    const { link, echo } = await d.socket;
    const first = await nthSocket(d.dialled, 1);
    // First-ever connect: nothing observed yet, so no `pid` param at all.
    expect(first.url).toBe("ws://test/rpc/ws");
    first.open();

    // The lifecycle's probe observed the server's id, then the link dropped.
    echo.remember("p1");
    first.close(1006, "abnormal closure");

    const second = await nthSocket(d.dialled, 2);
    expect(second.url).toBe("ws://test/rpc/ws?pid=p1");
    await link.dispose();
  });

  it("retires the wire on the server's stale close — one dial, no re-dial", async () => {
    const d = dial();
    const { link } = await d.socket;
    const ws = await nthSocket(d.dialled, 1);
    ws.open();

    ws.close(STALE_PROCESS_CLOSE_CODE, "stale server process");

    // Well past the link's first reconnect delay (500ms): a retired wire never
    // re-presents the dead `pid`, so there is no reconnect storm to be
    // re-rejected — the app-side half of review #5.
    await new Promise((r) => setTimeout(r, 1_200));
    expect(d.dialled).toHaveLength(1);
    expect(link.wire.status()).toBe("retired");
    await link.dispose();
  });

  it("re-dials through an ordinary drop (only the stale close is terminal)", async () => {
    const d = dial();
    const { link } = await d.socket;
    const first = await nthSocket(d.dialled, 1);
    first.open();

    first.close(1006, "abnormal closure");

    const second = await nthSocket(d.dialled, 2);
    expect(second).not.toBe(first);
    expect(link.wire.status()).not.toBe("retired");
    await link.dispose();
  });

  it("builds a PRIVATE echo when none is passed (kolu's single wire)", async () => {
    const d = dial();
    const { link, echo } = await d.socket;
    expect(echo.appendTo("ws://h")).toBe("ws://h");
    echo.remember("p7");
    expect(echo.appendTo("ws://h")).toBe("ws://h?pid=p7");
    await link.dispose();
  });
});

describe("createHeartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps probing without reconnecting while the server answers", async () => {
    const w = fakeWire("open");
    const probe = vi.fn().mockResolvedValue({ processId: "p1" });
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(w.reconnects()).toBe(0);
    dispose();
  });

  it("forces a reconnect when a probe never answers (half-open wire)", async () => {
    const w = fakeWire("open");
    const probe = vi.fn().mockReturnValue(new Promise<never>(() => {}));
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick fires the probe
    expect(probe).toHaveBeenCalledTimes(1);
    expect(w.reconnects()).toBe(0);
    await vi.advanceTimersByTimeAsync(500); // probe timeout elapses
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(w.reconnects()).toBe(1);
    dispose();
  });

  it("treats a probe REJECTION as alive — a completed round-trip, not half-open", async () => {
    const w = fakeWire("open");
    const probe = vi.fn().mockRejectedValue(new Error("server said no"));
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.reconnects()).toBe(0);
    dispose();
  });

  it("surfaces a SYNCHRONOUS probe throw — reports it, does NOT reconnect, and does NOT silently count it as alive", async () => {
    const w = fakeWire("open");
    const probe = vi.fn(() => {
      throw new Error("probe miswired");
    });
    const onProbeError = vi.fn();
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe: probe as unknown as () => Promise<unknown>,
      intervalMs: 1000,
      timeoutMs: 500,
      onProbeError,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick fires the probe → it throws
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onProbeError).toHaveBeenCalledTimes(1);
    expect(onProbeError).toHaveBeenCalledWith(expect.any(Error));
    // A sync throw is NOT a transport problem, so it must not churn the wire…
    await vi.advanceTimersByTimeAsync(1000); // let the probe timeout window pass
    expect(w.reconnects()).toBe(0);
    expect(onStale).not.toHaveBeenCalled();
    // …and it must settle so the next tick can probe again (not wedge inFlight).
    expect(probe).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("never probes while the wire is not open", async () => {
    const w = fakeWire("connecting");
    const probe = vi.fn().mockResolvedValue(null);
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).not.toHaveBeenCalled();
    expect(w.reconnects()).toBe(0);
    dispose();
  });

  it("never probes a RETIRED wire (terminal — no reconnect can ever come)", async () => {
    const w = fakeWire("open");
    const probe = vi.fn().mockResolvedValue(null);
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    w.set("retired");
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).not.toHaveBeenCalled();
    expect(w.reconnects()).toBe(0);
    dispose();
  });

  it("never overlaps probes — a tick is skipped while one is still outstanding", async () => {
    const w = fakeWire("open");
    let resolveProbe: ((v: unknown) => void) | undefined;
    const probe = vi.fn().mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe,
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick 1 → probe in flight
    await vi.advanceTimersByTimeAsync(1000); // tick 2 → inFlight, skipped
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe?.({});
    await vi.advanceTimersByTimeAsync(1000); // tick 3 → probe again
    expect(probe).toHaveBeenCalledTimes(2);
    expect(w.reconnects()).toBe(0);
    dispose();
  });

  it("stops probing after dispose", async () => {
    const w = fakeWire("open");
    const probe = vi.fn().mockResolvedValue(null);
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledTimes(1);
    dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect when disposed while a probe is still in flight", async () => {
    const w = fakeWire("open");
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe: () => new Promise<never>(() => {}), // never answers
      intervalMs: 1000,
      timeoutMs: 500,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe in flight, timeout armed
    dispose(); // tear down BEFORE the 500ms probe timeout elapses
    await vi.advanceTimersByTimeAsync(2000); // the timeout window passes
    expect(onStale).not.toHaveBeenCalled();
    expect(w.reconnects()).toBe(0);
  });

  it("still reconnects on a timeout even if the onStale reporter throws", async () => {
    const w = fakeWire("open");
    const onStale = vi.fn(() => {
      throw new Error("logger blew up");
    });
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe: () => new Promise<never>(() => {}),
      intervalMs: 1000,
      timeoutMs: 500,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(1500); // tick + probe timeout
    expect(w.reconnects()).toBe(1);
    dispose();
  });

  it("treats a SYNCHRONOUS probe throw as alive, like a rejection", async () => {
    const w = fakeWire("open");
    const probe = vi.fn(() => {
      throw new Error("sync boom");
    });
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(w.reconnects()).toBe(0);
    dispose();
  });

  it("settles a SYNCHRONOUS probe throw even when the onProbeError reporter throws — no spurious reconnect after the timeout window", async () => {
    const w = fakeWire("open");
    const probe = vi.fn(() => {
      throw new Error("probe miswired");
    });
    const onProbeError = vi.fn(() => {
      throw new Error("reporter blew up");
    });
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      wire: w.wire,
      probe: probe as unknown as () => Promise<unknown>,
      intervalMs: 1000,
      timeoutMs: 500,
      onProbeError,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe throws → reporter throws
    expect(onProbeError).toHaveBeenCalledTimes(1);
    // A throwing reporter must NOT leave the probe armed: once the timeout window
    // passes, the sync fault must not be misclassified as a stale transport.
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.reconnects()).toBe(0);
    expect(onStale).not.toHaveBeenCalled();
    // It settled, so the next tick probes again (not wedged inFlight).
    expect(probe).toHaveBeenCalledTimes(2);
    dispose();
  });
});
