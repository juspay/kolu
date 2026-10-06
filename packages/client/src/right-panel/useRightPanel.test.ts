import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

// useRightPanel reads `preferences()` and writes via `updatePreferences` from
// the wire singleton, resolves the active terminal from useTerminalStore, and
// gates `hasTerminals` on the tile registry's count. Stub all three so the size
// mutators can be exercised without a live socket (mocking useTileStore also
// keeps its persistCanvasLayout → solid-sonner chain out of the test env).
const h = vi.hoisted(() => ({
  host: "host-A",
  saveOnOtherHost: vi.fn((): Effect.Effect<void, Error> => Effect.void),
  updatePreferences: vi.fn(),
  setRightPanel: vi.fn((): Effect.Effect<void, Error> => Effect.void),
  toastError: vi.fn(),
  prefs: {
    newTerminalCollapsed: false,
    rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
  },
  // Mutable so a test can flip the "active terminal" the way the workspace
  // switcher does at runtime — `recordNavigation`/`canNavigateBack` resolve
  // their terminal through this.
  activeId: null as string | null,
  // The FOCUSED PANE, when it is not the active tile (i.e. a split has focus).
  // `undefined` means "no split focused" — the focused-pane reads then fall back
  // to `activeId`, which is the main pane of the active tile. A split test sets
  // this to a distinct id.
  focusedId: undefined as string | null | undefined,
  // What `getMetadata` answers with — `undefined` for every terminal by default,
  // so only a test that pins a creator-passed `rightPanel` sees one.
  metadata: undefined as
    | { rightPanel?: RightPanelPerTerminalState }
    | undefined,
}));

vi.mock("../wire", () => ({
  // `reportToServer` writes via `activePadiRpc.chrome.setRightPanel`
  // (the active host's padi client) — the per-terminal collapsed/tab report path.
  activePadiRpc: {
    chrome: {
      get setRightPanel() {
        return h.host === "host-A" ? h.setRightPanel : h.saveOnOtherHost;
      },
    },
  },
  activeHost: () => h.host,
  padiRpcOf: (host: string) => ({
    chrome: {
      setRightPanel: host === "host-A" ? h.setRightPanel : h.saveOnOtherHost,
    },
  }),
  updatePreferences: h.updatePreferences,
  preferences: () => h.prefs,
}));

// A rejected `setRightPanel` (an application-level RPC failure on an otherwise
// live padi) must surface, not silently revert on reload — see `reportToServer`.
vi.mock("solid-sonner", () => ({ toast: { error: h.toastError } }));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    activeId: () => h.activeId,
    // Falls back to the active tile (= its main pane) unless a test focuses a
    // split — so every pre-split test keeps reading tile === pane.
    focusedTerminalId: () => h.focusedId ?? h.activeId,
    getMetadata: () => h.metadata,
  }),
}));

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({ tileCount: () => (h.activeId ? 1 : 0) }),
}));

import type { RightPanelPerTerminalState } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { useRightPanel } from "./useRightPanel";

