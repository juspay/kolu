/**
 * The lifted half-open-link watchdog (`@kolu/surface/heartbeat`) — the algorithm
 * both legs share. The browser leg's partysocket-shaped wrapper is exercised
 * end-to-end in `@kolu/surface-app`'s `connect.test.ts`, and the ssh leg in
 * `@kolu/surface-nix-host`'s `liveness.test.ts`; here we pin the two injected
 * variation points directly — the `isLive` GATE and the `onStale` ACTION — plus
 * the race/settle/skip-overlap/dispose invariants, framework-free.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHeartbeat,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
} from "./heartbeat";

describe("createHeartbeat (lifted primitive)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ships the shared 15s/10s cadence so both legs pin the same numbers", () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(15_000);
    expect(DEFAULT_HEARTBEAT_TIMEOUT_MS).toBe(10_000);
  });

  it("never probes while isLive() is false (the gate)", async () => {
    const probe = vi.fn().mockResolvedValue(null);
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      isLive: () => false,
      onStale,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
    dispose();
  });

  it("runs onStale (the action) FIRST, then onStaleReport, on a missed probe", async () => {
    const order: string[] = [];
    const onStale = vi.fn(() => order.push("action"));
    const onStaleReport = vi.fn(() => order.push("report"));
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      onStaleReport,
      probe: () => new Promise<never>(() => {}), // never answers
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1500); // tick + probe timeout
    expect(order).toEqual(["action", "report"]);
    dispose();
  });

  it("still runs onStale even when the onStaleReport reporter throws", async () => {
    const onStale = vi.fn();
    const onStaleReport = vi.fn(() => {
      throw new Error("reporter blew up");
    });
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      onStaleReport,
      probe: () => new Promise<never>(() => {}),
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(onStale).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("surfaces a throwing onStale via console.error and keeps the interval alive", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onStale = vi.fn(() => {
      throw new Error("recovery blew up");
    });
    let live = true;
    const { dispose } = createHeartbeat({
      isLive: () => live,
      onStale,
      probe: () => new Promise<never>(() => {}), // never answers
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1500); // tick + probe timeout → onStale throws
    expect(onStale).toHaveBeenCalledTimes(1);
    // The throw was surfaced, not swallowed.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("onStale recovery action threw"),
      expect.any(Error),
    );
    // The interval survived the throw: a later tick still probes.
    live = false; // gate the next probe so the assertion is about the interval, not a 2nd stale
    await vi.advanceTimersByTimeAsync(1000);
    live = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onStale).toHaveBeenCalledTimes(2);
    dispose();
    consoleError.mockRestore();
  });

  it("treats a probe REJECTION as alive — a completed round-trip, not half-open", async () => {
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      probe: vi.fn().mockRejectedValue(new Error("server said no")),
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onStale).not.toHaveBeenCalled();
    dispose();
  });

  it("surfaces a SYNCHRONOUS probe throw via onProbeError, does NOT run onStale, and settles for the next tick", async () => {
    const onStale = vi.fn();
    const onProbeError = vi.fn();
    const probe = vi.fn(() => {
      throw new Error("miswired");
    });
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      onProbeError,
      probe: probe as unknown as () => Promise<unknown>,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe throws
    expect(onProbeError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // timeout window passes
    expect(onStale).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(2); // settled → next tick probed again
    dispose();
  });

  it("never overlaps probes — a tick is skipped while one is still outstanding", async () => {
    let resolveProbe: ((v: unknown) => void) | undefined;
    const probe = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale: vi.fn(),
      probe,
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick 1 → in flight
    await vi.advanceTimersByTimeAsync(1000); // tick 2 → skipped
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe?.({});
    await vi.advanceTimersByTimeAsync(1000); // tick 3 → probe again
    expect(probe).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("does not run onStale when disposed while a probe is still in flight", async () => {
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      probe: () => new Promise<never>(() => {}), // never answers
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000); // probe in flight, timeout armed
    dispose(); // tear down before the 500ms timeout elapses
    await vi.advanceTimersByTimeAsync(2000);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("stops probing after dispose", async () => {
    const probe = vi.fn().mockResolvedValue(null);
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale: vi.fn(),
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledTimes(1);
    dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
