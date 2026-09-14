/**
 * WHICH re-dials a registered call is told about — the laws kolu#2101 H3 and J1
 * rest on, measured rather than assumed.
 *
 * A `websocketLink` re-dials for two quite different reasons, and Effect RPC
 * treats them differently in a way nothing in this repo's types can express:
 *
 *  1. **A live socket CLOSES** (`SocketCloseError`). The protocol broadcasts
 *     `ClientProtocolError`, which is the ONE thing that fails every registered
 *     entry, so an in-flight stream fails and the per-subscription fence
 *     ({@link fenceStream}) re-subscribes on the new wire. This is the covered
 *     channel, and the first law below pins it — including the exact shape H3's
 *     hypothesis named: the half-open watchdog's `forceReconnect` severing an
 *     OPEN socket with code 1000 before a stream's first frame.
 *  2. **A DIAL fails before the socket opens** (`SocketOpenError` — a pre-open
 *     `error` event, the 10s open timeout, or a throwing URL thunk). With
 *     `retryTransientErrors: true` — which `websocketLink` sets, deliberately,
 *     so a socket that never opened doesn't flap every consumer — Effect RPC's
 *     `tapCause` returns EARLY for this reason and never broadcasts. Nothing
 *     fails. The protocol re-dials underneath, and a registered stream sits
 *     there learning nothing, for as long as the dials keep failing.
 *
 *  3. **A run that ends WITHOUT broadcasting ORPHANS everything it carried, and
 *     a registered entry is never re-sent.** Law 2's shape is not confined to a
 *     dial that never opened: the ping timeout on an ESTABLISHED socket ends the
 *     run with the same swallowed `SocketOpenError` (`RpcClient.js`'s
 *     `Effect.raceFirst(pinger.timeout …)`), and Effect RPC writes a call's entry
 *     exactly ONCE at registration and never re-sends it on the next socket. So a
 *     call whose request already WENT OUT on the dead socket can only park
 *     forever — a healthy wire over frozen state, which is what reached
 *     production (kolu#2101 J1). `websocketLink` therefore counts open EDGES
 *     (the epoch) and fails, itself, every call an edge superseded. Law 3 pins
 *     both halves: the framework behavior that makes the fix necessary, and the
 *     fix's own coalescing with law 1.
 *
 * Law 2 is why `reattachingStream.ts` needs a FIRST-FRAME DEADLINE at all for the
 * class law 3 does NOT cover (an upstream that stalls with the wire genuinely
 * open): there is no failure to retry on, so silence is the only signal left.
 * This file is the measuring law for that module's `BETA-ASSUMPTION(rc.112)`
 * marker AND for `websocket.ts`'s — bump the pin, re-run this file, re-stamp.
 */

import { Effect, Exit, Layer, Schema, Scope, Stream } from "effect";
import { RpcServer } from "effect/unstable/rpc";
import { Socket, SocketServer } from "effect/unstable/socket";
import { describe, expect, it, vi } from "vitest";
import { fenceStream } from "../client";
import { defineSurface } from "../define";
import { rpcSerializationLayer } from "../frameLimit";
import type { WireStatus } from "../link";
import { implementSurface, surfaceRpcServerLayer } from "../server";
import {
  resetSubscriptionLiveness,
  subscriptionLiveness,
} from "../subscriptions";
import { websocketLink } from "./websocket";

const surface = defineSurface({
  streams: { ticks: { inputSchema: Schema.Void, outputSchema: Schema.String } },
  procedures: { probe: { ask: { output: Schema.String } } },
});
const TICKS_TAG = "surface/ticks/get";
const ASK_TAG = "surface/probe/ask";

/** Enough of the `WebSocket` API for `Socket.fromWebSocket`. Two sockets can be
 *  PAIRED (`peer`), which is what makes a real client↔server round trip possible
 *  without a server process — law 3's post-fix arm has to prove that a re-drive
 *  renders CURRENT truth, which needs something that answers. The unpaired shape
 *  is still what laws 1 and 2 use: they are about which failures reach a
 *  registered entry, and a response would only add nondeterminism. */
