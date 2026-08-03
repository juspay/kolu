import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  focused: null as TerminalId | null,
  writeFocus: vi.fn(),
  setSubPanel: vi.fn(() => Effect.void),
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
  activePadiEffect: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({
  toast: { error: vi.fn() },
}));

import { useSubPanel } from "./useSubPanel";

const PARENT = "focus-test-parent" as TerminalId;
const SUB = "focus-test-sub" as TerminalId;
const OTHER = "focus-test-other" as TerminalId;

describe("useSubPanel focus verbs", () => {
  beforeEach(() => {
    useSubPanel().removePanel(PARENT);
    useSubPanel().removePanel(OTHER);
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
    panel.focusSubTab(PARENT, SUB);
    h.writeFocus.mockClear();
    h.setSubPanel.mockClear();

    panel.expandAndFocusPanel(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("restores the remembered split when its top-level tile is selected again", () => {
    const panel = useSubPanel();
    panel.focusSubTab(PARENT, SUB);
    h.writeFocus.mockClear();
    h.setSubPanel.mockClear();

    panel.focusVisiblePane(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("reasserts DOM focus when selection repeats the same pane", () => {
    const panel = useSubPanel();
    panel.focusSubTab(PARENT, SUB);
    h.focused = SUB;
    const before = panel.peekSubPanel(PARENT).refocusNonce;
    h.writeFocus.mockClear();
    h.setSubPanel.mockClear();

    panel.focusVisiblePane(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
    expect(panel.peekSubPanel(PARENT).refocusNonce).toBe(before + 1);
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

  it("remembers A's split across a focus move to B and back", () => {
    const panel = useSubPanel();
    panel.focusSubTab(PARENT, SUB);
    panel.focusMainPane(OTHER);
    h.writeFocus.mockClear();

    panel.focusVisiblePane(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("lands a never-touched tile in main without seeding panel state", () => {
    const panel = useSubPanel();
    const absentDefault = panel.peekSubPanel(PARENT);

    panel.focusVisiblePane(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      tileHint: PARENT,
    });
    expect(panel.peekSubPanel(PARENT)).toBe(absentDefault);
    expect(h.setSubPanel).not.toHaveBeenCalled();
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

  it("restores the remembered split after collapse temporarily focuses main", () => {
    const panel = useSubPanel();
    panel.focusSubTab(PARENT, SUB);
    panel.collapsePanel(PARENT);

    expect(panel.peekSubPanel(PARENT).rememberedPane).toBe("sub");

    h.writeFocus.mockClear();
    h.setSubPanel.mockClear();

    panel.expandAndFocusPanel(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("preserves remembered split across a collapsed tile landing", () => {
    const panel = useSubPanel();
    panel.focusSubTab(PARENT, SUB);
    panel.collapsePanel(PARENT);

    panel.focusVisiblePane(PARENT);

    expect(panel.peekSubPanel(PARENT).rememberedPane).toBe("sub");
  });

  it("lands back in the split after a collapsed landing and chrome-only expand", () => {
    const panel = useSubPanel();
    panel.focusSubTab(PARENT, SUB);
    panel.collapsePanel(PARENT);
    panel.focusVisiblePane(PARENT);
    panel.expandPanel(PARENT);
    panel.focusMainPane(OTHER);
    h.writeFocus.mockClear();

    panel.focusVisiblePane(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("restores the remembered split after toggling the panel closed and open", () => {
    const panel = useSubPanel();
    panel.focusSubTab(PARENT, SUB);
    panel.togglePanel(PARENT);
    h.writeFocus.mockClear();
    h.setSubPanel.mockClear();

    panel.togglePanel(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
  });

  it("focuses the visible split on expansion even when tile landing remembers main", () => {
    const panel = useSubPanel();
    panel.focusSubTab(PARENT, SUB);
    panel.focusMainPane(PARENT);
    panel.collapsePanel(PARENT);
    h.writeFocus.mockClear();
    h.setSubPanel.mockClear();

    panel.expandAndFocusPanel(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
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
      rememberedPane: "main",
      refocusNonce: 0,
    });
    expect(h.writeFocus).not.toHaveBeenCalled();
    expect(h.setSubPanel).not.toHaveBeenCalled();
  });
});
