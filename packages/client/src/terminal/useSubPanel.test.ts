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
  activePadiRpc: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({
  toast: { error: vi.fn() },
}));

import { repairTileTabs, useSubPanel } from "./useSubPanel";

/** Terminal ids are branded; the repair only ever compares them. */
const T = (s: string) => s as TerminalId;

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

/** The panel's seams `repairTileTabs` drives, as spies — the rule's own
 *  vocabulary (`peekSubPanel` resolves the active tab), so nothing here can
 *  hand the repair a verb it is not allowed to call. */
function repairSpies(active: TerminalId | null) {
  return {
    collapsePanel: vi.fn<(id: TerminalId) => void>(),
    collapsePanelChrome: vi.fn<(id: TerminalId) => void>(),
    peekSubPanel: () => ({ activeSubTab: active }),
    setActiveSubTab: vi.fn<(id: TerminalId, sub: TerminalId | null) => void>(),
    selectSubTab: vi.fn<(id: TerminalId, sub: TerminalId | null) => void>(),
  };
}

describe("repairTileTabs", () => {
  it("leaves an active tab that is still a pane of the tile alone", () => {
    // The same-tile move (a split dropped on its own sibling) arrives here: the
    // moved terminal is STILL under the tile, so the strip needs nothing.
    const p = repairSpies(T("S1"));
    repairTileTabs(p, T("P"), [T("S1"), T("S2")], false);
    expect(p.setActiveSubTab).not.toHaveBeenCalled();
    expect(p.selectSubTab).not.toHaveBeenCalled();
    expect(p.collapsePanel).not.toHaveBeenCalled();
    expect(p.collapsePanelChrome).not.toHaveBeenCalled();
  });

  it("leaves a null active tab null", () => {
    const p = repairSpies(null);
    repairTileTabs(p, T("P"), [T("S1")], false);
    expect(p.setActiveSubTab).not.toHaveBeenCalled();
  });

  it("replaces a tab left dangling at a pane that departed WITH its parent", () => {
    // R ← M ← G, and R ← S. R's active tab is G. Dragging M away takes G with
    // it, so the "is the active tab the pane that left?" test (M) would miss G
    // and leave the strip pointing at a terminal that is no longer under R —
    // the dangling state this repair exists to forbid.
    const p = repairSpies(T("G"));
    repairTileTabs(p, T("R"), [T("S")], false);
    expect(p.setActiveSubTab).toHaveBeenCalledExactlyOnceWith(T("R"), T("S"));
    expect(p.selectSubTab).not.toHaveBeenCalled();
  });

  it("carries the focus fact when the departing pane had it", () => {
    const p = repairSpies(T("S1"));
    repairTileTabs(p, T("P"), [T("S2")], true);
    expect(p.selectSubTab).toHaveBeenCalledExactlyOnceWith(T("P"), T("S2"));
    expect(p.setActiveSubTab).not.toHaveBeenCalled();
  });

  it("collapses and clears the tab when no pane remains", () => {
    const p = repairSpies(T("S1"));
    repairTileTabs(p, T("P"), [], false);
    expect(p.collapsePanelChrome).toHaveBeenCalledExactlyOnceWith(T("P"));
    expect(p.setActiveSubTab).toHaveBeenCalledExactlyOnceWith(T("P"), null);
  });
});
