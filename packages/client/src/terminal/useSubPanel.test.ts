import type { TerminalId } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  focused: null as TerminalId | null,
  writeFocus: vi.fn(),
  writeSplitFocus: vi.fn(),
  setSubPanel: vi.fn(() => Promise.resolve()),
}));

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    view: {
      focusedTerminalId: () => h.focused,
      writeFocus: h.writeFocus,
      writeSplitFocus: h.writeSplitFocus,
    },
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
    h.writeFocus.mockClear();
    h.writeSplitFocus.mockClear();
    h.setSubPanel.mockClear();
  });

  it("expands chrome for an external arrival without stealing focus", () => {
    useSubPanel().expandPanel(PARENT);

    expect(h.writeFocus).not.toHaveBeenCalled();
    expect(h.setSubPanel).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      collapsed: false,
      panelSize: 0.3,
    });
  });

  it("restores the remembered split for an explicit user expansion", () => {
    const panel = useSubPanel();
    panel.setActiveSubTab(PARENT, SUB);
    h.writeFocus.mockClear();

    panel.expandAndFocusPanel(PARENT);

    expect(h.writeSplitFocus).toHaveBeenCalledExactlyOnceWith(PARENT, SUB);
  });

  it("lands on a different split with one focus commit", () => {
    const panel = useSubPanel();
    panel.setActiveSubTab(PARENT, "focus-test-old" as TerminalId);
    h.focused = "focus-test-old" as TerminalId;
    h.writeSplitFocus.mockClear();

    panel.focusSubTab(PARENT, SUB);

    expect(h.writeSplitFocus).toHaveBeenCalledExactlyOnceWith(PARENT, SUB);
    expect(h.setSubPanel).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      collapsed: false,
      panelSize: 0.3,
    });
  });

  it("keeps remembered-tab hydration chrome-only", () => {
    useSubPanel().setActiveSubTab(PARENT, SUB);

    expect(h.writeFocus).not.toHaveBeenCalled();
    expect(h.writeSplitFocus).not.toHaveBeenCalled();
  });

  it("collapsing returns keyboard focus to the parent", () => {
    useSubPanel().collapsePanel(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith(PARENT);
  });
});
