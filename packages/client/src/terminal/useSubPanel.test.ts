import type { TerminalId } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  focused: null as TerminalId | null,
  writeFocus: vi.fn(),
  setSubPanel: vi.fn(() => Promise.resolve()),
}));

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    view: {
      focusedTerminalId: () => h.focused,
      writeFocus: h.writeFocus,
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
    useSubPanel().removePanel(PARENT);
    h.focused = null;
    h.writeFocus.mockClear();
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

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("lands on a different split with one focus commit", () => {
    const panel = useSubPanel();
    panel.setActiveSubTab(PARENT, "focus-test-old" as TerminalId);
    h.focused = "focus-test-old" as TerminalId;
    h.writeFocus.mockClear();

    panel.focusSubTab(PARENT, SUB);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
    expect(h.setSubPanel).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      collapsed: false,
      panelSize: 0.3,
    });
  });

  it("keeps remembered-tab hydration chrome-only", () => {
    useSubPanel().setActiveSubTab(PARENT, SUB);

    expect(h.writeFocus).not.toHaveBeenCalled();
  });

  it("collapsing returns keyboard focus to the parent", () => {
    useSubPanel().collapsePanel(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      tileHint: PARENT,
    });
  });

  it("writes the main pane as the exact focused terminal", () => {
    useSubPanel().focusMainPane(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      tileHint: PARENT,
    });
  });

  it("writes a clicked visible split with its containing tile hint", () => {
    const panel = useSubPanel();
    panel.setActiveSubTab(PARENT, SUB);

    panel.focusVisibleSubPane(PARENT, SUB);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("switches the focus fact with an explicit sub-tab selection", () => {
    useSubPanel().selectSubTab(PARENT, SUB);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("focuses the main pane when an empty panel is explicitly expanded", () => {
    useSubPanel().expandAndFocusPanel(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      tileHint: PARENT,
    });
  });

  it("reads absent panel defaults without seeding or reporting state", () => {
    const state = useSubPanel().peekSubPanel(PARENT);

    expect(state).toEqual({
      collapsed: false,
      panelSize: 0.3,
      activeSubTab: null,
      refocusNonce: 0,
    });
    expect(h.writeFocus).not.toHaveBeenCalled();
    expect(h.setSubPanel).not.toHaveBeenCalled();
  });
});
