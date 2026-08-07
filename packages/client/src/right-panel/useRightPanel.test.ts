import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

// useRightPanel reads `preferences()` and writes via `updatePreferences` from
// the wire singleton, resolves the active terminal from useTerminalStore, and
// gates `hasTerminals` on the tile registry's count. Stub all three so the size
// mutators can be exercised without a live socket (mocking useTileStore also
// keeps its persistCanvasLayout → solid-sonner chain out of the test env).
const h = vi.hoisted(() => ({
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
}));

vi.mock("../wire", () => ({
  // `reportToServer` writes via `activePadiRpc.chrome.setRightPanel`
  // (the active host's padi client) — the per-terminal collapsed/tab report path.
  activePadiRpc: { chrome: { setRightPanel: h.setRightPanel } },
  updatePreferences: h.updatePreferences,
  preferences: () => h.prefs,
}));

// A rejected `setRightPanel` (an application-level RPC failure on an otherwise
// live padi) must surface, not silently revert on reload — see `reportToServer`.
vi.mock("solid-sonner", () => ({ toast: { error: h.toastError } }));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({ activeId: () => h.activeId }),
}));

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({ tileCount: () => (h.activeId ? 1 : 0) }),
}));

import type { TerminalId } from "kolu-common/surface";
import { useRightPanel } from "./useRightPanel";

beforeEach(() => {
  h.updatePreferences.mockClear();
  h.setRightPanel.mockClear();
  h.toastError.mockClear();
  h.activeId = null;
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

// `collapsed` moved off the global `preferences.rightPanel` onto the per-terminal
// `TerminalMetadata.rightPanel` record (#959 completed): each terminal remembers
// whether its panel was showing, restored on session restore like the active tab.
// A toggle reports via `chrome.setRightPanel` (server-persisted), NEVER
// `updatePreferences`. The module-level `perTerminal` store persists across
// `useRightPanel()` calls, so each test uses distinct terminal ids.
describe("useRightPanel — collapsed is per-terminal (the panel follows the terminal)", () => {
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
