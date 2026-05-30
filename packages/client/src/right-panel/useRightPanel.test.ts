import { beforeEach, describe, expect, it, vi } from "vitest";

// useRightPanel reads `preferences()` and writes via `updatePreferences` from
// the wire singleton, and resolves the active terminal from useTerminalStore.
// Stub both so the size mutators can be exercised without a live socket.
const h = vi.hoisted(() => ({
  updatePreferences: vi.fn(),
  prefs: {
    rightPanel: { collapsed: false, size: 0.25, codeTabTreeSize: 0.35 },
  },
}));

vi.mock("../wire", () => ({
  client: {},
  updatePreferences: h.updatePreferences,
  preferences: () => h.prefs,
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({ activeId: () => null }),
}));

import { useRightPanel } from "./useRightPanel";

beforeEach(() => {
  h.updatePreferences.mockClear();
  h.prefs = {
    rightPanel: { collapsed: false, size: 0.25, codeTabTreeSize: 0.35 },
  };
});

describe("useRightPanel — size writes drop Corvu's idempotent re-emits (#1041)", () => {
  it("setPanelSize drops a write equal to the stored size", () => {
    useRightPanel().setPanelSize(0.25);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });

  it("setPanelSize persists a changed size, opting into coalescing", () => {
    useRightPanel().setPanelSize(0.5);
    expect(h.updatePreferences).toHaveBeenCalledExactlyOnceWith(
      { rightPanel: { size: 0.5 } },
      { coalesce: true },
    );
  });

  it("setPanelSize ignores sizes at or below the minimum", () => {
    useRightPanel().setPanelSize(0.01);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });

  it("setCodeTabTreeSize drops a write equal to the stored value", () => {
    useRightPanel().setCodeTabTreeSize(0.35);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });

  it("setCodeTabTreeSize persists a changed value within bounds, opting into coalescing", () => {
    useRightPanel().setCodeTabTreeSize(0.6);
    expect(h.updatePreferences).toHaveBeenCalledExactlyOnceWith(
      { rightPanel: { codeTabTreeSize: 0.6 } },
      { coalesce: true },
    );
  });

  it("setCodeTabTreeSize ignores out-of-bounds values", () => {
    useRightPanel().setCodeTabTreeSize(0.95);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });
});
