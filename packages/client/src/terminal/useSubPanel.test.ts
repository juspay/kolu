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
    // No terminals collection in these tests: every tile's record is absent,
    // so the split state reads its one default (`splitPanelState.ts`).
    wire: { terminals: undefined },
  }),
}));

vi.mock("../wire", () => ({
  activePadiRpc: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({
  toast: { error: vi.fn() },
}));

import { planTileTabsRepair, useSubPanel } from "./useSubPanel";

/** A `TerminalId` is a UUID-checked string, not a brand: the cast only names
 *  the type, and the repair never checks the shape — it only compares ids. */
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
    const panel = useSubPanel();
    panel.collapsePanelChrome(PARENT);
    h.setSubPanel.mockClear();

    panel.expandPanel(PARENT);

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
    const before = panel.paneChrome(PARENT).refocusNonce;
    h.writeFocus.mockClear();
    h.setSubPanel.mockClear();

    panel.focusVisiblePane(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: SUB,
      tileHint: PARENT,
    });
    expect(panel.paneChrome(PARENT).refocusNonce).toBe(before + 1);
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
    // The split was already open, so the landing SAVES NOTHING. A write of the
    // state already shown is the loop that broke drag-to-resize
    // (`splitPanelState.write`).
    expect(h.setSubPanel).not.toHaveBeenCalled();
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
    const absentDefault = panel.paneChrome(PARENT);

    panel.focusVisiblePane(PARENT);

    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      tileHint: PARENT,
    });
    expect(panel.paneChrome(PARENT)).toBe(absentDefault);
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

    expect(panel.paneChrome(PARENT).rememberedPane).toBe("sub");

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

    expect(panel.paneChrome(PARENT).rememberedPane).toBe("sub");
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

  it("reads absent pane chrome without seeding or reporting state", () => {
    const state = useSubPanel().paneChrome(PARENT);

    expect(state).toEqual({
      activeSubTab: null,
      rememberedPane: "main",
      refocusNonce: 0,
    });
    expect(h.writeFocus).not.toHaveBeenCalled();
    expect(h.setSubPanel).not.toHaveBeenCalled();
  });

  it("answers the default saved split for a terminal with no record", () => {
    // ONE answer for an unsaid split, and it is the record's absence that
    // produces it — never a copy sitting in front of the record.
    expect(useSubPanel().savedSplit(PARENT)).toEqual({
      collapsed: false,
      panelSize: 0.3,
    });
    expect(h.setSubPanel).not.toHaveBeenCalled();
  });
});

/** The panel's seams `planTileTabsRepair` drives, as spies — the rule's own
 *  vocabulary (`paneChrome` resolves the active tab), so nothing here can
 *  hand the repair a verb it is not allowed to call. Each `plan…` spy records
 *  its arguments at PLAN time and hands back a no-op actor, so the argument
 *  assertions below read exactly as they did when the ports were writers. */
function repairSpies(active: TerminalId | null) {
  return {
    planCollapsePanel: vi.fn<(id: TerminalId) => () => void>(() => () => {}),
    planCollapsePanelChrome:
      vi.fn<(id: TerminalId) => () => void>(() => () => {}),
    paneChrome: () => ({ activeSubTab: active }),
    setActiveSubTab: vi.fn<(id: TerminalId, sub: TerminalId | null) => void>(),
    planSelectSubTab: vi.fn<
      (id: TerminalId, sub: TerminalId | null) => () => void
    >(() => () => {}),
  };
}

describe("planTileTabsRepair", () => {
  it("leaves an active tab that is still a pane of the tile alone", () => {
    // The same-tile move (a split dropped on its own sibling) arrives here: the
    // moved terminal is STILL under the tile, so the strip needs nothing.
    const p = repairSpies(T("S1"));
    planTileTabsRepair(p, T("P"), [T("S1"), T("S2")], false)();
    expect(p.setActiveSubTab).not.toHaveBeenCalled();
    expect(p.planSelectSubTab).not.toHaveBeenCalled();
    expect(p.planCollapsePanel).not.toHaveBeenCalled();
    expect(p.planCollapsePanelChrome).not.toHaveBeenCalled();
  });

  it("leaves a null active tab null", () => {
    const p = repairSpies(null);
    planTileTabsRepair(p, T("P"), [T("S1")], false)();
    expect(p.setActiveSubTab).not.toHaveBeenCalled();
  });

  it("replaces a tab left dangling at a pane that departed WITH its parent", () => {
    // R ← M ← G, and R ← S. R's active tab is G. Dragging M away takes G with
    // it, so the "is the active tab the pane that left?" test (M) would miss G
    // and leave the strip pointing at a terminal that is no longer under R —
    // the dangling state this repair exists to forbid.
    const p = repairSpies(T("G"));
    planTileTabsRepair(p, T("R"), [T("S")], false)();
    expect(p.setActiveSubTab).toHaveBeenCalledExactlyOnceWith(T("R"), T("S"));
    expect(p.planSelectSubTab).not.toHaveBeenCalled();
  });

  it("carries the focus fact when the departing pane had it", () => {
    const p = repairSpies(T("S1"));
    planTileTabsRepair(p, T("P"), [T("S2")], true)();
    expect(p.planSelectSubTab).toHaveBeenCalledExactlyOnceWith(T("P"), T("S2"));
    expect(p.setActiveSubTab).not.toHaveBeenCalled();
  });

  it("collapses and clears the tab when no pane remains", () => {
    const p = repairSpies(T("S1"));
    planTileTabsRepair(p, T("P"), [], false)();
    expect(p.planCollapsePanelChrome).toHaveBeenCalledExactlyOnceWith(T("P"));
    expect(p.setActiveSubTab).toHaveBeenCalledExactlyOnceWith(T("P"), null);
  });
});
