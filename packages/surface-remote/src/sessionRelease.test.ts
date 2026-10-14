/**
 * `pin()` / `release()`, and the `absent` arm — the two things that let a
 * session front an OPTIONAL neighbour.
 *
 * A session used to be born pinned for the life of its parent and torn down only
 * by `destroy()`, which is terminal. That is right for a link whose whole purpose
 * is to be up (a host's padi), and wrong for one nobody may be looking at: the
 * only way to stop dialling was to throw the session away, and the only way to
 * start again was to build a new one.
 *
 * So the two claims pinned here are the ones a consumer would otherwise have to
 * discover:
 *
 *   - a release LETS THE LINK GO after the grace, and a later pin RE-ARMS the
 *     same session (a fresh dial, not a resurrection); a pin WITHIN the grace
 *     keeps the link that was already open, which is what makes a re-keying
 *     subscriber free;
 *   - an ABSENT endpoint is a steady state: it never ages into the terminal
 *     `failed` the give-up ledger produces for a host that keeps refusing, and
 *     it reports itself as its own arm rather than as a down link.
 */

import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ClosedInfo,
  ConnectError,
  type Connection,
  type Connector,
  EndpointAbsentError,
  makeSession,
  RELEASE_GRACE_MS,
  type SessionState,
} from "./session";

/** A minimal surface-shaped client: answers the reserved probes so
 *  `enterConnected` has nothing to complain about. */
type FakeClient = {
  surface: {
    system: {
      identity: () => Effect.Effect<{ kind: string }, never>;
      clockNow: () => Effect.Effect<{ epochMs: number }, never>;
    };
  };
};

const fakeClient = (): FakeClient => ({
  surface: {
    system: {
      identity: () => Effect.succeed({ kind: "anonymous" }),
      clockNow: () => Effect.succeed({ epochMs: 0 }),
    },
  },
});

interface Dials {
  connector: Connector<FakeClient, never>;
  /** How many times the connector was asked for a link. */
  count: () => number;
  /** How many of those links were torn down. */
  tornDown: () => number;
}

/** A connector that counts dials and teardowns — the two facts every claim here
 *  is about. */
function countingConnector(): Dials {
  let count = 0;
  let tornDown = 0;
  return {
    count: () => count,
    tornDown: () => tornDown,
    connector: async (ctx): Promise<Connection<FakeClient>> => {
      count += 1;
      let resolveClosed: (info: ClosedInfo) => void = () => {};
      const closed = new Promise<ClosedInfo>((r) => {
        resolveClosed = r;
      });
      ctx.connecting();
      return {
        client: fakeClient(),
        closed,
        isAlive: () => Promise.resolve(),
        teardown: () => {
          tornDown += 1;
          resolveClosed({ kind: "endpoint-down" });
        },
      };
    },
  };
}

