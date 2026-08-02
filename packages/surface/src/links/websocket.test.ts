/**
 * The three seams `websocketLink` owns beyond "speak RPC over a socket" — each
 * one a recorded incident, none of them expressible with Effect's stock socket
 * layer (PLAN D5, review #4/#5/#6c):
 *
 *  1. a TERMINAL close code retires the wire — one close, zero re-dials, and
 *     every call from then on fails `SurfaceTransportRetired`;
 *  2. an ordinary close re-dials, RE-EVALUATING the URL thunk (the pid echo:
 *     a reconnect that re-presents a stale pid is closed again immediately);
 *  3. the `WatchableWire` — status, subscription, and an imperative
 *     `forceReconnect` for the half-open watchdog.
 *
 * The socket is a fake `WebSocket`: these are properties of the DIAL, and a
 * real server would only add a second source of nondeterminism to a test about
 * how many times we connect. The frame path itself is exercised for real over
 * stdio/unix sockets in `stdio.test.ts` / `unix-socket.test.ts`.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import { SurfaceTransportRetired } from "../errors";
import type { WireStatus } from "../link";
import { websocketLink } from "./websocket";

const surface = defineSurface({
  procedures: {
    math: {
      double: {
        input: Schema.Struct({ x: Schema.Number }),
        output: Schema.Struct({ y: Schema.Number }),
      },
    },
  },
});
const DOUBLE_TAG = "surface/math/double";

/** The close code surface-app's stale-tab gate uses. The classifier is a link
 *  OPTION — `@kolu/surface` may not import `@kolu/surface-app` (the dependency
 *  arrow points the other way), and the close-code vocabulary belongs to the
 *  app that serves the socket. */
const STALE_PROCESS_CLOSE_CODE = 4001;

/** Enough of the `WebSocket` API for `Socket.fromWebSocket`: the three events
 *  it listens for, `readyState`, `send` and `close`. Nothing answers, because
 *  no test here asserts on a response. */
class FakeWebSocket extends EventTarget {
  readyState = 0; // CONNECTING
  readonly sent: (string | Uint8Array)[] = [];
  constructor(readonly url: string) {
    super();
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3; // CLOSED
    const event = new Event("close") as Event & {
      code: number;
      reason: string;
    };
    event.code = code;
    event.reason = reason;
    this.dispatchEvent(event);
  }
  /** The server accepted the dial. */
  open(): void {
    this.readyState = 1; // OPEN
    this.dispatchEvent(new Event("open"));
  }
}

function harness(opts?: { isTerminalClose?: (code: number) => boolean }) {
  const dialled: FakeWebSocket[] = [];
  const urls: string[] = [];
  let pid = 1;
  const link = websocketLink({
    group: surface.group,
    // The pid ECHO: each dial re-reads the current server process id, so a
    // reconnect never re-presents a stale one.
    url: () => {
      const url = `ws://localhost/rpc?pid=${pid}`;
      urls.push(url);
      return url;
    },
    isTerminalClose:
      opts?.isTerminalClose ?? ((code) => code === STALE_PROCESS_CLOSE_CODE),
    connect: (url) => {
      const ws = new FakeWebSocket(url);
      dialled.push(ws);
      return ws as unknown as WebSocket;
    },
  });
  return {
    link,
    dialled,
    urls,
    bumpServerPid: () => {
      pid += 1;
    },
  };
}

/** The dial happens in the protocol's own fiber, so wait for the socket rather
 *  than assuming it exists the moment the link resolves. */
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

