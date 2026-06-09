/**
 * `@kolu/surface-app/connect` — the two PURE pieces of the client transport
 * assembly both kolu and drishti used to hand-roll: the `pid`-echo (URL-param
 * threading) and the stale-close → retire listener. These carry the real logic
 * and the footguns; `createSurfaceSocket` itself is thin glue over them plus one
 * `new PartySocket(...)` (verified by typecheck + the #410 e2e reconnect test —
 * a live partysocket in a Node unit test only flakes, so it's not constructed
 * here). Solid-free, like the kernel suite.
 */

import { shouldNotRetryORPCError } from "@kolu/surface/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHeartbeat,
  createProcessIdEcho,
  retireOnStaleClose,
} from "./connect";
import { STALE_PROCESS_CLOSE_CODE } from "./index";

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

/** A socket reduced to what `retireOnStaleClose` touches: a single close listener
 *  we fire by hand, plus the `{ close, send }` `retireSocket` overwrites. */
function fakeSocket() {
  let listener: ((event: { code?: number }) => void) | undefined;
  let closed = 0;
  const ws = {
    addEventListener: (
      _type: "close",
      fn: (event: { code?: number }) => void,
    ) => {
      listener = fn;
    },
    close: () => {
      closed++;
    },
    send: (() => {}) as unknown,
  };
  return {
    ws,
    fire: (code?: number) => listener?.({ code }),
    closed: () => closed,
  };
}

describe("retireOnStaleClose", () => {
  it("retires the socket on the stale-close code (stop reconnect + fail sends)", () => {
    const t = fakeSocket();
    retireOnStaleClose(t.ws, STALE_PROCESS_CLOSE_CODE);
    t.fire(STALE_PROCESS_CLOSE_CODE);
    expect(t.closed()).toBe(1);
    // `retireSocket` replaced `send` with a throwing stub — a post-stale send
    // rejects instead of buffering forever behind the reload overlay.
    expect(() => (t.ws.send as (d: string) => void)("x")).toThrow(/stale tab/);
  });

  it("ignores ordinary transient close codes (partysocket reconnects through them)", () => {
    const t = fakeSocket();
    retireOnStaleClose(t.ws, STALE_PROCESS_CLOSE_CODE);
    t.fire(1006); // abnormal closure — a normal drop, not a restart
    expect(t.closed()).toBe(0);
    // send untouched — still the original no-op, does NOT throw.
    expect(() => (t.ws.send as (d: string) => void)("x")).not.toThrow();
  });

  it("retires with a NON-retriable error so STREAM_RETRY consumers settle", () => {
    const t = fakeSocket();
    retireOnStaleClose(t.ws, STALE_PROCESS_CLOSE_CODE);
    t.fire(STALE_PROCESS_CLOSE_CODE);
    let thrown: unknown;
    try {
      (t.ws.send as (d: string) => void)("x");
    } catch (err) {
      thrown = err;
    }
    const fence = shouldNotRetryORPCError as (a: { error: unknown }) => boolean;
    expect(fence({ error: thrown })).toBe(false);
  });
});

/** A socket reduced to what `createHeartbeat` reads: `readyState`/`OPEN` and a
 *  `reconnect` spy. `OPEN` is 1 (the WebSocket constant); flip `readyState` to a
 *  non-OPEN value to model a connecting/closed socket. */
function fakeHeartbeatSocket(readyState = 1) {
  return { readyState, OPEN: 1, reconnect: vi.fn() };
}

describe("createHeartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps probing without reconnecting while the server answers", async () => {
    const ws = fakeHeartbeatSocket();
    const probe = vi.fn().mockResolvedValue({ processId: "p1" });
    const { dispose } = createHeartbeat({
      ws,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(ws.reconnect).not.toHaveBeenCalled();
    dispose();
  });

  it("forces a reconnect when a probe never answers (half-open socket)", async () => {
    const ws = fakeHeartbeatSocket();
    const probe = vi.fn().mockReturnValue(new Promise<never>(() => {}));
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      ws,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick fires the probe
    expect(probe).toHaveBeenCalledTimes(1);
    expect(ws.reconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500); // probe timeout elapses
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(ws.reconnect).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("treats a probe REJECTION as alive — a completed round-trip, not half-open", async () => {
    const ws = fakeHeartbeatSocket();
    const probe = vi.fn().mockRejectedValue(new Error("server said no"));
    const { dispose } = createHeartbeat({
      ws,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ws.reconnect).not.toHaveBeenCalled();
    dispose();
  });

  it("never probes while the socket is not OPEN", async () => {
    const ws = fakeHeartbeatSocket(0); // CONNECTING
    const probe = vi.fn().mockResolvedValue(null);
    const { dispose } = createHeartbeat({
      ws,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).not.toHaveBeenCalled();
    expect(ws.reconnect).not.toHaveBeenCalled();
    dispose();
  });

  it("never overlaps probes — a tick is skipped while one is still outstanding", async () => {
    const ws = fakeHeartbeatSocket();
    let resolveProbe: ((v: unknown) => void) | undefined;
    const probe = vi.fn().mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const { dispose } = createHeartbeat({
      ws,
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
    expect(ws.reconnect).not.toHaveBeenCalled();
    dispose();
  });

  it("stops probing after dispose", async () => {
    const ws = fakeHeartbeatSocket();
    const probe = vi.fn().mockResolvedValue(null);
    const { dispose } = createHeartbeat({
      ws,
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
});