class FakeWebSocket extends EventTarget {
  readyState = 0; // CONNECTING
  readonly sent: (string | Uint8Array)[] = [];
  /** When set, everything this socket sends arrives as a `message` on the peer. */
  peer?: FakeWebSocket;
  /** Frames that arrived before anything was listening for `message`. The two
   *  sides are not in the same tick — the RPC server attaches its listener inside
   *  an Effect run, while a client sends the moment its socket opens — so a
   *  buffer is the difference between a test about re-dialing and a test about
   *  scheduling luck. (`@kolu/surface-app`'s `bufferedSocketView` exists for the
   *  same reason on the real serving path.) */
  private buffered: (string | Uint8Array)[] = [];
  private listening = false;
  constructor(readonly url: string) {
    super();
  }
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
    if (type !== "message" || this.listening) return;
    this.listening = true;
    const queued = this.buffered;
    this.buffered = [];
    // A microtask, so the flush never re-enters the caller's own registration.
    queueMicrotask(() => {
      for (const data of queued) this.deliver(data);
    });
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
    const peer = this.peer;
    // A microtask, not a synchronous hand-off: a real socket never re-enters its
    // sender, and the RPC protocol's own fibers must get a turn between frames.
    if (peer !== undefined) queueMicrotask(() => peer.receive(data));
  }
  receive(data: string | Uint8Array): void {
    if (this.readyState !== 1) return;
    if (!this.listening) {
      this.buffered.push(data);
      return;
    }
    this.deliver(data);
  }
  private deliver(data: string | Uint8Array): void {
    if (this.readyState !== 1) return;
    const event = new Event("message") as Event & {
      data: string | Uint8Array;
    };
    event.data = data;
    this.dispatchEvent(event);
  }
  open(): void {
    if (this.readyState === 3) return;
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  // 1000 is `websocketLink`'s FORCE_RECONNECT_CLOSE_CODE — an ORDINARY closure,
  // on purpose: the watchdog is recovering the link, so the schedule must re-dial.
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

/** How many SUBSCRIBE requests for `TICKS_TAG` this socket carried. `sent` also
 *  carries the protocol's own pings, which is exactly why "one re-drive, not two"
 *  cannot be asserted on a raw length. */
function requestsOn(ws: FakeWebSocket, tag: string): number {
  return ws.sent.filter((frame) => String(frame).includes(tag)).length;
}

function harness(opts?: {
  /** Start with EVERY url-thunk evaluation throwing — each dial then fails
   *  PRE-OPEN, which `websocketLink` classifies as `SocketOpenError` (its
   *  `Effect.try` acquire). The shape law 2 measures; `setDialFails` lifts it. */
  dialsFail?: boolean;
}) {
  const dialled: FakeWebSocket[] = [];
  let attempts = 0;
  let dialsFail = opts?.dialsFail ?? false;
  const link = websocketLink({
    group: surface.group,
    url: () => {
      attempts += 1;
      if (dialsFail) throw new Error("the network is down");
      return "ws://localhost/rpc";
    },
    isTerminalClose: () => false,
    connect: (url) => {
      const ws = new FakeWebSocket(url);
      dialled.push(ws);
      return ws as unknown as WebSocket;
    },
  });
  return {
    link,
    dialled,
    attempts: () => attempts,
    setDialFails: (v: boolean) => {
      dialsFail = v;
    },
  };
}

/** The `SocketServer` Effect's server-side socket protocol wants, whose whole
 *  population is ONE already-open socket — the in-test twin of
 *  `@kolu/surface-app`'s `oneConnectionSocketServer`. */
function oneConnectionSocketServer(
  ws: FakeWebSocket,
): Layer.Layer<SocketServer.SocketServer> {
  return Layer.effect(SocketServer.SocketServer)(
    Effect.map(
      Socket.fromWebSocket(
        Effect.acquireRelease(
          Effect.succeed(ws as unknown as WebSocket),
          (socket) =>
            Effect.sync(() => {
              if (socket.readyState <= 1) socket.close();
            }),
        ),
      ),
      (accepted) =>
        SocketServer.SocketServer.of({
          address: { _tag: "TcpAddress", hostname: "fake", port: 0 },
          run: (handler) =>
            Effect.flatMap(
              handler(accepted),
              () => Effect.never,
            ) as unknown as Effect.Effect<
              never,
              SocketServer.SocketServerError,
              never
            >,
        }),
    ),
  );
}

/** The dial runs on the protocol's own fiber. */
async function nthSocket(
  dialled: FakeWebSocket[],
  n: number,
  timeout = 5_000,
): Promise<FakeWebSocket> {
  await expect
    .poll(() => dialled.length, { timeout })
    .toBeGreaterThanOrEqual(n);
  const ws = dialled[n - 1];
  if (ws === undefined) throw new Error(`no socket #${n}`);
  return ws;
}

/** A `websocketLink` whose every dial lands on a REAL served surface: each dialled
 *  socket is paired with a server-side twin running its own `RpcServer` over ONE
 *  shared, mutable server state.
 *
 *  Sharing the state across connections is the point (the reviewer's post-script):
 *  a re-drive must render the CURRENT truth off a fresh subscribe, with no
 *  session-side action at all — exactly what a hard reload of the stuck tab did
 *  in the field. */
function servedHarness() {
  /** The one fact the served surface publishes; the incident's `connecting` →
   *  `connected` in miniature. Every write is timestamped so the test can prove
   *  nothing server-side happened after the wire came back. */
  let state = "provisioning";
  const serverWrites: { at: number; value: string }[] = [];

  const runtime = implementSurface(surface, {
    streams: {
      // Snapshot-then-nothing: the whole claim is that a FRESH subscribe renders
      // current truth, so the snapshot IS the payload under test.
      ticks: {
        source: () =>
          Stream.suspend(() => Stream.concat(Stream.make(state), Stream.never)),
      },
    },
    procedures: { probe: { ask: () => Effect.succeed(state) } },
  });

  const dialled: FakeWebSocket[] = [];
  const servers: FakeWebSocket[] = [];
  const scopes: Scope.Closeable[] = [];

  const link = websocketLink({
    group: surface.group,
    url: () => "ws://localhost/rpc",
    isTerminalClose: () => false,
    connect: (url) => {
      const client = new FakeWebSocket(url);
      const server = new FakeWebSocket(url);
      client.peer = server;
      server.peer = client;
      // The server side is ALREADY accepted, so `fromWebSocket`'s open-wait
      // short-circuits; the CLIENT side stays CONNECTING until the test opens it.
      server.readyState = 1;
      dialled.push(client);
      servers.push(server);
      const scope = Scope.makeUnsafe();
      scopes.push(scope);
      void Effect.runPromise(
        Scope.provide(
          Layer.build(
            surfaceRpcServerLayer(runtime.group, runtime.handlers).pipe(
              Layer.provide(RpcServer.layerProtocolSocketServer),
              Layer.provide(rpcSerializationLayer),
              Layer.provide(oneConnectionSocketServer(server)),
            ),
          ),
          scope,
        ),
      );
      return client as unknown as WebSocket;
    },
  });

  return {
    link,
    dialled,
    /** Sever the wire SILENTLY — no close frame in either direction, which is
     *  what a laptop lid or a wifi roam actually does. The socket stays `open` at
     *  both ends and only the RPC pinger will ever notice. */
    cut: (n: number) => {
      const client = dialled[n - 1];
      const server = servers[n - 1];
      if (client === undefined || server === undefined) {
        throw new Error(`no socket #${n} to cut`);
      }
      client.peer = undefined;
      server.peer = undefined;
    },
    setState: (value: string) => {
      state = value;
      serverWrites.push({ at: Date.now(), value });
    },
    serverWrites: () => serverWrites,
    dispose: async () => {
      await runtime.close();
      for (const scope of scopes) {
        await Effect.runPromise(Scope.close(scope, Exit.void));
      }
    },
  };
}

describe("re-dial law 1 — a CLOSE fails registered entries, so the fence re-drives the stream", () => {
  it("a force-cycled socket (close 1000) BEFORE the first frame → re-subscribed on the new wire", async () => {
    // kolu#2101 H3's ws7→ws8 hypothesis, as a fixture: a browser wakes, the
    // stale-probe watchdog severs the socket an attach is riding, and a second
    // socket replaces it — all before any snapshot arrived.
    const h = harness();
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 5_000 })
      .toBe("open");

    const onRetry = vi.fn();
    const failures: unknown[] = [];
    const fiber = Effect.runFork(
      Stream.runDrain(
        fenceStream(link.dispatch.stream(TICKS_TAG, undefined), { onRetry }),
      ).pipe(
        Effect.tapError((e) => Effect.sync(() => failures.push(e))),
        Effect.ignore,
      ),
    );

    // The subscription is on the FIRST wire.
    await expect
      .poll(() => first.sent.length, { timeout: 5_000 })
      .toBeGreaterThan(0);

    // The watchdog's recovery action, on a socket that is still OPEN.
    link.wire.forceReconnect();
    expect(first.readyState).toBe(3);

    // The link re-dials; open the replacement the moment it appears.
    const second = await nthSocket(h.dialled, 2);
    second.open();

    // The whole claim: the fence was TOLD (onRetry), and the subscription is
    // re-established on the new wire.
    await expect
      .poll(() => second.sent.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect(onRetry.mock.calls.length).toBeGreaterThan(0);
    expect(failures).toEqual([]); // retried, never surfaced

    fiber.interruptUnsafe();
    await link.dispose();
  });
});

