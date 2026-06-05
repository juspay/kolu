import { beforeEach, describe, expect, it, vi } from "vitest";

// useRightPanel reads `preferences()` and writes via `updatePreferences` from
// the wire singleton, and resolves the active terminal from useTerminalStore.
// Stub both so the size mutators can be exercised without a live socket.
const h = vi.hoisted(() => ({
  updatePreferences: vi.fn(),
  setRightPanel: vi.fn(() => Promise.resolve()),
  prefs: {
    rightPanel: { collapsed: false, size: 0.25, codeTabTreeSize: 0.35 },
  },
  // Mutable so a test can flip the "active terminal" the way the workspace
  // switcher does at runtime — `recordNavigation`/`canNavigateBack` resolve
  // their terminal through this.
  activeId: null as string | null,
}));

vi.mock("../wire", () => ({
  client: { terminal: { setRightPanel: h.setRightPanel } },
  updatePreferences: h.updatePreferences,
  preferences: () => h.prefs,
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({ activeId: () => h.activeId }),
}));

import type { TerminalId } from "kolu-common/surface";
import { useRightPanel } from "./useRightPanel";

beforeEach(() => {
  h.updatePreferences.mockClear();
  h.setRightPanel.mockClear();
  h.activeId = null;
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

// `syncRepo` owns the per-terminal history-reset decision: a back/forward stack
// records repo-relative `{ mode, path }` locations with no repo identity, so it
// must be dropped when the terminal it belongs to moves to a different repo —
// but NOT when the user merely switches the active terminal between two repos.
// The decision is keyed per terminal (`lastRepoByTerminal`), which is what lets
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
