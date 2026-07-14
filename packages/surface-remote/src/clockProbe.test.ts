/**
 * F4 regression — the `system.clockNow` offset probe must be BOUNDED and
 * CANCELLABLE. A clock RPC that never settles must not (a) hang silent (no
 * diagnostic, no retry), nor (b) leave a permanently-pending request stacked
 * behind each cadence retry, nor (c) outlive `destroy()` as an orphaned timer /
 * in-flight request.
 *
 * Drives `makeSession` through a hand-built connector whose client answers the
 * reserved `system.identity` normally but whose `system.clockNow` NEVER resolves
 * (recording the abort `signal` it was handed). That lets the test assert the
 * deadline fires the loud diagnostic, aborts the underlying request BEFORE the
 * retry, fires a fresh request on the retry cadence, and — on `destroy()` — aborts
 * the in-flight request and leaves no active timer behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClosedInfo, Connection, Connector } from "./session";
import { makeSession } from "./session";

/** A minimal client shaped like a surface client: it answers the reserved
 *  `system.identity` (so `pollIdentity` lands) and `system.clockNow`. */
type FakeClient = {
  surface: {
    system: {
      identity: (input: Record<string, never>) => Promise<{ kind: string }>;
      clockNow: (
        input: Record<string, never>,
        opts?: { signal?: AbortSignal },
      ) => Promise<{ epochMs: number }>;
    };
  };
};

/** Records the abort signal handed to each `clockNow` call; the promise NEVER
 *  settles, so only the deadline (or an abort) can end a probe. */
function neverSettlingClock() {
  const calls: Array<{ signal?: AbortSignal }> = [];
  const clockNow = (
    _input: Record<string, never>,
    opts?: { signal?: AbortSignal },
  ): Promise<{ epochMs: number }> => {
    calls.push({ signal: opts?.signal });
    return new Promise<{ epochMs: number }>(() => {
      /* never settles — the deadline / abort is the only way out */
    });
  };
  return { calls, clockNow };
}

/** A connector that dials once and hands back a live connection over the fake
 *  client. `teardown()` routes through `closed` so the loop's machinery runs. */
function fakeConnector(client: FakeClient): Connector<FakeClient, never> {
  return async (ctx): Promise<Connection<FakeClient>> => {
    let resolveClosed: (info: ClosedInfo) => void = () => {};
    const closed = new Promise<ClosedInfo>((resolve) => {
      resolveClosed = resolve;
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

describe("makeSession clock-probe deadline + cancellation (F4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("bounds a never-settling probe: loud diagnostic, aborts before retry, retries on cadence, and destroy cancels the in-flight request", async () => {
    const { calls, clockNow } = neverSettlingClock();
    const client: FakeClient = {
      surface: {
        system: {
          identity: () => Promise.resolve({ kind: "anonymous" }),
          clockNow,
        },
      },
    };

    const lines: string[] = [];
    const session = makeSession<FakeClient, never>({
      connectOnce: fakeConnector(client),
      initialConnection: "connecting",
      reconnectDelayMs: 1000,
      liveness: false,
      label: "clockhost",
      onLog: (line) => lines.push(line),
    });

    let phase = "";
    session.onState((s) => {
      phase = s.phase;
    });

    session.pin().catch(() => {});
    // Let the connector resolve + the client promise settle.
    await vi.advanceTimersByTimeAsync(1);
    // The bridge signals the first successful roundtrip.
    session.markConnected();
    // `pollClockNow` is scheduled in a microtask off the resolved client promise.
    await vi.advanceTimersByTimeAsync(1);

    // The connected frame is up with an unmeasured offset, and one probe is in flight.
    expect(phase).toBe("connected");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal?.aborted).toBe(false);
    // No diagnostic yet — the probe has not hit its deadline.
    expect(lines.some((l) => l.includes("clock offset probe failed"))).toBe(
      false,
    );

    // Advance past the 8s probe deadline: the deadline rejects the observed
    // promise (loud line) AND aborts the underlying request (cancelled before retry).
    await vi.advanceTimersByTimeAsync(8_000);
    expect(lines.some((l) => l.includes("clock offset probe failed"))).toBe(
      true,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal?.aborted).toBe(true);

    // Advance the 10s retry cadence: a FRESH request fires (the prior one was
    // cancelled, not stacked).
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.signal?.aborted).toBe(false);

    // Destroy mid-probe: it aborts the in-flight request and clears the deadline
    // timer — nothing is left pending.
    session.destroy();
    expect(calls[1]?.signal?.aborted).toBe(true);
    // No orphaned deadline/retry timer survives the teardown.
    expect(vi.getTimerCount()).toBe(0);
  });
});
