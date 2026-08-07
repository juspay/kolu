/**
 * F4 regression — the `system.clockNow` offset probe must be BOUNDED and
 * CANCELLABLE. A clock RPC that never settles must not (a) hang silent (no
 * diagnostic, no retry), nor (b) leave a permanently-pending request stacked
 * behind each cadence retry, nor (c) outlive `destroy()` as an orphaned timer /
 * in-flight request.
 *
 * Drives `makeSession` through a hand-built connector whose client answers the
 * reserved `system.identity` normally but whose `system.clockNow` NEVER settles
 * (recording whether the effect it handed back was INTERRUPTED). That lets the
 * test assert the deadline fires the loud diagnostic, cancels the underlying
 * request BEFORE the retry, fires a fresh request on the retry cadence, and — on
 * `destroy()` — cancels the in-flight request and leaves no active timer behind.
 *
 * The cancellation mechanism is INTERRUPTION, not an `AbortSignal` the member
 * call was handed: a unary member call is an `Effect`, the session runs it under
 * the probe’s own `AbortController` (`runProbe`), and `Effect.runPromise` turns
 * that abort into an interrupt. So the fake records its own finalizer running —
 * which is strictly stronger evidence than a flag on a signal a plug was free to
 * ignore.
 */
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectLogger } from "@kolu/log/loggerStubs.testutil";
import type { ClosedInfo, Connection, Connector } from "./session";
import { makeSession } from "./session";

/** A minimal client shaped like a surface client: it answers the reserved
 *  `system.identity` (so `pollIdentity` lands) and `system.clockNow`. */
type FakeClient = {
  surface: {
    system: {
      identity: (
        input: Record<string, never>,
      ) => Effect.Effect<{ kind: string }, never>;
      clockNow: (
        input: Record<string, never>,
      ) => Effect.Effect<{ epochMs: number }, never>;
    };
  };
};

/** One `clockNow` call: whether the effect it returned has been cancelled yet. */
type ClockCall = { cancelled: boolean };

/** Records each `clockNow` call; the effect NEVER succeeds, so only the deadline
 *  (which interrupts it) can end a probe. `Effect.callback`’s returned finalizer
 *  runs on interruption, which is how the call learns it was cancelled — the
 *  successor of the old "did the signal we were handed get aborted?" check. */
function neverSettlingClock() {
  const calls: ClockCall[] = [];
  const clockNow = (): Effect.Effect<{ epochMs: number }, never> =>
    Effect.callback<{ epochMs: number }, never>(() => {
      const call: ClockCall = { cancelled: false };
      calls.push(call);
      // Never resumed — the deadline’s interrupt is the only way out.
      return Effect.sync(() => {
        call.cancelled = true;
      });
    });
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
          identity: () => Effect.succeed({ kind: "anonymous" }),
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
      log: collectLogger((l) => lines.push(l)),
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
    expect(calls[0]?.cancelled).toBe(false);
    // No diagnostic yet — the probe has not hit its deadline.
    expect(lines.some((l) => l.includes("clock offset probe failed"))).toBe(
      false,
    );

    // Advance past the 8s probe deadline: the deadline rejects the observed
    // promise (loud line) AND interrupts the underlying request (cancelled
    // before retry).
    await vi.advanceTimersByTimeAsync(8_000);
    expect(lines.some((l) => l.includes("clock offset probe failed"))).toBe(
      true,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cancelled).toBe(true);

    // Advance the 10s retry cadence: a FRESH request fires (the prior one was
    // cancelled, not stacked).
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.cancelled).toBe(false);

    // Destroy mid-probe: it interrupts the in-flight request and clears the
    // deadline timer — nothing is left pending.
    session.destroy();
    expect(calls[1]?.cancelled).toBe(true);
    // No orphaned deadline/retry timer survives the teardown.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a STRUCTURALLY-absent system.clockNow (an old peer) STOPS probing — no cadence retry, logged at debug (not error)", async () => {
    // A client whose contract PREDATES the reserved member: `system.identity` answers, but
    // `system.clockNow` is absent. `probeSurfaceClockNow` throws a TYPED
    // `ClockNowUnavailableError` (structural navigation, NOT a string-matched `TypeError`),
    // so `pollClockNow` classifies it permanent-absent: emit ONCE at `debug` (the "tool not
    // installed" analogue, not a fault), leave the honest `null`, and STOP — never polling a
    // member that can never answer every 10s forever. The link STAYS connected (readiness is
    // link-liveness). This pins the branch the fragile message-heuristic left untested.
    const clientNoClock = {
      surface: {
        system: { identity: () => Effect.succeed({ kind: "anonymous" }) },
      },
    } as unknown as FakeClient;

    const logs: Array<{ line: string; severity?: string }> = [];
    const at =
      (severity: string) =>
      (obj: Record<string, unknown>): void => {
        logs.push({ line: String(obj.line), severity });
      };
    const session = makeSession<FakeClient, never>({
      connectOnce: fakeConnector(clientNoClock),
      initialConnection: "connecting",
      reconnectDelayMs: 1000,
      liveness: false,
      label: "oldpeer",
      // The session routes severities internally — the logger's LEVEL is the
      // severity assertion now (expected-absent → debug, never error).
      log: {
        debug: at("debug"),
        info: at("info"),
        warn: at("warn"),
        error: at("error"),
      },
    });

    let phase = "";
    session.onState((s) => {
      phase = s.phase;
    });

    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    session.markConnected();
    await vi.advanceTimersByTimeAsync(1);

    // Connected despite no offset — readiness is link-liveness, not clock-measured.
    expect(phase).toBe("connected");
    const absent = logs.filter((l) =>
      l.line.includes("system.clockNow absent on this dial"),
    );
    expect(absent).toHaveLength(1);
    expect(absent[0]?.severity).toBe("debug"); // expected-absent → debug, never error

    // No retry cadence for a permanent-absent member: advancing well past the 10s cadence
    // fires NO further absent line (the probe stopped, it does not poll forever).
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      logs.filter((l) =>
        l.line.includes("system.clockNow absent on this dial"),
      ),
    ).toHaveLength(1);

    session.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
