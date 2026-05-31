/**
 * Regression coverage for two failure paths through `spawn()`, both of
 * which short-circuit before any ssh child is created:
 *
 *   1. "Reconnect does nothing" — when the link gives up because
 *      `nix copy --derivation` provisioning failed, `spawn()` throws
 *      before any child exists, so `handleChildDone` (the usual site that
 *      nulls `clientPromise`) never runs. If the terminal `failed`
 *      transition doesn't clear the slot itself, it keeps the last
 *      *rejected* spawn promise, and `reconnect()`'s `clientPromise !==
 *      null` guard makes the "Reconnect" button a silent no-op. See
 *      `clearClientPromise` / `scheduleReconnect`.
 *
 *   2. "Unreachable at boot" — the `.drv` resolver (typically an ssh arch
 *      probe, deferred into `resolveDrvPath`) rejects because the host is
 *      unreachable. The session must degrade to `failed` through its own
 *      reconnect machinery, not throw out of construction — that's what
 *      keeps one unreachable initial host from crashing the parent server
 *      before any session exists.
 *
 * Both keep off real ssh / `nix copy`: case 1 mocks `provisionAgent` to
 * fail; case 2's resolver rejects before `provisionAgent` is ever reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostSession } from "./hostSession";
import { provisionAgent } from "./nixCopy";

vi.mock("./nixCopy", () => ({
  provisionAgent: vi.fn(),
}));

const PROVISION_FAILURE = {
  ok: false as const,
  reason: "testhost: 'nix copy --derivation' exited with code 1",
};

function failingSession() {
  return new HostSession({
    host: "testhost",
    resolveDrvPath: () => Promise.resolve("/nix/store/deadbeef-agent.drv"),
    binary: "agent",
    reconnectDelayMs: 1000,
  });
}

/** A session whose `.drv` resolver always rejects — models a host that's
 *  unreachable at arch-probe time (`resolveSystem` ssh exits non-zero).
 *  `provisionAgent` is never reached, so it stays unmocked here. */
function unresolvableSession() {
  return new HostSession({
    host: "testhost",
    resolveDrvPath: () =>
      Promise.reject(
        new Error(
          "testhost: `nix-instantiate --eval builtins.currentSystem` exited 255",
        ),
      ),
    binary: "agent",
    reconnectDelayMs: 1000,
  });
}

describe("HostSession reconnect after give-up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue(PROVISION_FAILURE);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("re-arms a session that gave up on a nix-copy failure", async () => {
    const session = failingSession();

    // Pin spawns; provision fails every attempt. Drive the backoff
    // (1s + 2s + 4s + 8s) through all 5 attempts to the terminal state.
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(20_000);

    expect(session.current().connection).toBe("failed");
    // The invariant the fix restores: no spawn in flight ⇒ the slot the
    // reconnect guard reads is null. Pre-fix this held the last rejected
    // spawn promise because no child ever exited to clear it.
    expect(session.currentClient()).toBeNull();

    // The button. `spawn()` sets "copying" synchronously before its first
    // await, so re-arming is observable immediately. Pre-fix, the guard
    // saw a non-null slot and returned without spawning — state stuck.
    session.reconnect();
    expect(session.current().connection).toBe("copying");
    expect(session.currentClient()).not.toBeNull();

    session.destroy();
  });

  it("ignores reconnect() while a spawn is genuinely in flight", async () => {
    const session = failingSession();

    session.pin().catch(() => {});
    // First spawn is mid-provision (awaiting the mocked promise). The
    // guard must hold so a double-tapped Reconnect can't stack spawns.
    const inFlight = session.currentClient();
    expect(inFlight).not.toBeNull();

    session.reconnect();
    expect(session.currentClient()).toBe(inFlight);

    session.destroy();
    await vi.advanceTimersByTimeAsync(20_000);
  });
});

describe("HostSession with a failing drv resolver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("degrades to failed instead of throwing out of construction", async () => {
    const session = unresolvableSession();

    // The session exists and is observable even though the very first
    // round-trip (the arch probe, deferred into `resolveDrvPath`) can't
    // reach the host. This is the regression fix: the probe failure flows
    // through the session's own reconnect machinery rather than rejecting
    // before any session is created (which previously crashed the parent
    // server at boot when one initial host was unreachable).
    session.pin().catch(() => {});

    // A rejecting resolver is handled exactly like a `provisionAgent`
    // failure: copying → disconnected → backoff (1s+2s+4s+8s) → failed.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.current().connection).toBe("failed");
    expect(session.current().lastError).toMatch(/exited 255/);
    expect(session.currentClient()).toBeNull();

    // And the terminal state is re-armable — `reconnect()` re-runs the
    // resolver on the next spawn, the same path a transiently-unreachable
    // host recovers through once ssh comes back.
    session.reconnect();
    expect(session.current().connection).toBe("copying");
    expect(session.currentClient()).not.toBeNull();

    session.destroy();
  });
});
