/**
 * `wsHeartbeat` — the server-side liveness sweep that reaps half-open sockets.
 * `heartbeatSweep` is pure over its deps (no timers, no real server), so it's
 * tested directly; `startWsHeartbeat` is exercised over fake timers for the
 * ping → (no pong) → terminate cadence and the `pong`-keeps-alive path.
 */

import type { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heartbeatSweep, startWsHeartbeat } from "./wsHeartbeat.ts";

/** A server socket reduced to what the heartbeat touches: `readyState`/`OPEN`,
 *  `ping`/`terminate` spies, and an `on("pong")` registrar whose handlers `pong()`
 *  fires (to model a client answering). */
function fakeServerSocket(readyState = 1) {
  const pongHandlers: Array<() => void> = [];
  return {
    readyState,
    OPEN: 1,
    ping: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === "pong") pongHandlers.push(cb);
    }),
    pong: () => {
      for (const h of pongHandlers) h();
    },
  };
}

type FakeSocket = ReturnType<typeof fakeServerSocket>;
const asWs = (ws: FakeSocket) => ws as unknown as WebSocket;
const fakeServer = (...clients: FakeSocket[]) =>
  ({ clients: new Set(clients.map(asWs)) }) as unknown as WebSocketServer;

describe("heartbeatSweep", () => {
  it("pings a live socket and clears its flag (so the next miss is detectable)", () => {
    const ws = fakeServerSocket();
    const alive = new WeakSet([asWs(ws)]);
    heartbeatSweep([asWs(ws)], alive);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(alive.has(asWs(ws))).toBe(false);
  });

  it("terminates a socket that missed the previous ping", () => {
    const ws = fakeServerSocket();
    heartbeatSweep([asWs(ws)], new WeakSet());
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(ws.ping).not.toHaveBeenCalled();
  });

  it("skips a socket that is not OPEN (a gate-closed stale tab mid-close)", () => {
    const ws = fakeServerSocket(0);
    heartbeatSweep([asWs(ws)], new WeakSet());
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(ws.ping).not.toHaveBeenCalled();
  });
});

describe("startWsHeartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pings a registered socket, then terminates it when no pong arrives", () => {
    const ws = fakeServerSocket();
    const { register, stop } = startWsHeartbeat(fakeServer(ws), {
      intervalMs: 1000,
    });
    register(asWs(ws));
    vi.advanceTimersByTime(1000); // sweep 1: alive → ping, clear flag
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); // sweep 2: missed pong → terminate
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps a socket alive when a pong arrives between sweeps", () => {
    const ws = fakeServerSocket();
    const { register, stop } = startWsHeartbeat(fakeServer(ws), {
      intervalMs: 1000,
    });
    register(asWs(ws));
    vi.advanceTimersByTime(1000); // ping, flag cleared
    ws.pong(); // client answered → re-marked alive
    vi.advanceTimersByTime(1000); // still alive → ping again, no terminate
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(ws.ping).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stop() halts the sweeps", () => {
    const ws = fakeServerSocket();
    const { register, stop } = startWsHeartbeat(fakeServer(ws), {
      intervalMs: 1000,
    });
    register(asWs(ws));
    stop();
    vi.advanceTimersByTime(5000);
    expect(ws.ping).not.toHaveBeenCalled();
  });
});
