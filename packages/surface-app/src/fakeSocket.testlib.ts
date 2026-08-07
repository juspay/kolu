/**
 * Test doubles for the two transport shapes surface-app now speaks: a WebSocket
 * (what `websocketLink` dials and what the server serving seam accepts) and a
 * `WatchableWire` (what `createServerLifecycle` and `createHeartbeat` observe).
 *
 * A live socket in a Node unit test only adds nondeterminism to assertions about
 * how many times we DIAL and what a status stream reports, so both are faked —
 * and `FakeWebSocket`s can be PAIRED, which makes a full client↔server round trip
 * (real `websocketLink` ↔ real `serveSurfaceSocket`, real ndjson frames) possible
 * with no server process and no `ws` dependency.
 */

import type { WatchableWire, WireStatus } from "@kolu/surface/link";

/** Enough of the `WebSocket` API for Effect's `Socket.fromWebSocket`: the four
 *  events it listens for, `readyState`, `send` and `close`. */
export class FakeWebSocket extends EventTarget {
  /** 0 CONNECTING · 1 OPEN · 3 CLOSED — the WebSocket constants. */
  readyState = 0;
  readonly sent: (string | Uint8Array)[] = [];
  /** When set, everything this socket sends arrives as a `message` on the peer. */
  peer?: FakeWebSocket;
  constructor(readonly url: string) {
    super();
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
    const peer = this.peer;
    // A microtask, not a synchronous hand-off: a real socket never re-enters its
    // sender, and the RPC protocol's own fibers must get a turn between frames.
    if (peer !== undefined) queueMicrotask(() => peer.receive(data));
  }
  /** Deliver a frame to THIS socket's listeners (what a peer's `send` does). */
  receive(data: string | Uint8Array): void {
    if (this.readyState !== 1) return;
    const event = new Event("message") as Event & {
      data: string | Uint8Array;
    };
    event.data = data;
    this.dispatchEvent(event);
  }
  /** The server accepted the dial. */
  open(): void {
    if (this.readyState === 3) return;
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const event = new Event("close") as Event & {
      code: number;
      reason: string;
    };
    event.code = code;
    event.reason = reason;
    this.dispatchEvent(event);
    // A close is a fact about the CONNECTION, so it reaches the far end too.
    this.peer?.close(code, reason);
  }
}

/** Two OPEN sockets wired to each other — a whole connection, in memory. */
export function socketPair(url = "ws://test/rpc/ws"): {
  client: FakeWebSocket;
  server: FakeWebSocket;
} {
  const client = new FakeWebSocket(url);
  const server = new FakeWebSocket(url);
  client.peer = server;
  server.peer = client;
  client.readyState = 1;
  server.readyState = 1;
  return { client, server };
}

/** A `WatchableWire` whose status the test sets by hand, recording every
 *  `forceReconnect` the watchdog asks for. */
export function fakeWire(initial: WireStatus = "connecting"): {
  wire: WatchableWire;
  set: (status: WireStatus) => void;
  reconnects: () => number;
  watchers: () => number;
} {
  let status = initial;
  let reconnects = 0;
  const cbs = new Set<(s: WireStatus) => void>();
  return {
    wire: {
      status: () => status,
      onStatus: (cb) => {
        cbs.add(cb);
        return () => {
          cbs.delete(cb);
        };
      },
      forceReconnect: () => {
        reconnects += 1;
      },
    },
    set: (next) => {
      if (next === status) return;
      status = next;
      for (const cb of [...cbs]) cb(next);
    },
    reconnects: () => reconnects,
    watchers: () => cbs.size,
  };
}
