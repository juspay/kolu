/**
 * Session-level pins for #1908 R6b (abort-in-flight) and R8b (the pre-connected
 * liveness backstop) — the server-side capability PR2's card verb rides.
 *
 *  - recheck() during an IN-FLIGHT dial aborts that dial (its `ctx.signal` fires) and
 *    launches a fresh dial NOW, with no backoff wait (R6b/C4). The documented no-op
 *    this fixes: `recheck()` used to return silently while a dial was in flight.
 *  - the pre-connected backstop cycles a dial that goes fully SILENT (no progress line,
 *    no phase advance, never connected) past its bound — the seam the per-child
 *    lifetime policies can't reach (a wedge in `resolveDrvPath`), which would have
 *    caught the incident on its own (R8b).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "./loggerStubs.testutil";
import {
  type ConnectContext,
  ConnectError,
  type Connection,
  makeSession,
} from "./session";
import type { SshProv } from "./sshConnector";

/** A connector that hangs each dial until its `ctx.signal` aborts (then rejects, as a
 *  provisioning child group-killed by the abort makes `provisionAgent` do). Records
 *  every dial's signal so the test can assert the abort fired. */
function hangingConnector() {
  const signals: AbortSignal[] = [];
  let dials = 0;
  const connectOnce = (
    ctx: ConnectContext<SshProv>,
  ): Promise<Connection<unknown>> => {
    dials += 1;
    signals.push(ctx.signal);
    return new Promise((_res, reject) => {
      ctx.signal.addEventListener("abort", () =>
        reject(new ConnectError("aborted in-flight", "network")),
      );
    });
  };
  return {
    connectOnce,
    dials: () => dials,
    firstSignal: () => signals[0],
  };
}

const flush = () => Promise.resolve();

describe("#1908 R6b — recheck aborts an in-flight dial and redials now", () => {
  it("aborts the wedged dial's signal and starts a fresh dial with no backoff", async () => {
    const h = hangingConnector();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      log: silentLogger,
    });
    session.pin().catch(() => {});
    await flush();
    expect(h.dials()).toBe(1);
    const first = h.firstSignal();
    expect(first?.aborted).toBe(false);

    // A dial is in flight (probing, clientPromise pending, no live connection, no
    // backoff timer) — the case that used to no-op.
    session.recheck();
    await flush();

    expect(first?.aborted).toBe(true); // the wedged dial was aborted…
    expect(h.dials()).toBe(2); // …and a fresh dial started NOW (no backoff advanced)
    session.destroy();
  });

  it("a superseded dial tears down a LATE-resolved connection instead of adopting it (no orphan)", async () => {
    // The arch-gate finding: the epoch guard covered only the reject path, so a dial that
    // RESOLVED after being superseded (its provision finished / admit hello landed just as
    // recheck fired) would `setCurrent` and clobber the fresh dial's connection, orphaning
    // this one's ssh child.
    let resolveDial1: ((c: Connection<unknown>) => void) | undefined;
    let dials = 0;
    const teardown = vi.fn();
    const connectOnce = (): Promise<Connection<unknown>> => {
      dials += 1;
      if (dials === 1)
        return new Promise((res) => {
          resolveDial1 = res;
        });
      return new Promise(() => {}); // dial 2 hangs (in flight)
    };
    const session = makeSession<unknown, SshProv>({
      connectOnce,
      initialConnection: "probing",
      liveness: false,
      log: silentLogger,
    });
    session.pin().catch(() => {});
    await flush();
    expect(dials).toBe(1);

    // Supersede dial 1: recheck aborts it and launches dial 2.
    session.recheck();
    await flush();
    expect(dials).toBe(2);

    // NOW dial 1's connectOnce resolves LATE with a live connection.
    resolveDial1?.({
      client: {},
      closed: new Promise(() => {}),
      isAlive: () => Promise.resolve(),
      teardown,
    });
    await flush();

    // The superseded dial tore its connection down instead of adopting it, and the
    // session did not connect through it (still coming up on dial 2).
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(session.currentState().phase).toBe("probing");
    session.destroy();
  });
});

describe("#1908 R8b — the pre-connected liveness backstop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cycles a silent wedged dial past its bound (the resolveDrvPath-wedge seam)", async () => {
    const h = hangingConnector();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      preConnectedLivenessMs: 1000,
      reconnectDelayMs: 5,
      log: silentLogger,
    });
    session.pin().catch(() => {});
    await flush();
    expect(h.dials()).toBe(1);

    // No progress line, no phase advance, never connected — the backstop fires at its
    // bound and cycles the attempt (abort → redial).
    await vi.advanceTimersByTimeAsync(1100);
    await flush();
    expect(h.firstSignal()?.aborted).toBe(true);
    expect(h.dials()).toBeGreaterThanOrEqual(2);
    session.destroy();
  });

  it("does NOT cycle a dial that keeps emitting progress lines (liveness, not a deadline)", async () => {
    let ctx: ConnectContext<SshProv> | undefined;
    const session = makeSession<unknown, SshProv>({
      connectOnce: (c) => {
        ctx = c;
        return new Promise(() => {}); // hang, but we feed it progress
      },
      initialConnection: "probing",
      liveness: false,
      preConnectedLivenessMs: 1000,
      log: silentLogger,
    });
    session.pin().catch(() => {});
    await flush();

    // Emit a progress line every 400ms for ~2s — always under the 1000ms bound.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(400);
      ctx?.localProgress(`still copying path ${i}`);
    }
    // Still the SAME first dial — a chatty (healthy-but-slow) provision was never cycled.
    expect(session.currentState().phase).toBe("probing");
    session.destroy();
  });
});
