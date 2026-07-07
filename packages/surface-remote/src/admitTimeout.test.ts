/**
 * Regression for the admit-handshake watchdog (S9 parity).
 *
 * A daemon session's `admit` hook does a control-core `hello()` over the transport.
 * Before this fix, the `admit` branch of `attempt()` returned before the connect
 * watchdog (`armTimer(connectTimeoutMs, …)`) was ever armed, so a WEDGED daemon
 * (process up but its first `hello()` never settles — the exact scenario the non-admit
 * watchdog exists to prevent) hung `pin()` forever AND leaked the connection (`current`
 * was unassigned until the verdict, so `destroy()` couldn't tear it down). Confirmed by
 * code-police fact-check on the ssh/remote-padi arm, the one transport daemon sessions
 * actually use.
 *
 * `withHandshakeTimeout` bounds the admit `await` by the SAME `connectTimeoutMs`, the
 * admit-path twin of the connect watchdog: on timeout it rejects `"network"`, and the
 * admit-catch tears the connection down and reconnects. No real ssh/nix here — a
 * hand-built connector returns a live link whose `admit` never settles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConnectContext, type Connection, makeSession } from "./session";

describe("admit handshake watchdog (S9 parity)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("times out + tears down a wedged admit hello instead of hanging pin() forever", async () => {
    const teardown = vi.fn();
    // A live transport whose link never dies on its own — only `teardown` kills it.
    const connectOnce = (ctx: ConnectContext): Promise<Connection<unknown>> => {
      ctx.connecting();
      return Promise.resolve({
        client: {},
        closed: new Promise<never>(() => {}),
        isAlive: () => Promise.resolve(),
        teardown,
      });
    };
    // The wedge: the control-core hello the admit hook awaits never settles.
    const admit = () => new Promise<never>(() => {});

    const session = makeSession<unknown>({
      connectOnce,
      admit,
      connectTimeoutMs: 5000,
      // Keep the post-timeout reconnect dial out of this test's window.
      reconnectDelayMs: 60_000,
      label: "wedge",
    });

    const outcome = session.pin().then(
      () => "resolved",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );

    // Just before the watchdog fires: still connecting, the child is NOT torn down.
    await vi.advanceTimersByTimeAsync(4999);
    expect(teardown).not.toHaveBeenCalled();

    // At `connectTimeoutMs` the admit handshake times out → reject + teardown, instead
    // of hanging `pin()` forever.
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toMatch(/admit handshake timed out/i);
    expect(teardown).toHaveBeenCalledTimes(1);

    session.destroy();
  });

  it("does NOT arm the watchdog when admit settles promptly (adopt)", async () => {
    const teardown = vi.fn();
    const connectOnce = (ctx: ConnectContext): Promise<Connection<unknown>> => {
      ctx.connecting();
      return Promise.resolve({
        client: {},
        closed: new Promise<never>(() => {}),
        isAlive: () => Promise.resolve(),
        teardown,
      });
    };
    // A healthy daemon: admit adopts immediately.
    const admit = () => Promise.resolve({ kind: "adopt" as const });

    const session = makeSession<unknown>({
      connectOnce,
      admit,
      connectTimeoutMs: 5000,
      reconnectDelayMs: 60_000,
      label: "healthy",
    });

    const client = await session.pin();
    expect(client).toBeDefined();
    // Well past the handshake window: adopt cleared the wedge timer, so no teardown.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(teardown).not.toHaveBeenCalled();

    session.destroy();
  });
});
