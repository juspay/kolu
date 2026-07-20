/**
 * `Session.currentState()` — the honest synchronous liveness point-read (LIVE-FIX).
 *
 * The point-read twin of `onState`, pinned here against a REAL `makeSession`. Its
 * contract: it returns the FRESHEST cell truth at every read instant, so a reader
 * gated on `currentState().phase === "connected"` is honest where a reader gated on
 * `currentClient() !== null` is not.
 *
 * The regression it retires (SR8.a's `captureLatest`): `currentClient()` means
 * "dialing-or-connected" — non-null while merely `connecting`, AND (because
 * `scheduleReconnect` RETAINS the rejected dial across the backoff wait) non-null
 * through entire reconnect backoff windows. A poll read gated on it republished the
 * mirror's held stale reading the whole time. `captureLatest` snapshotting it at
 * `onState` did NOT fix this — `onState` delivery is itself microtask-deferred (a
 * fire-and-forget `for await` per subscriber, `@kolu/surface` `buildConsume`), so the
 * snapshot captured the post-assignment truthy pointer too; its apparent guarantee was
 * an accident of relative microtask ordering. Reading `currentState().phase` closes it
 * for good.
 *
 * FRESHNESS BY DESIGN (pinned below): one synchronous frame can drive two transitions
 * (`disconnected` → give-up `failed`), and delivery is deferred — so a listener
 * delivered the `disconnected` frame reads `failed` from `currentState()` at the same
 * turn. `currentState()` always returns the freshest cell truth, never the frame that
 * woke the reader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "./loggerStubs.testutil";
import {
  type ClosedInfo,
  ConnectError,
  type Connection,
  type Connector,
  makeSession,
} from "./session";

/** A minimal surface-shaped client: answers the reserved `system.identity` /
 *  `system.clockNow` so `enterConnected`'s probes don't reject noisily. */
type FakeClient = {
  surface: {
    system: {
      identity: () => Promise<{ kind: string }>;
      clockNow: () => Promise<{ epochMs: number }>;
    };
  };
};

const fakeClient = (): FakeClient => ({
  surface: {
    system: {
      identity: () => Promise.resolve({ kind: "anonymous" }),
      clockNow: () => Promise.resolve({ epochMs: 0 }),
    },
  },
});

/** Dials once and hands back a live connection; the session stays `connecting`
 *  until the consumer calls `markConnected()` (no admit path here). */
function liveConnector(client: FakeClient): Connector<FakeClient, never> {
  return async (ctx): Promise<Connection<FakeClient>> => {
    let resolveClosed: (info: ClosedInfo) => void = () => {};
    const closed = new Promise<ClosedInfo>((r) => {
      resolveClosed = r;
    });
    ctx.connecting();
    return {
      client,
      closed,
      isAlive: () => Promise.resolve(),
      teardown: () => resolveClosed({ kind: "exit", code: 0, signal: null }),
    };
  };
}

/** A dial that always REJECTS with a `remote` ConnectError — a reachable host that
 *  refuses, so the loop backs off and (after MAX_CONSECUTIVE_FAILURES=5) gives up. */
const refusingConnector = (): Connector<FakeClient, never> => async () => {
  throw new ConnectError("dial refused (test)", "remote");
};

/** Flush a handful of microtasks so a settled/rejected dial's synchronous handlers run. */
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** Build a fake session with the shared test options — each test varies only the connector. */
const mk = (connectOnce: Connector<FakeClient, never>) =>
  makeSession<FakeClient, never>({
    connectOnce,
    initialConnection: "connecting",
    reconnectDelayMs: 1000,
    liveness: false,
    label: "h",
    log: silentLogger,
  });

describe("Session.currentState() — the honest liveness point-read (LIVE-FIX)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("is honest during dialing (phase 'connecting') while currentClient() is non-null; flips to 'connected' only at markConnected", async () => {
    const session = mk(liveConnector(fakeClient()));
    session.pin().catch(() => {});
    // Synchronously after pin(): attempt() ran setUp("connecting") and assigned clientPromise.
    expect(session.currentClient()).not.toBeNull();
    expect(session.currentState().phase).toBe("connecting");
    await flush();
    // Still merely connecting — the far end isn't live until the consumer signals it.
    expect(session.currentState().phase).toBe("connecting");
    expect(session.currentClient()).not.toBeNull();
    session.markConnected();
    expect(session.currentState().phase).toBe("connected");
    session.destroy();
  });

  it("through a reconnect BACKOFF, currentClient() stays non-null (retained rejected dial) but currentState().phase is honestly down — the window the old currentClient()!==null gate leaked through", async () => {
    const session = mk(refusingConnector());
    session.pin().catch(() => {});
    await flush(); // first dial rejects → setDown("disconnected") + scheduleReconnect(backoff)
    // The retained rejected clientPromise keeps currentClient() truthy through the backoff wait…
    expect(session.currentClient()).not.toBeNull();
    // …but the honest phase is down. (Pin: never regress the gate to currentClient()!==null.)
    expect(session.currentState().phase).toBe("disconnected");
    expect(session.currentState().phase).not.toBe("connected");
    session.destroy();
  });

  it("give-up drives disconnected→failed in ONE frame; a listener delivered 'disconnected' reads currentState().phase === 'failed' (freshness by design)", async () => {
    const session = mk(refusingConnector());
    let sawFailedWhileDeliveredDisconnected = false;
    session.onState((s) => {
      // At the microtask this delivers the 'disconnected' frame, the cell has ALREADY
      // advanced to 'failed' (both setDown()s ran in the give-up's synchronous frame).
      if (
        s.phase === "disconnected" &&
        session.currentState().phase === "failed"
      ) {
        sawFailedWhileDeliveredDisconnected = true;
      }
    });
    session.pin().catch(() => {});
    // Advance through all 5 remote-cause backoff cycles (1+2+4+8s of timers) to the give-up.
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(60_000);
    expect(session.currentState().phase).toBe("failed");
    expect(sawFailedWhileDeliveredDisconnected).toBe(true);
    session.destroy();
  });
});