beforeEach(() => {
  h.host = "host-A";
  h.saveOnOtherHost.mockClear();
  h.updatePreferences.mockClear();
  h.setRightPanel.mockClear();
  h.toastError.mockClear();
  h.activeId = null;
  h.focusedId = undefined;
  h.metadata = undefined;
  h.prefs = {
    newTerminalCollapsed: false,
    rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
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

// `collapsed` lives on the per-terminal `TerminalMetadata.rightPanel` record
// (#959), but it is the TILE's bit: each tile remembers whether its panel was
// showing, restored on session restore like the active tab. A toggle reports via
// `chrome.setRightPanel` (server-persisted), NEVER `updatePreferences`. The
// module-level `perTerminal` store persists across `useRightPanel()` calls, so
// each test uses distinct terminal ids.
describe("useRightPanel — collapsed is per-TILE (posture follows the tile)", () => {
  it("a toggle reports the active terminal's collapsed via setRightPanel, not preferences", () => {
    const a = "collapse-A" as TerminalId;
    h.activeId = a;
    const rp = useRightPanel();
    expect(rp.collapsed()).toBe(false); // a fresh terminal defaults open
    rp.togglePanel();
    expect(rp.collapsed()).toBe(true);
    expect(h.updatePreferences).not.toHaveBeenCalled();
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: a, collapsed: true }),
    );
  });

  it("each terminal remembers its own collapsed across an active-terminal switch", () => {
    const a = "collapse-switch-A" as TerminalId;
    const b = "collapse-switch-B" as TerminalId;
    const rp = useRightPanel();
    // Collapse A, leave B at its default (open).
    h.activeId = a;
    rp.collapsePanel();
    expect(rp.collapsed()).toBe(true);
    // Switch to B — it reads its OWN default (open), not A's collapse.
    h.activeId = b;
    expect(rp.collapsed()).toBe(false);
    // Back to A — A's collapse is restored.
    h.activeId = a;
    expect(rp.collapsed()).toBe(true);
  });

  it("a collapse is a no-op with no active terminal (empty workspace)", () => {
    h.activeId = null;
    const rp = useRightPanel();
    rp.collapsePanel();
    expect(h.setRightPanel).not.toHaveBeenCalled();
    expect(rp.collapsed()).toBe(false); // floors to the open default
  });

  it("surfaces a failed setRightPanel via toast (dedup id), not a silent DevTools log", async () => {
    h.activeId = "collapse-fail" as TerminalId;
    h.setRightPanel.mockImplementationOnce(() =>
      Effect.fail(new Error("padi rejected")),
    );
    const rp = useRightPanel();
    rp.togglePanel(); // optimistic state flips, the report fails
    // The recovery runs on the report's own fiber; let it settle.
    await Promise.resolve();
    expect(h.toastError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("padi rejected"),
      { id: "right-panel-report-failed" },
    );
  });

  it("a fresh terminal inherits the new-terminal default, then owns its own state", () => {
    // Pin the new-terminal default to collapsed.
    h.prefs = {
      newTerminalCollapsed: true,
      rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
    };
    const a = "collapse-seed-A" as TerminalId;
    h.activeId = a;
    const rp = useRightPanel();
    // No per-terminal record yet → reads the new-terminal default (collapsed).
    expect(rp.collapsed()).toBe(true);
    // Expanding writes the terminal's OWN record; the global preference is
    // never touched (a toggle is per-terminal, not a preference change).
    rp.expandPanel();
    expect(rp.collapsed()).toBe(false);
    expect(h.updatePreferences).not.toHaveBeenCalled();
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: a, collapsed: false }),
    );
  });
});

