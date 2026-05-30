/**
 * Regression coverage for the "Reconnect does nothing" bug.
 *
 * When the link gives up because the `nix copy --derivation`
 * provisioning step failed (vs. the agent process exiting), `spawn()`
 * throws BEFORE any ssh child is created — so `handleChildDone`, the
 * usual site that nulls `clientPromise`, never runs. If the terminal
 * `failed` transition doesn't clear the slot itself, it keeps the last
 * *rejected* spawn promise, and `reconnect()`'s `clientPromise !== null`
 * guard makes the "Reconnect" button a silent no-op. See
 * `clearClientPromise` / `scheduleReconnect`.
 *
 * `provisionAgent` is the only collaborator mocked: forcing it to fail
 * keeps the whole test off real ssh / `nix copy`, and short-circuits
 * `spawn()` before it ever reaches `child_process.spawn`.
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
    drvPath: "/nix/store/deadbeef-agent.drv",
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
