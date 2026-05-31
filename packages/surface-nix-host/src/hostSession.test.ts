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
 *   2. "Unreachable host keeps retrying" — the `.drv` resolver (typically
 *      an ssh arch probe, deferred into `resolveDrvPath`) rejects because
 *      the host is unreachable. This is a `"network"` fault: the session
 *      must (a) flow through its own reconnect machinery rather than throw
 *      out of construction — keeping one unreachable initial host from
 *      crashing the parent server before any session exists — and (b)
 *      *never* give up, so a roaming laptop reconnects on its own once the
 *      host is reachable again, instead of stranding in terminal `failed`.
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
  // Reached the host, it rejected the closure (trusted-users) — terminal.
  cause: "remote" as const,
};

// Reached the arch probe, but the host went unreachable mid-provision
// (asleep/roaming after the probe). A `"network"` provision failure — must
// keep retrying, not give up.
const PROVISION_NETWORK_FAILURE = {
  ok: false as const,
  reason: "testhost: 'nix copy --derivation' exited with code 1",
  cause: "network" as const,
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

  it("keeps retrying a network-class provision failure instead of giving up", async () => {
    // A provision failure isn't automatically terminal: if the host went
    // unreachable mid-`nix copy` (after the arch probe succeeded),
    // `provisionAgent` reports `cause: "network"`, and that must retry like
    // any transport fault rather than burn the give-up budget.
    vi.mocked(provisionAgent).mockResolvedValue(
      PROVISION_NETWORK_FAILURE as never,
    );
    const session = failingSession();
    session.pin().catch(() => {});

    // Well past the 5th attempt a "remote" provision failure would have
    // given up at (1+2+4+8s).
    await vi.advanceTimersByTimeAsync(70_000);
    expect(session.current().connection).not.toBe("failed");
    expect(session.current().failureCause).toBe("network");

    session.destroy();
  });
});

describe("HostSession with a failing drv resolver (network-unreachable)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("flows through the reconnect machinery instead of throwing out of construction", async () => {
    const session = unresolvableSession();

    // The session exists and is observable even though the very first
    // round-trip (the arch probe, deferred into `resolveDrvPath`) can't
    // reach the host: the probe failure flows through the session's own
    // reconnect machinery rather than rejecting before any session is
    // created (which previously crashed the parent server at boot when one
    // initial host was unreachable). A rejecting resolver is a `"network"`
    // fault — copying → disconnected → backoff → copying → …
    session.pin().catch(() => {});

    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.current().failureCause).toBe("network");
    expect(session.current().lastError).toMatch(/exited 255/);
    expect(session.current().connection).not.toBe("failed");

    session.destroy();
  });

  it("never gives up on an unreachable host — a network fault is not terminal", async () => {
    const session = unresolvableSession();
    session.pin().catch(() => {});

    // Drive far past where a *remote* fault would have given up
    // (1+2+4+8s = 15s to the 5th attempt). An unreachable host has no
    // give-up ceiling: it keeps probing at the capped backoff so a roaming
    // laptop reconnects on its own once the host answers again — never
    // stranding in terminal `failed` with a manual Reconnect as the only
    // way out.
    await vi.advanceTimersByTimeAsync(70_000);
    expect(session.current().connection).not.toBe("failed");
    expect(session.current().failureCause).toBe("network");

    // Proof it sailed past the old MAX_CONSECUTIVE_FAILURES (=5) ceiling:
    // more than five "host unreachable" retry lines were emitted.
    const retries = session
      .current()
      .progressLines.filter((l) => l.includes("host unreachable"));
    expect(retries.length).toBeGreaterThan(5);

    session.destroy();
  });

  it("recheck() re-arms a backoff session instead of stranding it (Codex P1)", async () => {
    const session = unresolvableSession();
    session.pin().catch(() => {});

    // First probe fails → disconnected with the backoff timer armed.
    await vi.advanceTimersByTimeAsync(10);
    expect(session.current().connection).toBe("disconnected");

    // The bug: `recheck()` cleared the backoff timer, then early-returned
    // because `clientPromise` still held the *rejected* pre-child spawn
    // promise — leaving no timer and no spawn, stranded forever. Post-fix,
    // `scheduleReconnect` nulls `clientPromise` during backoff, so
    // `recheck()` respawns: `spawn()` sets "copying" before its first await,
    // so the re-arm is observable synchronously.
    session.recheck();
    expect(session.current().connection).toBe("copying");
    expect(session.currentClient()).not.toBeNull();

    session.destroy();
  });
});