// The panel's SUBJECT is the focused pane, not the active tile: `collapsed`
// stays on the TILE while activeTab / codeMode / selectedFile / history follow
// the PANE (main or any split). Same module-level `perTerminal`, so distinct
// ids per test.
describe("useRightPanel — the panel follows the focused pane", () => {
  it("collapsed stays on the tile while the active tab follows the pane", () => {
    const tile = "fp-tile" as TerminalId;
    const split = "fp-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    // Move focus to the split and put IT on the Inspector tab.
    h.focusedId = split;
    rp.showInspector();
    expect(rp.activeTab()).toEqual({ kind: "inspector" });
    // Focus back to main — main's own default (Code) tab returns, and the
    // panel's posture (the TILE's) never moved.
    h.focusedId = undefined;
    expect(rp.activeTab().kind).toBe("code");
    expect(rp.collapsed()).toBe(false);
    // Focus the split again: ITS Inspector tab is restored, same posture.
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
    expect(rp.collapsed()).toBe(false);
  });

  it("a collapse targets the tile, never the focused split", () => {
    const tile = "fp-collapse-tile" as TerminalId;
    const split = "fp-collapse-split" as TerminalId;
    h.activeId = tile;
    h.focusedId = split;
    const rp = useRightPanel();
    rp.collapsePanel();
    expect(rp.collapsed()).toBe(true);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: tile, collapsed: true }),
    );
    // No write ever lands on the split for a visibility gesture.
    expect(h.setRightPanel).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: split }),
    );
  });

  it("each pane keeps its own per-mode selected file", () => {
    const tile = "fp-file-tile" as TerminalId;
    const split = "fp-file-split" as TerminalId;
    h.activeId = tile;
    h.focusedId = split;
    const rp = useRightPanel();
    rp.setSelectedFile("browse", "split-only.ts");
    expect(rp.selectedFile("browse")).toBe("split-only.ts");
    h.focusedId = undefined;
    expect(rp.selectedFile("browse")).toBeNull();
    rp.setSelectedFile("browse", "main-only.ts");
    expect(rp.selectedFile("browse")).toBe("main-only.ts");
    h.focusedId = split;
    expect(rp.selectedFile("browse")).toBe("split-only.ts");
  });

  it("navigation history is per pane", () => {
    const tile = "fp-hist-tile" as TerminalId;
    const split = "fp-hist-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    h.focusedId = undefined;
    rp.recordNavigation({ mode: "browse", path: "main.txt" });
    rp.recordNavigation({ mode: "browse", path: "main2.txt" });
    expect(rp.canNavigateBack()).toBe(true);
    // The split has its OWN stack — empty.
    h.focusedId = split;
    expect(rp.canNavigateBack()).toBe(false);
    rp.recordNavigation({ mode: "browse", path: "split.txt" });
    expect(rp.navigateBack()).toBeNull(); // a single-entry stack
    // Back to main: main's own earlier entry.
    h.focusedId = undefined;
    expect(rp.navigateBack()).toEqual({ mode: "browse", path: "main.txt" });
  });

  it("seedSplitTab seeds a new split from the pane it was split from", () => {
    const tile = "fp-seed-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.showInspector(); // the tile's main pane is on Inspector
    // The source is pinned at capture; a focus change before the create lands
    // must not change the seed.
    const initializePaneTab = rp.seedSplitTab(tile);
    h.focusedId = "fp-seed-other" as TerminalId;
    const split = "fp-seed-split" as TerminalId;
    initializePaneTab(split);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: split, activeTab: "inspector" }),
    );
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
  });

  it("seedSplitTab gives an externally-arrived split its parent's tab", () => {
    const tile = "fp-arrive-tile" as TerminalId;
    const split = "fp-arrive-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.showInspector(); // the tile (the split's parent) is on Inspector
    rp.seedSplitTab(tile)(split);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: split, activeTab: "inspector" }),
    );
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
  });

  it("seedSplitTab never overwrites a split that already has a record", () => {
    const tile = "fp-arrive2-tile" as TerminalId;
    const split = "fp-arrive2-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    // The split already carries its own state — its creator seeded it, or the
    // browser create path did before moving focus.
    h.focusedId = split;
    rp.showCode("branch");
    h.setRightPanel.mockClear();
    rp.seedSplitTab(tile)(split);
    expect(h.setRightPanel).not.toHaveBeenCalled();
    expect(rp.codeMode()).toBe("branch");
  });

  it("seedSplitTab adopts a record the creator passed instead of overwriting it", () => {
    const tile = "fp-arrive3-tile" as TerminalId;
    const split = "fp-arrive3-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    // The creator passed its own `rightPanel` on `lifecycle.create`; it is on the
    // terminal's metadata, and the client store must adopt it — not replace it
    // with the parent tile's tab.
    h.metadata = {
      rightPanel: {
        collapsed: false,
        activeTab: "inspector",
        codeMode: "branch",
      },
    };
    rp.seedSplitTab(tile)(split);
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
    expect(rp.codeMode()).toBe("branch");
    // Adopted, not reported back: the server already holds this record.
    expect(h.setRightPanel).not.toHaveBeenCalled();
  });

  it("adoptTileCollapsed hands a promoted split the posture of the tile it left", () => {
    const tile = "fp-promote-tile" as TerminalId;
    const split = "fp-promote-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.collapsePanel(); // the tile's panel is closed
    rp.adoptTileCollapsed(tile)(split);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: split, collapsed: true }),
    );
    // Once the split IS its own tile, its now-live collapsed reads closed.
    h.activeId = split;
    h.focusedId = undefined;
    expect(rp.collapsed()).toBe(true);
  });

  it("adoptTileCollapsed is a no-op when the from-tile IS the terminal", () => {
    const tile = "fp-self-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.collapsePanel();
    h.setRightPanel.mockClear();
    rp.adoptTileCollapsed(tile)(tile);
    expect(h.setRightPanel).not.toHaveBeenCalled();
  });
});

