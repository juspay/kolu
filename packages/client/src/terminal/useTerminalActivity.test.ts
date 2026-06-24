import type { TerminalId } from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalActivity } from "./useTerminalActivity";

const tid = (x: string) => x as TerminalId;

// The store is a module-level singleton (createSharedRoot), so each test uses a
// distinct id to avoid cross-test bleed through the shared `live` record.
describe("useTerminalActivity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is static before any output", () => {
    expect(useTerminalActivity().isLive(tid("none"))).toBe(false);
  });

  it("lights on output and decays to static after the quiet period", () => {
    const a = useTerminalActivity();
    const id = tid("decay");
    a.noteOutput(id);
    expect(a.isLive(id)).toBe(true);
    // Still streaming right up to the threshold…
    vi.advanceTimersByTime(999);
    expect(a.isLive(id)).toBe(true);
    // …then one more tick of silence flips it static.
    vi.advanceTimersByTime(1);
    expect(a.isLive(id)).toBe(false);
  });

  it("re-arms the quiet period on each fresh chunk", () => {
    const a = useTerminalActivity();
    const id = tid("rearm");
    a.noteOutput(id);
    vi.advanceTimersByTime(900);
    // A second chunk resets the 1s window — the terminal stays live.
    a.noteOutput(id);
    vi.advanceTimersByTime(900);
    expect(a.isLive(id)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(a.isLive(id)).toBe(false);
  });

  it("suppress(id, ms) swallows output in the window (resize repaint), then lights again", () => {
    const a = useTerminalActivity();
    const id = tid("suppress");
    // Arm the window (as publishDimensions does around a PTY resize), then the
    // resize's repaint lands — it must NOT light the live ring.
    a.suppress(id, 600);
    a.noteOutput(id);
    expect(a.isLive(id)).toBe(false);
    // Still suppressed right up to the threshold…
    vi.advanceTimersByTime(599);
    a.noteOutput(id);
    expect(a.isLive(id)).toBe(false);
    // …then the window closes and genuine output lights it as usual.
    vi.advanceTimersByTime(1);
    a.noteOutput(id);
    expect(a.isLive(id)).toBe(true);
  });

  it("forget(id) clears a pending suppression window too", () => {
    const a = useTerminalActivity();
    const id = tid("forget-suppress");
    a.suppress(id, 600);
    a.forget(id);
    // No suppress timer survives a close; a later note lights normally.
    expect(vi.getTimerCount()).toBe(0);
    a.noteOutput(id);
    expect(a.isLive(id)).toBe(true);
  });

  it("forget(id) drops the key and clears its pending timer", () => {
    const a = useTerminalActivity();
    const id = tid("forget");
    a.noteOutput(id);
    expect(a.isLive(id)).toBe(true);
    // The terminal closes mid-stream — forget prunes the entry outright.
    a.forget(id);
    expect(a.isLive(id)).toBe(false);
    // No stale timer survives to fire setLive after the terminal is gone:
    // advancing past the quiet window is a no-op, and no timers are pending.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(a.isLive(id)).toBe(false);
  });
});
