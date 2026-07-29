import type { TerminalId } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  focused: null as TerminalId | null,
  writeFocusFact: vi.fn(),
  setSubPanel: vi.fn(() => Promise.resolve()),
}));

vi.mock("../useViewState", () => ({
  useViewState: () => ({
    focusedTerminalId: () => h.focused,
    writeFocusFact: h.writeFocusFact,
  }),
}));

vi.mock("../wire", () => ({
  activePadiRpc: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({
  toast: { error: vi.fn() },
}));

import { useSubPanel } from "./useSubPanel";

const PARENT = "focus-test-parent" as TerminalId;
const SUB = "focus-test-sub" as TerminalId;

describe("useSubPanel focus verbs", () => {
  beforeEach(() => {
    h.focused = null;
    h.writeFocusFact.mockClear();
    h.setSubPanel.mockClear();
  });

  it("expands chrome for an external arrival without stealing focus", () => {
    useSubPanel().expandPanel(PARENT);

    expect(h.writeFocusFact).not.toHaveBeenCalled();
    expect(h.setSubPanel).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      collapsed: false,
      panelSize: 0.3,
    });
  });

  it("restores the remembered split for an explicit user expansion", () => {
    const panel = useSubPanel();
    panel.setActiveSubTab(PARENT, SUB);
    h.writeFocusFact.mockClear();

    panel.expandAndFocusPanel(PARENT);

    expect(h.writeFocusFact).toHaveBeenCalledExactlyOnceWith(SUB);
  });

  it("collapsing returns keyboard focus to the parent", () => {
    useSubPanel().collapsePanel(PARENT);

    expect(h.writeFocusFact).toHaveBeenCalledExactlyOnceWith(PARENT);
  });
});
