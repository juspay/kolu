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
import type { SshProv } from "./sshConnector";

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

    const session = makeSession<unknown, SshProv>({
      initialConnection: "probing",
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

    const session = makeSession<unknown, SshProv>({
      initialConnection: "probing",
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

  it("recheck() recovers a STANDING refuse — held (no auto-reconnect), then a [Reconnect] re-dials + connects once the cause clears (P1)", async () => {
    // srid's live latch, reproduced: a refuse verdict holds the session degraded
    // WITHOUT auto-reconnecting (by design — a persistent skew must not spin). So
    // after the user CLEARS the cause (kills the other kolu / sets the isolation env),
    // nothing re-dials — the host-down card's [Reconnect], backed by recheck() (which
    // force-cycles the HELD `current` connection), is the missing recovery verb. Note
    // reconnect() does NOT work here (its `clientPromise !== null` guard trips on the
    // refuse's settled-rejected client handle) — recheck() is the correct verb.
    let causeCleared = false;
    let dials = 0;
    const connectOnce = (ctx: ConnectContext): Promise<Connection<unknown>> => {
      ctx.connecting();
      dials += 1;
      let resolveClosed!: (i: { kind: "endpoint-down" }) => void;
      const closed = new Promise<{ kind: "endpoint-down" }>((r) => {
        resolveClosed = r;
      });
      return Promise.resolve({
        client: {},
        closed,
        isAlive: () => Promise.resolve(),
        teardown: () => resolveClosed({ kind: "endpoint-down" }),
      });
    };
    // 1st dial REFUSES (a standing cross-supervisor); once the cause clears, it ADOPTS.
    const admit = () =>
      Promise.resolve(
        causeCleared
          ? ({ kind: "adopt" } as const)
          : ({
              kind: "refuse",
              state: {
                error: "another kolu owns this host",
                cause: "remote",
              },
            } as const),
      );

    const states: string[] = [];
    const session = makeSession<unknown, SshProv>({
      initialConnection: "probing",
      connectOnce,
      admit,
      connectTimeoutMs: 5000,
      reconnectDelayMs: 50,
      label: "refuse-recover",
    });
    session.onState((s) => states.push(s.phase));

    const p = session.pin();
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(20);
    expect(states).toContain("disconnected"); // the standing refuse
    expect(dials).toBe(1);

    // HELD: it does NOT auto-reconnect on its own (the whole bug the card exposed).
    await vi.advanceTimersByTimeAsync(1000);
    expect(dials).toBe(1);

    // The user clears the cause and hits [Reconnect] → recheck() force-cycles the held
    // connection → re-dial → the now-cleared cause adopts → connected.
    causeCleared = true;
    session.recheck();
    await vi.advanceTimersByTimeAsync(200);
    expect(dials).toBe(2);
    expect(states).toContain("connected");

    session.destroy();
  });

  it("adopts to CONNECTED even when the connector skipped ctx.connecting() — never a silent stall", async () => {
    // The adopt branch used to route through `markConnected`, whose `connecting`-only
    // guard SILENTLY no-ops from any other state. A connector that returned a live link
    // WITHOUT first calling `ctx.connecting()` (a contract breach) then stranded the
    // proven-live link in `copying`/`disconnected` forever. The fix enters `connected`
    // DIRECTLY on adopt, so a proven link always transitions (and the breach is logged).
    const connectOnce = (_ctx: ConnectContext): Promise<Connection<unknown>> =>
      // Deliberately does NOT call ctx.connecting() — the contract breach under test.
      Promise.resolve({
        client: {},
        closed: new Promise<never>(() => {}),
        isAlive: () => Promise.resolve(),
        teardown: vi.fn(),
      });
    const admit = () => Promise.resolve({ kind: "adopt" as const });

    const states: string[] = [];
    const session = makeSession<unknown, SshProv>({
      initialConnection: "probing",
      connectOnce,
      admit,
      connectTimeoutMs: 5000,
      reconnectDelayMs: 60_000,
      label: "no-connecting",
    });
    session.onState((s) => states.push(s.phase));

    await session.pin();
    // The proven-live link reaches connected despite the skipped ctx.connecting() —
    // before the fix it stayed stuck at the initial "copying".
    expect(states).toContain("connected");
    expect(session.currentClient()).not.toBeNull();

    session.destroy();
  });
});
