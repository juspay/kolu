import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createRoot, createSignal } from "solid-js";
import { describe, expect, it, type Mock, vi } from "vitest";
import { pickAutoSwitchTarget, useActiveReconcile } from "./useActiveReconcile";

const T = (n: number) => `t${n}` as TerminalId;

/** Let SolidJS flush the queued reactive effects (they don't run inside the
 *  synchronous `createRoot` batch). After this, signal writes made OUTSIDE the
 *  batch flush the reconcile effect synchronously — so an assertion right after
 *  a write observes its result. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Mount `useActiveReconcile` over plain signals, hoisting the setters out of
 *  the `createRoot` batch so a test can drive the list AFTER the initial effect
 *  has flushed. `activate` is a spy that also updates the active signal, so a
 *  spurious second switch would be observable. */
function setup(init: {
  ids: TerminalId[];
  rawIds: TerminalId[];
  active: TerminalId | null;
}) {
  let handles!: {
    setIds: (v: TerminalId[]) => void;
    setRawIds: (v: TerminalId[]) => void;
    active: Accessor<TerminalId | null>;
    activate: Mock<(id: TerminalId | null) => void>;
    dispose: () => void;
  };
  createRoot((dispose) => {
    const [ids, setIds] = createSignal<TerminalId[]>(init.ids);
    const [rawIds, setRawIds] = createSignal<TerminalId[]>(init.rawIds);
    const [active, setActive] = createSignal<TerminalId | null>(init.active);
    const activate = vi.fn((id: TerminalId | null) => {
      setActive(id);
    });
    useActiveReconcile({
      terminalIds: ids,
      rawIds,
      activeId: active,
      activate,
    });
    handles = { setIds, setRawIds, active, activate, dispose };
  });
  return handles;
}

describe("pickAutoSwitchTarget", () => {
  it("picks the survivor now in the removed tile's slot, clamped to the last", () => {
    // Remove the middle tile → the one that slides up into its slot.
    expect(pickAutoSwitchTarget([T(1), T(3)], 1)).toBe(T(3));
    // Remove the first tile → the next one.
    expect(pickAutoSwitchTarget([T(2), T(3)], 0)).toBe(T(2));
    // Remove the last tile → clamp to the new last.
    expect(pickAutoSwitchTarget([T(1), T(2)], 2)).toBe(T(2));
    // Nothing left → null (e.g. close-all).
    expect(pickAutoSwitchTarget([], 0)).toBeNull();
    // Removed id was never in the list (-1) → null, never blanks a live active.
    expect(pickAutoSwitchTarget([T(1)], -1)).toBeNull();
  });
});

describe("useActiveReconcile — active tile follows the LIST, not the exit event", () => {
  it("auto-switches when the active tile drops from the list WITHOUT a terminalExit", async () => {
    const h = setup({ ids: [T(1), T(2)], rawIds: [T(1), T(2)], active: T(1) });
    await tick();

    // Natural PTY exit of the ACTIVE tile (t1): the collection removal drops t1
    // from BOTH the raw keys and the metadata-filtered list — and NO
    // terminalExit event fires (its subscription was disposed by this very
    // removal). Focus must still fall to the survivor.
    h.setRawIds([T(2)]);
    h.setIds([T(2)]);

    expect(h.activate).toHaveBeenCalledTimes(1);
    expect(h.activate).toHaveBeenCalledWith(T(2));
    expect(h.active()).toBe(T(2));
    h.dispose();
  });

  it("is a NO-OP for the kill path — active is already a listed survivor", async () => {
    // handleKill -> removeAndAutoSwitch already switched active to t2
    // synchronously BEFORE the list update arrives.
    const h = setup({ ids: [T(1), T(2)], rawIds: [T(1), T(2)], active: T(2) });
    await tick();

    // The list drop for the killed t1 now lands.
    h.setRawIds([T(2)]);
    h.setIds([T(2)]);

    // active is already the listed survivor → no second switch, no flicker.
    expect(h.activate).not.toHaveBeenCalled();
    expect(h.active()).toBe(T(2));
    h.dispose();
  });

  it("does not fight a fresh create whose metadata is still loading", async () => {
    // A create pushed t2 into the raw keys and made it active, but its metadata
    // hasn't arrived, so t2 is not yet in the filtered `terminalIds`.
    const h = setup({ ids: [T(1)], rawIds: [T(1), T(2)], active: T(2) });
    await tick();

    // Unrelated list churn fires the reconcile while t2 is still loading — t2 is
    // present in the raw keys, so it must NOT be switched away from.
    h.setIds([T(1)]);

    expect(h.activate).not.toHaveBeenCalled();
    h.dispose();
  });

  it("does nothing on mount when the active tile is present", async () => {
    const h = setup({ ids: [T(1), T(2)], rawIds: [T(1), T(2)], active: T(1) });
    await tick();

    expect(h.activate).not.toHaveBeenCalled();
    h.dispose();
  });
});
