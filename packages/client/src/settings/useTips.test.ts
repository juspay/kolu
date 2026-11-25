// @vitest-environment happy-dom
/**
 * Tip state's queue: two contextual tips raised before the saved preferences
 * arrive drain in one synchronous loop. Only one can be shown, and the other
 * must be dropped UNMARKED so its next trigger shows it — the authority for
 * "a tip is already showing" has to answer within that loop, not on the
 * flush that follows it.
 */

import { createRoot, flush } from "solid-js";
import { expect, it, vi } from "vitest";
import { activeTip, useTips } from "./useTips";

const state = vi.hoisted(() => ({
  arrived: undefined as unknown as () => boolean,
  setArrived: undefined as unknown as (v: boolean) => void,
  seenTips: undefined as unknown as () => string[],
  setSeenTips: undefined as unknown as (v: string[]) => void,
}));

// The saved preferences are the wire's; the signals behind them are made in
// here because the factory runs before this module's own imports.
vi.mock("../wire", async () => {
  const { createSignal } = await import("solid-js");
  const [arrived, setArrived] = createSignal(false);
  const [seenTips, setSeenTips] = createSignal<string[]>([]);
  state.arrived = arrived;
  state.setArrived = setArrived;
  state.seenTips = seenTips;
  state.setSeenTips = setSeenTips;
  return {
    preferencesArrived: () => arrived(),
    preferences: () => ({ seenTips: seenTips(), startupTips: false }),
    updatePreferences: (p: { seenTips?: string[] }) => {
      if (p.seenTips) setSeenTips(p.seenTips);
    },
  };
});
vi.mock("../capabilities", () => ({ showsAmbientTips: () => true }));

// The queue drains at a settle, which runs as a task.
const settle = () => new Promise((r) => setTimeout(r, 0));

it("drops the second queued tip unmarked when the first takes the banner", async () => {
  const { showTipOnce, initTipTriggers } = useTips();
  const dispose = createRoot((d) => {
    initTipTriggers({ terminalIds: () => [] });
    return d;
  });
  try {
    const first = { id: "t-first", text: "first" };
    const second = { id: "t-second", text: "second" };
    showTipOnce(first);
    showTipOnce(second);
    await settle();
    flush();
    // Neither could decide yet: the preferences had not arrived.
    expect(activeTip()).toBe(null);

    state.setArrived(true);
    flush();
    await settle();
    flush();

    // The first takes the banner, and only it is marked seen: the second is
    // dropped unmarked, so its next trigger shows it.
    expect(activeTip()).toBe(first);
    expect(state.seenTips()).toEqual(["t-first"]);
  } finally {
    dispose();
  }
});
