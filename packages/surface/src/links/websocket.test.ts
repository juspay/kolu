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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineSurface } from "../define";
import { SurfaceTransportRetired } from "../errors";
import { RPC_PING_FATAL_SILENCE_MS, RPC_PING_TIMEOUT_MS } from "../keepAlive";
import { isHalfOpenDispatch, type WireStatus } from "../link";
import { type SelfSever, websocketLink } from "./websocket";

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
  /** A browser's `close()` only STARTS the closing handshake; the `close` event
   *  comes later, when the peer answers or gives up. Off by default (the event
   *  fires at once); on, `close()` leaves the socket CLOSING and
   *  {@link emitClose} delivers the event whenever the test says. */
  holdsClose = false;
  constructor(readonly url: string) {
    super();
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(code = 1000, reason = ""): void {
    if (this.readyState >= 2) return;
    if (this.holdsClose) {
      this.readyState = 2; // CLOSING
      return;
    }
    this.emitClose(code, reason);
  }
  /** The `close` event, as the browser finally reports it. */
  emitClose(code: number, reason = ""): void {
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
  /** The server wrote `data` as one websocket message. */
  receive(data: string): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function harness(opts?: {
  isTerminalClose?: (code: number) => boolean;
  /** Make the first N evaluations of the URL thunk THROW — a consumer thunk that
   *  cannot answer yet (kolu's reads the server pid out of live state). */
  urlThrowsFirst?: number;
  onSelfSever?: (sever: SelfSever, socket: WebSocket) => void;
  /** Every dialled socket holds its `close` event (see `holdsClose`). */
  holdClose?: boolean;
}) {
  const dialled: FakeWebSocket[] = [];
  const urls: string[] = [];
  let pid = 1;
  let throwsLeft = opts?.urlThrowsFirst ?? 0;
  const link = websocketLink({
    group: surface.group,
    // The pid ECHO: each dial re-reads the current server process id, so a
    // reconnect never re-presents a stale one.
    url: () => {
      if (throwsLeft > 0) {
        throwsLeft -= 1;
        throw new Error("no server pid yet");
      }
      const url = `ws://localhost/rpc?pid=${pid}`;
      urls.push(url);
      return url;
    },
    isTerminalClose:
      opts?.isTerminalClose ?? ((code) => code === STALE_PROCESS_CLOSE_CODE),
    connect: (url) => {
      const ws = new FakeWebSocket(url);
      ws.holdsClose = opts?.holdClose ?? false;
      dialled.push(ws);
      return ws as unknown as WebSocket;
    },
    ...(opts?.onSelfSever === undefined
      ? {}
      : { onSelfSever: opts.onSelfSever }),
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

  it("a THROWING url thunk fails the dial and re-dials — it does not kill the link", async () => {
    // kolu#2101 G8c. The thunk is CONSUMER code, re-evaluated per dial, and it
    // can legitimately not be answerable yet (kolu's reads the server pid out of
    // live state). Run bare in `Effect.sync` a throw is a DEFECT, which the
    // reconnect schedule does not retry: the link would sit `connecting`
    // forever, never dialling again, with nothing logged. Classified as a
    // `SocketOpenError` it is an ordinary dial failure — back off, re-evaluate,
    // connect.
    const h = harness({ urlThrowsFirst: 1 });
    const link = await h.link;
    const ws = await nthSocket(h.dialled, 1); // the SECOND evaluation dialled
    ws.open();
    expect(ws.url).toBe("ws://localhost/rpc?pid=1");
    await link.dispose();
  });
});

describe("websocketLink — the WatchableWire (#4)", () => {
  it("brands its dispatch half-openable — the face must refuse it without a watchdog (#1564)", async () => {
    const h = harness();
    const link = await h.link;
    expect(isHalfOpenDispatch(link.dispatch)).toBe(true);
    await link.dispose();
  });

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

  it("an undecodable frame cycles the socket: the call it failed is retryable, and the next dial is fresh", async () => {
    const h = harness();
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");

    const call = Effect.runPromise(
      Effect.flip(link.dispatch.unary(DOUBLE_TAG, { x: 1 })),
    );
    await expect.poll(() => first.sent.length, { timeout: 3_000 }).toBe(1);
    // A line the decoder cannot read. Its buffer, and whatever followed the
    // line, are gone, so this socket cannot be trusted with another frame.
    first.dispatchEvent(
      new MessageEvent("message", { data: "not a protocol frame\n" }),
    );

    // The call fails as the face's retry fence expects a socket death to —
    // an `RpcClientError`, never one of the permanently-dead tags…
    const failure = (await call) as { _tag?: unknown };
    expect(failure._tag).toBe("RpcClientError");
    // …and the socket it rode is closed and replaced, not kept.
    expect(first.readyState).toBe(3);
    const second = await nthSocket(h.dialled, 2);
    expect(second).not.toBe(first);
    await link.dispose();
  });

  it("counts open EDGES in diagnostics", async () => {
    const h = harness();
    const link = await h.link;
    expect(link.diagnostics.epoch()).toBe(0);

    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.diagnostics.epoch(), { timeout: 3_000 })
      .toBe(1);

    first.close(1006, "server went away");
    const second = await nthSocket(h.dialled, 2);
    second.open();
    await expect
      .poll(() => link.diagnostics.epoch(), { timeout: 3_000 })
      .toBe(2);
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

/**
 * The DIAL HISTORY (kolu#2101 J1) — the ring buffer a client-side diagnostic
 * reads so a wire incident can be proved from the browser alone.
 *
 * Its reason for existing is one row: `"ended-without-open"`. A dial that fails
 * before its socket opens is swallowed by `retryTransientErrors` — no broadcast,
 * no status value of its own, nothing in the SERVER's log either (the server
 * never saw a connection). Diagnosing the field incident took server-log
 * archaeology plus screenshot forensics precisely because the client held no
 * record that those attempts happened.
 */
describe("websocketLink — the dial history (J1)", () => {
  it("records a swallowed pre-open failure as ended-without-open — the class nothing else can see", async () => {
    // Two dials whose URL thunk throws (the `SocketOpenError` shape), then one
    // that connects.
    const h = harness({ urlThrowsFirst: 2 });
    const link = await h.link;
    const ws = await nthSocket(h.dialled, 1); // the THIRD evaluation dialled
    ws.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");

    const history = link.diagnostics.dialHistory();
    expect(history).toHaveLength(3);
    for (const attempt of history.slice(0, 2)) {
      expect(attempt.classification).toBe("ended-without-open");
      // Never opened, and no close event ever carried a code.
      expect(attempt.openedAt).toBe(undefined);
      expect(attempt.closeCode).toBe(undefined);
      expect(attempt.endedAt).toBeGreaterThanOrEqual(attempt.startedAt);
    }
    const current = history[2];
    expect(current?.classification).toBe("in-flight");
    expect(current?.openedAt).toBeGreaterThanOrEqual(current?.startedAt ?? 0);
    expect(current?.endedAt).toBe(undefined);
    await link.dispose();
  });

  it("records an ordinary cycle as opened-then-closed, with the close code", async () => {
    const h = harness();
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");

    first.close(1006, "server went away");
    const second = await nthSocket(h.dialled, 2);
    second.open();
    await expect
      .poll(() => link.diagnostics.epoch(), { timeout: 3_000 })
      .toBe(2);

    const history = link.diagnostics.dialHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.classification).toBe("opened-then-closed");
    expect(history[0]?.closeCode).toBe(1006);
    expect(history[0]?.openedAt).toBeGreaterThanOrEqual(
      history[0]?.startedAt ?? 0,
    );
    expect(history[1]?.classification).toBe("in-flight");
    await link.dispose();
  });

  it("records a TERMINAL close as terminal — the wire will never dial again", async () => {
    const h = harness();
    const link = await h.link;
    const ws = await nthSocket(h.dialled, 1);
    ws.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");

    ws.close(STALE_PROCESS_CLOSE_CODE, "stale server process");
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("retired");

    const history = link.diagnostics.dialHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.classification).toBe("terminal");
    expect(history[0]?.closeCode).toBe(STALE_PROCESS_CLOSE_CODE);
    await link.dispose();
  });

  it("hands out a SNAPSHOT — a reader cannot mutate the link's own record", async () => {
    const h = harness();
    const link = await h.link;
    const ws = await nthSocket(h.dialled, 1);
    ws.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");

    const [attempt] = link.diagnostics.dialHistory() as unknown as {
      classification: string;
    }[];
    if (attempt === undefined) throw new Error("no dial recorded");
    attempt.classification = "tampered";
    expect(link.diagnostics.dialHistory()[0]?.classification).toBe("in-flight");
    await link.dispose();
  });
});

/**
 * The SELF-SEVER report — the two moments the link ends a socket on its own
 * judgment, named to the host with the very socket it ended, and recorded on
 * that socket's own dial attempt. Every other close is someone else's, and is
 * never reported.
 */
describe("websocketLink — naming the sockets it ends itself", () => {
  /** Every report, with the socket's `readyState` at the moment it ran. */
  function reporter() {
    const reports: {
      sever: SelfSever;
      socket: WebSocket;
      readyState: number;
    }[] = [];
    const onSelfSever = (sever: SelfSever, socket: WebSocket) => {
      reports.push({ sever, socket, readyState: socket.readyState });
    };
    return { reports, onSelfSever };
  }

  it("a bad line names the socket it ended, already closed, and records it on that dial", async () => {
    const r = reporter();
    const h = harness({ onSelfSever: r.onSelfSever });
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");

    first.receive("not a protocol frame\n");

    expect(r.reports).toHaveLength(1);
    const [report] = r.reports;
    expect(report?.sever).toEqual({
      cause: "undecodableFrame",
      frame: {
        kind: "invalidJson",
        parserMessage: expect.any(String),
        read: { unit: "utf16", length: 21 },
      },
    });
    expect(report?.socket).toBe(first);
    expect(report?.readyState).toBeGreaterThanOrEqual(2);
    expect(link.diagnostics.dialHistory()[0]?.selfSever).toEqual(report?.sever);
    await nthSocket(h.dialled, 2);
    await link.dispose();
  });

  it("reports a socket once, however many bad reads arrive before its close", async () => {
    const r = reporter();
    // The close is held, so the socket stays readable after the link ends it.
    const h = harness({ onSelfSever: r.onSelfSever, holdClose: true });
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");

    first.receive("bad\nworse\n");
    first.receive("still bad\n");
    first.emitClose(1000);

    await nthSocket(h.dialled, 2);
    expect(r.reports).toHaveLength(1);
    await link.dispose();
  });

  it("a reporter that throws stops nothing: the next socket is still dialled, and the throw is logged once", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const h = harness({
        onSelfSever: () => {
          throw new Error("the host's reporter broke");
        },
      });
      const link = await h.link;
      const first = await nthSocket(h.dialled, 1);
      first.open();
      await expect
        .poll(() => link.wire.status(), { timeout: 3_000 })
        .toBe("open");

      first.receive("not a protocol frame\n");

      const second = await nthSocket(h.dialled, 2);
      expect(second).not.toBe(first);
      expect(logged).toHaveBeenCalledTimes(1);
      await link.dispose();
    } finally {
      logged.mockRestore();
    }
  });

  it("never reports a close someone else made: forceReconnect, the peer's 1006, dispose, a terminal close", async () => {
    const r = reporter();
    const h = harness({ onSelfSever: r.onSelfSever });
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 3_000 })
      .toBe("open");
    link.wire.forceReconnect();
    const second = await nthSocket(h.dialled, 2);
    second.open();
    await expect
      .poll(() => link.diagnostics.epoch(), { timeout: 3_000 })
      .toBe(2);
    second.close(1006, "network went away");
    const third = await nthSocket(h.dialled, 3);
    third.open();
    await expect
      .poll(() => link.diagnostics.epoch(), { timeout: 3_000 })
      .toBe(3);
    await link.dispose();

    const retiring = harness({ onSelfSever: r.onSelfSever });
    const retired = await retiring.link;
    const only = await nthSocket(retiring.dialled, 1);
    only.open();
    await expect
      .poll(() => retired.wire.status(), { timeout: 3_000 })
      .toBe("open");
    only.close(STALE_PROCESS_CLOSE_CODE, "stale server process");
    await expect
      .poll(() => retired.wire.status(), { timeout: 3_000 })
      .toBe("retired");
    await retired.dispose();

    expect(r.reports).toEqual([]);
    for (const attempt of [
      ...link.diagnostics.dialHistory(),
      ...retired.diagnostics.dialHistory(),
    ]) {
      expect(attempt.selfSever).toBe(undefined);
    }
  });

  /** The keep-alive backstop is a minute, so these run on a VIRTUAL clock, as
   *  law 3 of `socketRedialLaws.test.ts` does — plus `performance`, because the
   *  silence the report names is measured on the monotonic clock. */
  describe("silence past the backstop (virtual clock)", () => {
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "Date",
          "performance",
        ],
      });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Walk the virtual clock in 100ms steps until `holds()`, failing loudly
     *  past the backstop plus slack for the re-dial backoff. */
    async function virtually(holds: () => boolean, what: string) {
      const budgetMs = RPC_PING_FATAL_SILENCE_MS + 5_000;
      for (let walked = 0; !holds(); walked += 100) {
        if (walked > budgetMs) {
          throw new Error(`${what} did not hold within ${budgetMs}ms`);
        }
        await vi.advanceTimersByTimeAsync(100);
      }
    }

    it("silence past the backstop names the socket, and how long it was silent; the call still fails retryably", async () => {
      const r = reporter();
      const h = harness({ onSelfSever: r.onSelfSever });
      const link = await h.link;
      const first = await nthSocket(h.dialled, 1);
      first.open();
      await virtually(() => link.wire.status() === "open", "the open");
      const call = Effect.runPromise(
        Effect.flip(link.dispatch.unary(DOUBLE_TAG, { x: 1 })),
      );

      await virtually(() => r.reports.length > 0, "the keep-alive report");

      expect(r.reports).toHaveLength(1);
      const [report] = r.reports;
      expect(report?.socket).toBe(first);
      expect(report?.readyState).toBeGreaterThanOrEqual(2);
      const sever = report?.sever;
      if (sever?.cause !== "keepAliveUnanswered") {
        throw new Error(`expected a keep-alive sever, got ${sever?.cause}`);
      }
      expect(sever.silentMs).toBeGreaterThan(RPC_PING_TIMEOUT_MS);
      expect(sever.silentMs).toBeLessThanOrEqual(RPC_PING_FATAL_SILENCE_MS);
      expect(await call).toMatchObject({ _tag: "RpcClientError" });
      expect(link.diagnostics.dialHistory()[0]?.selfSever).toEqual(sever);
      await link.dispose();
    });

    it("a late close lands on its OWN socket's attempt, not on the next one's", async () => {
      const h = harness({ holdClose: true });
      const link = await h.link;
      const first = await nthSocket(h.dialled, 1);
      first.open();
      await virtually(() => link.wire.status() === "open", "the open");

      await virtually(() => h.dialled.length >= 2, "the re-dial");
      // The browser finally reports the close of the socket the link ended a
      // whole backoff ago.
      first.emitClose(1006);

      const [one, two] = link.diagnostics.dialHistory();
      expect(one?.closeCode).toBe(1006);
      expect(two?.closeCode).toBe(undefined);
      expect(one?.selfSever?.cause).toBe("keepAliveUnanswered");
      await link.dispose();
    });
  });
});
