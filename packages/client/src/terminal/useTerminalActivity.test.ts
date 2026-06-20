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
});
