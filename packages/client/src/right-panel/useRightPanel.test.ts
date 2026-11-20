import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  activeId: null as string | null,
  focusedId: undefined as string | null | undefined,
  metadata: undefined as
    | { rightPanel?: RightPanelPerTerminalState; git?: GitFact }
    | undefined,
}));

vi.mock("../wire", () => ({
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

vi.mock("solid-sonner", () => ({ toast: { error: h.toastError } }));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    activeId: () => h.activeId,
    focusedTerminalId: () => h.focusedId ?? h.activeId,
    getMetadata: () => h.metadata,
  }),
}));

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({ tileCount: () => (h.activeId ? 1 : 0) }),
}));

import type { RightPanelPerTerminalState } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { GitFact } from "@kolu/terminal-vocab/schema";
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

describe("useRightPanel — collapsed is per-TILE (posture follows the tile)", () => {
  it("a toggle reports the active terminal's collapsed via setRightPanel, not preferences", () => {
    const a = "collapse-A" as TerminalId;
    h.activeId = a;
    const rp = useRightPanel();
    expect(rp.collapsed()).toBe(false);
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
    h.activeId = a;
    rp.collapsePanel();
    expect(rp.collapsed()).toBe(true);
    h.activeId = b;
    expect(rp.collapsed()).toBe(false);
    h.activeId = a;
    expect(rp.collapsed()).toBe(true);
  });

  it("a collapse is a no-op with no active terminal (empty workspace)", () => {
    h.activeId = null;
    const rp = useRightPanel();
    rp.collapsePanel();
    expect(h.setRightPanel).not.toHaveBeenCalled();
    expect(rp.collapsed()).toBe(false);
  });

  it("surfaces a failed setRightPanel via toast (dedup id), not a silent DevTools log", async () => {
    h.activeId = "collapse-fail" as TerminalId;
    h.setRightPanel.mockImplementationOnce(() =>
      Effect.fail(new Error("padi rejected")),
    );
    const rp = useRightPanel();
    rp.togglePanel();
    await Promise.resolve();
    expect(h.toastError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("padi rejected"),
      { id: "right-panel-report-failed" },
    );
  });

  it("a fresh terminal inherits the new-terminal default, then owns its own state", () => {
    h.prefs = {
      newTerminalCollapsed: true,
      rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
    };
    const a = "collapse-seed-A" as TerminalId;
    h.activeId = a;
    const rp = useRightPanel();
    expect(rp.collapsed()).toBe(true);
    rp.expandPanel();
    expect(rp.collapsed()).toBe(false);
    expect(h.updatePreferences).not.toHaveBeenCalled();
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: a, collapsed: false }),
    );
  });
});

describe("useRightPanel — the panel follows the focused pane", () => {
  it("collapsed stays on the tile while the active tab follows the pane", () => {
    const tile = "fp-tile" as TerminalId;
    const split = "fp-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    h.focusedId = split;
    rp.showInspector();
    expect(rp.activeTab()).toEqual({ kind: "inspector" });
    h.focusedId = undefined;
    expect(rp.activeTab().kind).toBe("code");
    expect(rp.collapsed()).toBe(false);
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
    expect(rp.collapsed()).toBe(false);
  });

  it("a bare repository's folder is browse-only, and the stored mode returns in a working tree", () => {
    const tile = "fp-bare-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.showCode("local");
    const info = {
      repoRoot: "/proj",
      repoName: "proj",
      worktreePath: "/proj",
      branch: "master",
      isWorktree: false,
      mainRepoRoot: "/proj",
      remoteUrl: null,
    };
    h.metadata = { git: { kind: "repo", info: { ...info, isBare: true } } };
    expect(rp.codeMode()).toBe("browse");
    expect(rp.activeTab()).toEqual({ kind: "code", mode: "browse" });
    h.metadata = { git: { kind: "repo", info: { ...info, isBare: false } } };
    expect(rp.codeMode()).toBe("local");
    expect(rp.activeTab()).toEqual({ kind: "code", mode: "local" });
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
    h.focusedId = split;
    expect(rp.canNavigateBack()).toBe(false);
    rp.recordNavigation({ mode: "browse", path: "split.txt" });
    expect(rp.navigateBack()).toBeNull();
    h.focusedId = undefined;
    expect(rp.navigateBack()).toEqual({ mode: "browse", path: "main.txt" });
  });

  it("seedSplitTab seeds a new split from the pane it was split from", () => {
    const tile = "fp-seed-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.showInspector();
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
    rp.showInspector();
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
    expect(h.setRightPanel).not.toHaveBeenCalled();
  });

  it("adoptTileCollapsed hands a promoted split the posture of the tile it left", () => {
    const tile = "fp-promote-tile" as TerminalId;
    const split = "fp-promote-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.collapsePanel();
    rp.adoptTileCollapsed(tile)(split);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: split, collapsed: true }),
    );
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

describe("useRightPanel — syncRepo scopes history per repo, per terminal", () => {
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
    rp.syncRepo(a, "/repo/A");
    expect(rp.canNavigateBack()).toBe(true);
  });

  it("a genuine repo change on the same terminal drops its history", () => {
    const a = "f6-cd-A" as TerminalId;
    recordAt(a, "one.txt", "two.txt");
    const rp = useRightPanel();
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    expect(rp.canNavigateBack()).toBe(true);
    rp.syncRepo(a, "/repo/A2");
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
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    expect(rp.canNavigateBack()).toBe(true);
    h.activeId = b;
    rp.syncRepo(b, "/repo/B");
    expect(rp.canNavigateBack()).toBe(true);
  });

  it("resets a terminal whose repo changed WHILE INACTIVE, caught on switch-back (F6)", () => {
    const a = "f6-inactive-A" as TerminalId;
    const b = "f6-inactive-B" as TerminalId;
    const rp = useRightPanel();
    recordAt(a, "a1.txt", "a2.txt");
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    expect(rp.canNavigateBack()).toBe(true);
    recordAt(b, "b1.txt");
    h.activeId = b;
    rp.syncRepo(b, "/repo/B");
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