describe("re-dial law 2 — a pre-open DIAL FAILURE is swallowed, so a registered stream learns nothing", () => {
  it("BETA-ASSUMPTION(rc.112): repeated SocketOpenError re-dials never fail an in-flight stream", async () => {
    // `retryTransientErrors: true` (websocketLink) makes RpcClient's `tapCause`
    // return early for a `SocketOpenError` WITHOUT broadcasting
    // `ClientProtocolError` — and that broadcast is the only thing that fails
    // registered entries. So the protocol re-dials, and re-dials, and the
    // stream neither fails, nor retries, nor delivers: it parks.
    //
    // With that arm off, this same fixture would fail the stream on the first
    // dial failure and the fence would retry — which is exactly the failure
    // signal `reattachingStream`'s first-frame deadline exists BECAUSE there
    // isn't one.
    const h = harness({ dialsFail: true });
    const link = await h.link;

    const onRetry = vi.fn();
    const failures: unknown[] = [];
    const items: string[] = [];
    const fiber = Effect.runFork(
      Stream.runForEach(
        fenceStream(link.dispatch.stream(TICKS_TAG, undefined), { onRetry }),
        (item) => Effect.sync(() => items.push(String(item))),
      ).pipe(
        Effect.tapError((e) => Effect.sync(() => failures.push(e))),
        Effect.ignore,
      ),
    );

    // Let the link fail several dials in a row (backoff starts at 500ms).
    await expect
      .poll(() => h.attempts(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3);

    // Three-plus dial failures, and the stream was told about NONE of them.
    expect(failures).toEqual([]);
    expect(onRetry).not.toHaveBeenCalled();
    expect(items).toEqual([]);
    // And it is still running — parked, not finished. This is the blank pane.
    expect(fiber.pollUnsafe()).toBe(undefined);

    // The subscription really was REGISTERED and waiting the whole time, not
    // merely never made: let one dial succeed and the same request is written
    // to the wire, with the stream never having been failed once. (Without
    // this arm the law above could pass for the wrong reason.)
    h.setDialFails(false);
    const ws = await nthSocket(h.dialled, 1);
    ws.open();
    await expect
      .poll(() => ws.sent.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect(failures).toEqual([]);
    expect(onRetry).not.toHaveBeenCalled();

    fiber.interruptUnsafe();
    await link.dispose();
  });

  it("BETA-ASSUMPTION(rc.112): every swallowed attempt still publishes a connecting → closed pair", async () => {
    // The OBSERVABILITY the fix rests on. `Effect.ensuring(hooks.onDisconnect)`
    // wraps the whole attempt in `RpcClient.makeProtocolSocket`, OUTSIDE the
    // `tapCause` that swallows a `SocketOpenError` — so an attempt whose failure
    // nobody is told about still ends its status. That is what lets
    // `websocketLink` count open EDGES at all, and what makes a swallowed dial
    // RECORDABLE (its dial-history row, the class the field was blind to).
    //
    // If a pin bump moved `onDisconnect` inside the swallow, the epoch would stop
    // advancing on exactly the shape law 3 exists for, and this line is the gate.
    const h = harness({ dialsFail: true });
    const link = await h.link;
    const seen: WireStatus[] = [];
    const unsubscribe = link.wire.onStatus((s) => seen.push(s));

    await expect
      .poll(() => h.attempts(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3);

    // The link starts `connecting`, so the first CHANGE a swallowed attempt can
    // publish is its end. From there it is strictly alternating pairs, forever.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const [index, status] of seen.entries()) {
      expect(status).toBe(index % 2 === 0 ? "closed" : "connecting");
    }
    // Never `open`: not one of these dials ever connected.
    expect(seen).not.toContain("open");

    unsubscribe();
    await link.dispose();
  });
});

/**
 * Law 3 — a run that ends WITHOUT broadcasting orphans everything it carried,
 * and `websocketLink` fails what it orphaned.
 *
 * Law 2 measured the shape at the cold start (a dial that never opened, whose
 * entries park in `Socket.fromWebSocket`'s write LATCH and flush on the next
 * open — a self-healing shape). The FIELD shape is the other half: the request
 * already went out on a socket that then died without a close frame, so there is
 * nothing left to flush and Effect RPC never re-sends a registered entry
 * (`RpcClient.js` writes it once, at registration). That call is orphaned, with
 * no failure anywhere to retry on — a healthy wire over frozen state.
 */
describe("re-dial law 3 — the epoch fails what a re-dial orphaned", () => {
  /** How long to allow for the protocol to notice a socket that died silently:
   *  the pinger writes a ping every 5s and opens its timeout latch on the next
   *  tick that got no pong, so ~10s. It is the ONLY producer of a swallowed run
   *  end on an ESTABLISHED socket, which is why these fixtures pay real seconds
   *  for it rather than simulating one. */
  const PING_TIMEOUT_WINDOW_MS = 25_000;

  it("THE FIELD SHAPE: a silently-dead socket's parked subscription re-drives on the next open, with no server-side action", {
    timeout: 90_000,
  }, async () => {
    const h = servedHarness();
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 5_000 })
      .toBe("open");

    const onRetry = vi.fn();
    const failures: unknown[] = [];
    const items: string[] = [];
    // LABELLED (kolu#2101 J2): the liveness registry is what a client-side
    // diagnostic reads to NAME a parked subscription, and this drive is the real
    // field shape — so the registry's own numbers are asserted below off it,
    // never off a script.
    resetSubscriptionLiveness();
    const fiber = Effect.runFork(
      Stream.runForEach(
        fenceStream(link.dispatch.stream(TICKS_TAG, undefined), {
          onRetry,
          label: "ticks",
        }),
        (item) => Effect.sync(() => items.push(String(item))),
      ).pipe(
        Effect.tapError((e) => Effect.sync(() => failures.push(e))),
        Effect.ignore,
      ),
    );

    // The subscribe went out on socket #1, and socket #1 answered it.
    await expect
      .poll(() => items, { timeout: 10_000 })
      .toEqual(["provisioning"]);
    expect(requestsOn(first, TICKS_TAG)).toBe(1);

    // The lid closes. No close frame, no error event — the socket is `open` at
    // both ends and simply carries nothing.
    h.cut(1);
    // The server converges while nobody is listening. This is the ONLY
    // server-side action in the whole test, and it happens BEFORE the wire
    // comes back — see the assertion at the end.
    h.setState("connected");

    // ~10s later the pinger's timeout ends the run with a `SocketOpenError`,
    // which `retryTransientErrors` swallows: no `ClientProtocolError`, so
    // nothing fails the registered entry. The schedule re-dials.
    const second = await nthSocket(h.dialled, 2, PING_TIMEOUT_WINDOW_MS);
    const secondOpenedAt = Date.now();
    second.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 10_000 })
      .toBe("open");

    // The whole claim: exactly ONE re-subscribe lands on the new socket, and it
    // renders the state the server has held all along.
    await expect
      .poll(() => items, { timeout: 10_000 })
      .toEqual(["provisioning", "connected"]);
    expect(requestsOn(second, TICKS_TAG)).toBe(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]); // retried, never surfaced
    expect(fiber.pollUnsafe()).toBe(undefined); // still live, now on the new wire

    // The reviewer's post-script, as an assertion: a hard reload connected the
    // stuck tab instantly, which proves the server was publishing truth the
    // whole time. Nothing was pushed, re-served or reconverged after the wire
    // returned — the fresh subscribe alone rendered it.
    expect(
      h.serverWrites().filter((write) => write.at > secondOpenedAt),
    ).toEqual([]);

    // ── The registry's view of the same drive (kolu#2101 J2) ───────────────
    // What a copy-pasted client diagnostic says about this subscription AFTER
    // the re-drive. The park's signature is a `lastFrameAt` OLDER than the wire's
    // current open-since; post-J1 the re-drive stamps a fresher one, and that
    // comparison — the parked verdict, computed at snapshot time — is what lets
    // the snapshot prove (or clear) the incident from the client alone.
    const ticks = subscriptionLiveness().find((r) => r.label === "ticks");
    expect(ticks?.state).toBe("live");
    expect(ticks?.framesReceived).toBe(2);
    expect(ticks?.retries).toBe(1);
    expect(ticks?.subscribedAt).toBeLessThan(secondOpenedAt);
    // NOT parked: the last frame landed after the CURRENT socket opened.
    expect(ticks?.lastFrameAt ?? 0).toBeGreaterThanOrEqual(secondOpenedAt);

    fiber.interruptUnsafe();
    await link.dispose();
    await h.dispose();
  });

  it("law 1 still coalesces to ONE re-drive: a force-cycle does not double-subscribe", async () => {
    // The failure mode the epoch rule could have introduced: a live socket
    // CLOSING already fails the stream (law 1) and the fence re-subscribes, and
    // the reopen edge must not fail that fresh subscription too. It cannot,
    // structurally — the failed attempt's guard is deregistered with the attempt,
    // and the fence's re-subscribe binds to the current (or next) epoch — but
    // "structurally" is a claim, so it is counted.
    const h = harness();
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 5_000 })
      .toBe("open");

    const onRetry = vi.fn();
    const fiber = Effect.runFork(
      Stream.runDrain(
        fenceStream(link.dispatch.stream(TICKS_TAG, undefined), { onRetry }),
      ).pipe(Effect.ignore),
    );
    await expect
      .poll(() => requestsOn(first, TICKS_TAG), { timeout: 5_000 })
      .toBe(1);

    link.wire.forceReconnect();
    const second = await nthSocket(h.dialled, 2);
    second.open();

    await expect
      .poll(() => requestsOn(second, TICKS_TAG), { timeout: 10_000 })
      .toBe(1);
    // Hold past a second fence cycle (1s) — a double-drive would land here.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(requestsOn(second, TICKS_TAG)).toBe(1);
    expect(onRetry).toHaveBeenCalledTimes(1);

    fiber.interruptUnsafe();
    await link.dispose();
  });

  it("a COLD START is not epoch-failed: a stream begun while the wire is down subscribes exactly once", async () => {
    // Law 2's own fixture, read as a non-regression. A stream that starts while
    // the wire is down parks in the socket's write LATCH, which flushes on the
    // next open — so it BELONGS to that socket and self-heals. The binding rule
    // (`open ? epoch : epoch + 1`) exists for exactly this: the arriving open is
    // the stream's own, not a supersession, and must not fail it.
    const h = harness({ dialsFail: true });
    const link = await h.link;

    const onRetry = vi.fn();
    const failures: unknown[] = [];
    const fiber = Effect.runFork(
      Stream.runDrain(
        fenceStream(link.dispatch.stream(TICKS_TAG, undefined), { onRetry }),
      ).pipe(
        Effect.tapError((e) => Effect.sync(() => failures.push(e))),
        Effect.ignore,
      ),
    );

    await expect
      .poll(() => h.attempts(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3);
    h.setDialFails(false);
    const ws = await nthSocket(h.dialled, 1);
    ws.open();

    await expect
      .poll(() => requestsOn(ws, TICKS_TAG), { timeout: 10_000 })
      .toBe(1);
    // Past a fence cycle: an epoch rule that failed it would show a second one.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(requestsOn(ws, TICKS_TAG)).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
    expect(fiber.pollUnsafe()).toBe(undefined);

    fiber.interruptUnsafe();
    await link.dispose();
  });

  it("an in-flight UNARY orphaned by the same cycle fails loudly instead of parking forever", {
    timeout: 90_000,
  }, async () => {
    // A reconnect orphans every in-flight unary BY CONSTRUCTION: the answer can
    // only travel the socket the request went out on, and nothing re-sends it.
    // Un-failed, the call's promise never settles — a `runAction` that never
    // reports, a `catch` arm that never runs, a spinner with no end.
    const h = harness();
    const link = await h.link;
    const first = await nthSocket(h.dialled, 1);
    first.open();
    await expect
      .poll(() => link.wire.status(), { timeout: 5_000 })
      .toBe("open");

    let settled: { ok: boolean; value: unknown } | undefined;
    const call = Effect.runPromise(
      link.dispatch.unary(ASK_TAG, undefined),
    ).then(
      (value) => {
        settled = { ok: true, value };
      },
      (error) => {
        settled = { ok: false, value: error };
      },
    );

    // The request is on socket #1. Nothing will ever answer it: this socket has
    // no peer, so the pinger gets no pong either.
    await expect
      .poll(() => requestsOn(first, ASK_TAG), { timeout: 5_000 })
      .toBe(1);
    expect(settled).toBe(undefined);

    // ~10s: the ping timeout ends the run with a swallowed `SocketOpenError`.
    const second = await nthSocket(h.dialled, 2, PING_TIMEOUT_WINDOW_MS);
    // Nothing has failed the call — the swallow is the whole point.
    expect(settled).toBe(undefined);
    expect(requestsOn(second, ASK_TAG)).toBe(0);
    second.open();

    await expect.poll(() => settled, { timeout: 10_000 }).toBeDefined();
    expect(settled?.ok).toBe(false);
    const error = settled?.value as { _tag?: string; message?: string };
    // The shape `client.ts`'s fence matches structurally, and a message that
    // names the cycle rather than mumbling about a socket.
    expect(error._tag).toBe("RpcClientError");
    expect(error.message).toContain("re-dialled beneath this call");
    expect(error.message).toContain("epoch 1");
    expect(error.message).toContain("epoch 2");

    await call;
    await link.dispose();
  });
});