// `syncRepo` owns the per-terminal history-reset decision: a back/forward stack
// records repo-relative `{ mode, path }` locations with no repo identity, so it
// must be dropped when the terminal it belongs to moves to a different repo —
// but NOT when the user merely switches the active terminal between two repos.
// The decision is keyed per terminal (`history.get(id).lastRepo`), which is what lets
// it catch a repo change that happened while the terminal was INACTIVE (F6): a
// previous-active-tuple compare would see the switch-back as a plain terminal
// change and skip the reset, replaying repo-A history against repo A's new repo.
describe("useRightPanel — syncRepo scopes history per repo, per terminal", () => {
  // Drive history for whichever terminal is active, the way CodeTab does.
  function recordAt(id: TerminalId, ...paths: string[]): void {
    h.activeId = id;
    const rp = useRightPanel();
    for (const path of paths) rp.recordNavigation({ mode: "browse", path });
  }

  it("first sight records the baseline without resetting a seeded/built stack", () => {
    const a = "f6-first-A" as TerminalId;
    recordAt(a, "one.txt", "two.txt");
    const rp = useRightPanel();
    h.activeId = a;
    expect(rp.canNavigateBack()).toBe(true);
    // First syncRepo for this terminal just adopts its repo — history survives.
    rp.syncRepo(a, "/repo/A");
    expect(rp.canNavigateBack()).toBe(true);
  });

  it("a genuine repo change on the same terminal drops its history", () => {
    const a = "f6-cd-A" as TerminalId;
    recordAt(a, "one.txt", "two.txt");
    const rp = useRightPanel();
    h.activeId = a;
    rp.syncRepo(a, "/repo/A"); // baseline
    expect(rp.canNavigateBack()).toBe(true);
    rp.syncRepo(a, "/repo/A2"); // cd into another repo
    expect(rp.canNavigateBack()).toBe(false);
  });

  it("switching the active terminal between repos preserves each terminal's history (F5)", () => {
    const a = "f6-switch-A" as TerminalId;
    const b = "f6-switch-B" as TerminalId;
    const rp = useRightPanel();
    recordAt(a, "a1.txt", "a2.txt");
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    recordAt(b, "b1.txt", "b2.txt");
    h.activeId = b;
    rp.syncRepo(b, "/repo/B");
    // Switch back to A — same repo as before, so its history must be intact.
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    expect(rp.canNavigateBack()).toBe(true);
    // And B's is untouched too.
    h.activeId = b;
    rp.syncRepo(b, "/repo/B");
    expect(rp.canNavigateBack()).toBe(true);
  });

  it("resets a terminal whose repo changed WHILE INACTIVE, caught on switch-back (F6)", () => {
    const a = "f6-inactive-A" as TerminalId;
    const b = "f6-inactive-B" as TerminalId;
    const rp = useRightPanel();
    // A builds history in repo A and becomes the baseline.
    recordAt(a, "a1.txt", "a2.txt");
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    expect(rp.canNavigateBack()).toBe(true);
    // Switch to B; A is now inactive. (CodeTab only ever syncs the active id.)
    recordAt(b, "b1.txt");
    h.activeId = b;
    rp.syncRepo(b, "/repo/B");
    // While A was inactive its PTY cd'd into a different repo — the metadata
    // change reaches CodeTab only when A becomes active again. The previous
    // active tuple was (B, /repo/B), so a previous-tuple compare would treat
    // this as a plain terminal switch and SKIP the reset; per-terminal tracking
    // sees A's own repo moved (/repo/A → /repo/A2) and drops the stale stack.
    h.activeId = a;
    rp.syncRepo(a, "/repo/A2");
    expect(rp.canNavigateBack()).toBe(false);
  });
});

describe("new terminal panel visibility", () => {
  it.each([
    true,
    false,
  ])("inherits collapsed=%s before activation and persists it", (collapsed) => {
    const rp = useRightPanel();
    const previous = `previous-${collapsed}` as TerminalId;
    const next = `new-${collapsed}` as TerminalId;
    h.activeId = previous;
    collapsed ? rp.collapsePanel() : rp.expandPanel();
    const initializePanel = rp.adoptTileCollapsed(previous);
    // A focus change while the create RPC is pending must not change the seed.
    h.activeId = `other-${collapsed}`;
    h.host = "host-B";
    initializePanel(next);
    expect(h.saveOnOtherHost).not.toHaveBeenCalled();
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: next, collapsed }),
    );
    h.activeId = next;
    expect(rp.collapsed()).toBe(collapsed);
    collapsed ? rp.expandPanel() : rp.collapsePanel();
    h.activeId = previous;
    expect(rp.collapsed()).toBe(collapsed);
  });
});

describe("new panel initialization", () => {
  it.each([
    true,
    false,
  ])("uses the initial preference with no active terminal: %s", (collapsed) => {
    h.prefs.newTerminalCollapsed = collapsed;
    const rp = useRightPanel();
    // No active tile to inherit from — the seed falls back to the preference.
    const initializePanel = rp.adoptTileCollapsed(null);
    const id = `empty-${collapsed}` as TerminalId;
    initializePanel(id);
    h.activeId = id;
    expect(rp.collapsed()).toBe(collapsed);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id, collapsed }),
    );
  });

  it("preserves a tab selected before creation completes", () => {
    const rp = useRightPanel();
    const initializePanel = rp.adoptTileCollapsed(null);
    const id = "early-panel-interaction" as TerminalId;
    h.activeId = id;
    rp.showInspector();
    initializePanel(id);
    expect(rp.activeTab()).toEqual({ kind: "inspector" });
  });
});