describe("websocketLink — the terminal-close classifier (#5)", () => {
  it("a terminal close stops the wire dead: exactly one close, zero re-dials", async () => {
    const h = harness();
    const link = await h.link;
    const ws = await nthSocket(h.dialled, 1);
    ws.open();

    ws.close(STALE_PROCESS_CLOSE_CODE, "stale server process");

    // Well past the first reconnect delay (500ms) — nothing may re-dial.
    await new Promise((r) => setTimeout(r, 1_200));
    expect(h.dialled).toHaveLength(1);
    expect(link.wire.status()).toBe("retired");
    await link.dispose();
  });

  it("fails an IN-FLIGHT call with SurfaceTransportRetired when the wire is retired", async () => {
    const h = harness();
    const link = await h.link;
    const ws = await nthSocket(h.dialled, 1);
    ws.open();

    const inFlight = Effect.runPromise(
      Effect.flip(link.dispatch.unary(DOUBLE_TAG, { x: 21 })),
    );
    // The request is on the wire (nothing will ever answer it).
    await expect
      .poll(() => ws.sent.length, { timeout: 3_000 })
      .toBeGreaterThan(0);

    ws.close(STALE_PROCESS_CLOSE_CODE, "stale server process");

    expect(await inFlight).toBeInstanceOf(SurfaceTransportRetired);
    await link.dispose();
  });

  it("fails every FUTURE call with SurfaceTransportRetired, without re-dialling", async () => {
    const h = harness();
    const link = await h.link;
    const ws = await nthSocket(h.dialled, 1);
    ws.open();
    ws.close(STALE_PROCESS_CLOSE_CODE, "stale server process");
    await new Promise((r) => setTimeout(r, 50));

    const failure = await Effect.runPromise(
      Effect.flip(link.dispatch.unary(DOUBLE_TAG, { x: 1 })),
    );
    expect(failure).toBeInstanceOf(SurfaceTransportRetired);
    expect(h.dialled).toHaveLength(1);
    await link.dispose();
  });

  it("an ORDINARY close (1006) re-dials — the retirement is the classifier's verdict, not any close", async () => {
    const h = harness();
    const link = await h.link;
    const ws = await nthSocket(h.dialled, 1);
    ws.open();

    ws.close(1006, "abnormal closure");

    const second = await nthSocket(h.dialled, 2);
    expect(second).not.toBe(ws);
    await link.dispose();
  });
});

describe("websocketLink — the URL thunk (#6c)", () => {
  it("re-evaluates the URL on every re-dial, so a reconnect carries the CURRENT pid", async () => {
    const h = harness();
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    expect(first.url).toBe("ws://localhost/rpc?pid=1");

    // The server restarted while we were connected.
    h.bumpServerPid();
    first.close(1006, "server went away");

    const second = await nthSocket(h.dialled, 2);
    expect(second.url).toBe("ws://localhost/rpc?pid=2");
    await link.dispose();
  });
});

describe("websocketLink — the WatchableWire (#4)", () => {
  it("reports connecting → open → retired, and notifies subscribers", async () => {
    const h = harness();
    const link = await h.link;
    const seen: WireStatus[] = [];
    const unsubscribe = link.wire.onStatus((s) => seen.push(s));

    const ws = await nthSocket(h.dialled, 1);
    expect(link.wire.status()).toBe("connecting");
    ws.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");
    ws.close(STALE_PROCESS_CLOSE_CODE);
    expect(link.wire.status()).toBe("retired");

    expect(seen).toEqual(["open", "retired"]);
    unsubscribe();
    await link.dispose();
  });

  it("forceReconnect severs the current socket and dials again", async () => {
    const h = harness();
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");

    // The half-open recovery action: the socket LOOKS open, no bytes flow, so
    // the watchdog severs it.
    link.wire.forceReconnect();
    expect(first.readyState).toBe(3);

    const second = await nthSocket(h.dialled, 2);
    expect(second).not.toBe(first);
    await link.dispose();
  });

  it("stops notifying after unsubscribe", async () => {
    const h = harness();
    const link = await h.link;
    const seen: WireStatus[] = [];
    const unsubscribe = link.wire.onStatus((s) => seen.push(s));
    unsubscribe();

    const ws = await nthSocket(h.dialled, 1);
    ws.open();
    ws.close(STALE_PROCESS_CLOSE_CODE);
    expect(seen).toEqual([]);
    await link.dispose();
  });
});