/** Flush a handful of microtasks so a settled dial's synchronous handlers run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const mk = (connectOnce: Connector<FakeClient, never>) =>
  makeSession<FakeClient, never>({
    connectOnce,
    initialConnection: "connecting",
    reconnectDelayMs: 1000,
    liveness: false,
    label: "h",
    log: silentLogger,
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pin / release", () => {
  it("does not dial until something pins", async () => {
    const dials = countingConnector();
    const session = mk(dials.connector);
    await flush();
    // The session exists, and nothing has been asked of the far end.
    expect(dials.count()).toBe(0);

    await session.pin();
    await flush();
    expect(dials.count()).toBe(1);
    session.destroy();
  });

  it("dials ONCE for many pins, and holds the link until the last release", async () => {
    const dials = countingConnector();
    const session = mk(dials.connector);
    await Promise.all([session.pin(), session.pin(), session.pin()]);
    await flush();
    session.markConnected();
    expect(dials.count()).toBe(1);

    session.release();
    session.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS * 2);
    await flush();
    // Still one holder: nothing was let go.
    expect(dials.tornDown()).toBe(0);
    session.destroy();
  });

  it("lets the link go after the grace, and re-arms on the next pin", async () => {
    const dials = countingConnector();
    const session = mk(dials.connector);
    await session.pin();
    await flush();
    session.markConnected();
    expect(session.currentState().phase).toBe("connected");

    session.release();
    // WITHIN the grace the link is still up — the whole point of the window.
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS - 1);
    await flush();
    expect(dials.tornDown()).toBe(0);

    await vi.advanceTimersByTimeAsync(2);
    await flush();
    expect(dials.tornDown()).toBe(1);
    // DORMANT, not destroyed.
    expect(session.isDestroyed()).toBe(false);

    await session.pin();
    await flush();
    expect(dials.count()).toBe(2);
    session.destroy();
  });

  it("keeps the open link when a pin lands inside the grace", async () => {
    const dials = countingConnector();
    const session = mk(dials.connector);
    await session.pin();
    await flush();
    session.markConnected();

    session.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS / 2);
    // A subscriber that re-keyed: gone and back inside one window.
    await session.pin();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS * 2);
    await flush();

    expect(dials.tornDown()).toBe(0);
    expect(dials.count()).toBe(1);
    expect(session.currentState().phase).toBe("connected");
    session.destroy();
  });

  it("supersedes a dial still in flight when the grace expires", async () => {
    // A connector that is PAST its own abort point: it ignores the signal and
    // resolves when the test says so. Real ones exist — an admit hello already
    // on the wire, a provisioning step with no cancellation point left.
    const landing: { resolve: (() => void) | null } = { resolve: null };
    let tornDown = 0;
    const session = mk(async (ctx): Promise<Connection<FakeClient>> => {
      ctx.connecting();
      await new Promise<void>((resolve) => {
        landing.resolve = resolve;
      });
      return {
        client: fakeClient(),
        closed: new Promise<ClosedInfo>(() => {}),
        isAlive: () => Promise.resolve(),
        teardown: () => {
          tornDown += 1;
        },
      };
    });

    const pinned = session.pin();
    // The pin is never awaited to completion: the dial is still in flight when
    // the only subscriber leaves, which is the whole case.
    pinned.catch(() => {});
    await flush();
    session.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 1);
    await flush();

    landing.resolve?.();
    await flush();

    // Adopted, it would sit `connected` with zero pins and a grace that has
    // already fired — nothing would ever let it go. Superseded, its connection
    // is torn down and the session stays dormant.
    expect(tornDown).toBe(1);
    expect(session.currentState().phase).not.toBe("connected");
    session.destroy();
  });
});

describe("the absent arm", () => {
  it("reports absence as its own state, and never gives up on it", async () => {
    const seen: SessionState<never>["phase"][] = [];
    const session = makeSession<FakeClient, never>({
      connectOnce: async () => {
        throw new EndpointAbsentError("nothing is serving /run/odu.sock");
      },
      initialConnection: "connecting",
      reconnectDelayMs: 1000,
      liveness: false,
      label: "odu",
      log: silentLogger,
    });
    session.onState((s) => seen.push(s.phase));
    session.pin().catch(() => {});
    await flush();

    expect(session.currentState().phase).toBe("absent");

    // Far past the give-up ceiling a REFUSING host would have reached (five
    // consecutive remote failures): an absence is not a failure, so it never
    // becomes terminal and the loop keeps quietly probing.
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      await flush();
    }
    expect(session.currentState().phase).toBe("absent");
    expect(seen).not.toContain("failed");
    session.destroy();
  });

  it("connects when the endpoint appears, and goes absent again when it leaves", async () => {
    let serving = false;
    /** The live link's own teardown, held on an object so the test can reach it
     *  — a bare `let` assigned inside the connector reads as `never` to the
     *  compiler, which cannot see the callback run. */
    const live: { stop: (() => void) | null } = { stop: null };
    const session = makeSession<FakeClient, never>({
      connectOnce: async (ctx): Promise<Connection<FakeClient>> => {
        if (!serving) throw new EndpointAbsentError("nothing is serving");
        let resolveClosed: (info: ClosedInfo) => void = () => {};
        const closed = new Promise<ClosedInfo>((r) => {
          resolveClosed = r;
        });
        ctx.connecting();
        live.stop = () => resolveClosed({ kind: "endpoint-down" });
        return {
          client: fakeClient(),
          closed,
          isAlive: () => Promise.resolve(),
          teardown: () => resolveClosed({ kind: "endpoint-down" }),
        };
      },
      initialConnection: "connecting",
      reconnectDelayMs: 1000,
      liveness: false,
      label: "odu",
      log: silentLogger,
    });
    session.pin().catch(() => {});
    await flush();
    expect(session.currentState().phase).toBe("absent");

    // The daemon starts. The absent loop's next probe finds it.
    serving = true;
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    session.markConnected();
    expect(session.currentState().phase).toBe("connected");

    // …and is stopped: the link dies, the redial finds nothing, and the session
    // is back in the arm that renders as nothing rather than as a fault.
    serving = false;
    live.stop?.();
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    await flush();
    expect(session.currentState().phase).toBe("absent");
    session.destroy();
  });

  it("still fails a REFUSING endpoint — absence is not a catch-all", async () => {
    const session = makeSession<FakeClient, never>({
      connectOnce: async () => {
        throw new ConnectError("the daemon refused this build", "remote");
      },
      initialConnection: "connecting",
      reconnectDelayMs: 1,
      liveness: false,
      label: "odu",
      log: silentLogger,
    });
    session.pin().catch(() => {});
    await flush();
    for (let i = 0; i < 8; i += 1) {
      await vi.advanceTimersByTimeAsync(70_000);
      await flush();
    }
    expect(session.currentState().phase).toBe("failed");
    session.destroy();
  });
});
