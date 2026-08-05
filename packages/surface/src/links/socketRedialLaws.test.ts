/**
 * WHICH re-dials a registered stream is told about — the two laws kolu#2101 H3
 * rests on, measured rather than assumed.
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
 * The second law is why `reattachingStream.ts` needs a FIRST-FRAME DEADLINE at
 * all: there is no failure to retry on, so silence is the only signal left. It
 * is the measuring law for that module's `BETA-ASSUMPTION(beta.103)` marker —
 * bump the pin, re-run this file, re-stamp.
 */

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { fenceStream } from "../client";
import { defineSurface } from "../define";
import { websocketLink } from "./websocket";

const surface = defineSurface({
  streams: { ticks: { inputSchema: Schema.Void, outputSchema: Schema.String } },
});
const TICKS_TAG = "surface/ticks/get";

/** Enough of the `WebSocket` API for `Socket.fromWebSocket`. Nothing answers:
 *  no law here is about a response, only about which failures reach a
 *  registered entry. */
class FakeWebSocket extends EventTarget {
  readyState = 0; // CONNECTING
  readonly sent: (string | Uint8Array)[] = [];
  constructor(readonly url: string) {
    super();
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  open(): void {
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
  }
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

/** The dial runs on the protocol's own fiber. */
async function nthSocket(
  dialled: FakeWebSocket[],
  n: number,
): Promise<FakeWebSocket> {
  await expect
    .poll(() => dialled.length, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(n);
  const ws = dialled[n - 1];
  if (ws === undefined) throw new Error(`no socket #${n}`);
  return ws;
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
  it("BETA-ASSUMPTION(beta.103): repeated SocketOpenError re-dials never fail an in-flight stream", async () => {
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
});
