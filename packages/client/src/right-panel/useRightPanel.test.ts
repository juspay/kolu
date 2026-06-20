import { beforeEach, describe, expect, it, vi } from "vitest";

// useRightPanel reads `preferences()` and writes via `updatePreferences` from
// the wire singleton, resolves the active terminal from useTerminalStore, and
// gates `hasTerminals` on the tile registry's count. Stub all three so the size
// mutators can be exercised without a live socket (mocking useTileStore also
// keeps its persistCanvasLayout → solid-sonner chain out of the test env).
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

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({ tileCount: () => (h.activeId ? 1 : 0) }),
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

  it("a transient null repo (git re-resolving on a switch) keeps history", () => {
    // Regression: an OSC-7 prompt redraw on a terminal switch briefly drops
    // `meta.git.repoRoot` to null before it settles back to the SAME repo, so
    // `repoPath()` flickers repoA → null → repoA. The null tick must NOT read
    // as a repo change — otherwise it resets the stack and the Code tab's back
    // button never re-enables (the darwin-only flake this guards).
    const a = "f6-flicker-A" as TerminalId;
    recordAt(a, "one.txt", "two.txt");
    const rp = useRightPanel();
    h.activeId = a;
    rp.syncRepo(a, "/repo/A"); // baseline
    expect(rp.canNavigateBack()).toBe(true);
    rp.syncRepo(a, null); // transient re-resolve — must not wipe the stack
    rp.syncRepo(a, "/repo/A"); // settles back to the same repo
    expect(rp.canNavigateBack()).toBe(true);
  });

  it("a transient flip to another repo and back restores history (no wipe)", () => {
    // A terminal's repoPath() can briefly report a SIBLING terminal's repo on a
    // switch (a darwin git re-resolve under load) and revert. The flip is a
    // non-null repo change — indistinguishable from a real cd at the call site —
    // but it must not destroy history: stash-and-restore parks the real repo's
    // stack and brings it back when repoPath() reverts.
    const a = "f6-flip-A" as TerminalId;
    recordAt(a, "one.txt", "two.txt");
    const rp = useRightPanel();
    h.activeId = a;
    rp.syncRepo(a, "/repo/A"); // baseline — A's stack is live
    expect(rp.canNavigateBack()).toBe(true);
    rp.syncRepo(a, "/repo/B"); // transient flip to a sibling's repo
    expect(rp.canNavigateBack()).toBe(false); // B has no stack yet
    rp.syncRepo(a, "/repo/A"); // reverts — A's stack must come back intact
    expect(rp.canNavigateBack()).toBe(true);
  });
});
