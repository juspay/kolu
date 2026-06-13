import * as assert from "node:assert";
import type { SavedSession, SavedTerminal } from "kolu-common/surface";
import { confStore } from "@kolu/surface/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { terminalsDirtyChannel } from "./publisher.ts";
import { __resetSurfaceCtxForTest, setSurfaceCtx } from "./surfaceCtx.ts";
import { store } from "./state.ts";
import {
  clearSavedSession,
  getSavedSession,
  initSessionAutoSave,
  saveSession,
  setPendingRestoreCard,
  setSavedSession,
} from "./session.ts";

// KOLU_STATE_DIR is set by the `test:unit` script in package.json to route
// conf state into $TMPDIR, keeping ~/.config clean. state.ts reads it at
// module load — no extra setup is needed here.

const terminal: SavedTerminal = {
  id: "term-1",
  cwd: "/home/user/project",
  git: {
    repoRoot: "/home/user/project",
    repoName: "project",
    worktreePath: "/home/user/project",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/home/user/project",
    remoteUrl: null,
  },
  lastActivityAt: 0,
};

describe("session persistence", () => {
  beforeAll(() => {
    // surface.ts is not imported by this test module (no full backend init),
    // so we supply a minimal ctx where cells.session is backed by the real
    // confStore. This makes writeSession → surfaceCtx.cells.session.set(v)
    // actually persist to the conf store, which getSavedSession() reads back.
    const sessionStore = confStore<SavedSession | null>(store, "session");
    setSurfaceCtx({
      cells: new Proxy({} as never, {
        get: (_, key) =>
          key === "session"
            ? sessionStore
            : { get: () => undefined, set: () => {}, patch: () => {} },
      }),
      collections: new Proxy({} as never, {
        get: () => ({
          upsert: () => {},
          remove: () => {},
          readAll: () => new Map(),
          readOne: () => undefined,
        }),
      }),
      events: new Proxy({} as never, { get: () => ({ publish: () => {} }) }),
    } as never);
  });

  afterAll(() => {
    clearSavedSession();
    __resetSurfaceCtxForTest();
  });

  it("returns null when no session is saved", () => {
    clearSavedSession();
    expect(getSavedSession()).toBeNull();
  });

  it("round-trips a saved session", () => {
    saveSession({
      terminals: [terminal],
      activeTerminalId: null,
    });
    const session = getSavedSession();
    assert.ok(session !== null, "session round-trip lost the saved value");
    expect(session.terminals).toHaveLength(1);
    expect(session.terminals[0]).toMatchObject({
      id: "term-1",
      cwd: "/home/user/project",
      git: { repoName: "project", branch: "main" },
    });
    expect(session.savedAt).toBeTypeOf("number");
  });

  it("clears session when saving empty terminals", () => {
    saveSession({
      terminals: [terminal],
      activeTerminalId: null,
    });
    expect(getSavedSession()).not.toBeNull();
    saveSession({
      terminals: [],
      activeTerminalId: null,
    });
    expect(getSavedSession()).toBeNull();
  });

  it("returns null when session has empty terminals array", () => {
    // Use setSavedSession to bypass the empty check in saveSession
    setSavedSession({ terminals: [], savedAt: Date.now() });
    expect(getSavedSession()).toBeNull();
  });

  it("preserves multiple terminals with array order", () => {
    const terminals: SavedTerminal[] = [
      { id: "a", cwd: "/a", git: null, lastActivityAt: 0 },
      { id: "b", cwd: "/b", git: null, lastActivityAt: 0 },
      { id: "c", cwd: "/c", git: null, parentId: "a", lastActivityAt: 0 },
    ];
    saveSession({ terminals, activeTerminalId: null });
    const session = getSavedSession();
    assert.ok(session !== null, "session round-trip lost the saved value");
    expect(session.terminals).toHaveLength(3);
    expect(session.terminals.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(session.terminals[2]?.parentId).toBe("a");
  });

  it("preserves themeName on round-trip", () => {
    const terminals: SavedTerminal[] = [
      {
        id: "a",
        cwd: "/a",
        git: null,
        themeName: "Dracula",
        lastActivityAt: 0,
      },
      { id: "b", cwd: "/b", git: null, lastActivityAt: 0 },
    ];
    saveSession({ terminals, activeTerminalId: null });
    const session = getSavedSession();
    assert.ok(session !== null, "session round-trip lost the saved value");
    expect(session.terminals[0]?.themeName).toBe("Dracula");
    expect(session.terminals[1]?.themeName).toBeUndefined();
  });

  it("preserves lastActivityAt on round-trip", () => {
    // Use real, distinct timestamps so a restore that drops the value
    // (resetting to 0) cannot pass by coincidence — fixtures of `0`
    // were the gap that hid the original restore-drops-recency bug.
    const t1 = 1_700_000_000_000;
    const t2 = 1_700_000_900_000;
    const terminals: SavedTerminal[] = [
      { id: "a", cwd: "/a", git: null, lastActivityAt: t1 },
      { id: "b", cwd: "/b", git: null, lastActivityAt: t2 },
    ];
    saveSession({ terminals, activeTerminalId: null });
    const session = getSavedSession();
    assert.ok(session !== null, "session round-trip lost the saved value");
    expect(session.terminals[0]?.lastActivityAt).toBe(t1);
    expect(session.terminals[1]?.lastActivityAt).toBe(t2);
  });

  it("clearSavedSession removes the session", () => {
    saveSession({
      terminals: [terminal],
      activeTerminalId: null,
    });
    expect(getSavedSession()).not.toBeNull();
    clearSavedSession();
    expect(getSavedSession()).toBeNull();
  });

  // F3 fail-closed guard: the partial-reconcile remainder (restore-card
  // terminals with no live PTY, hidden behind the empty-canvas restore gate)
  // must survive the survivors' `terminals:dirty` autosaves, which otherwise
  // re-snapshot only the LIVE terminals and delete the remainder from disk.
  // Nested here so it shares the outer `beforeAll` surfaceCtx (the autosave
  // loop's `saveSession` → `writeSession` needs the session cell).
  describe("partial-reconcile remainder survives autosave", () => {
    // `initSessionAutoSave` registers a PERMANENT `terminals:dirty` subscriber
    // (production calls it once at startup), so arm it ONCE here over a mutable
    // live ref — calling it per-test would leave each prior test's subscriber
    // alive and racing the next test's dirty event with a stale closure.
    let live: {
      terminals: SavedTerminal[];
      activeTerminalId: string | null;
    } = { terminals: [], activeTerminalId: null };
    beforeAll(() => {
      initSessionAutoSave(() => live);
    });
    afterEach(() => {
      setPendingRestoreCard([]);
      clearSavedSession();
      vi.useRealTimers();
    });

    /** Drive one autosave cycle: set the live snapshot the single subscriber
     *  reads, fire `terminals:dirty`, and let the 500ms throttle fire. */
    async function runAutosaveOnce(next: {
      terminals: SavedTerminal[];
      activeTerminalId: string | null;
    }): Promise<void> {
      live = next;
      vi.useFakeTimers();
      terminalsDirtyChannel.publish({});
      // Let the subscriber's async iterator deliver the published event, then
      // advance the throttle to fire the save.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(500);
    }

    it("autosave unions the pending restore card into a survivors-only snapshot", async () => {
      // Adopted survivors A, B are live; C survived only on the restore card.
      const live: SavedTerminal[] = [
        { id: "a", cwd: "/a", git: null, lastActivityAt: 1 },
        { id: "b", cwd: "/b", git: null, lastActivityAt: 2 },
      ];
      const remainder: SavedTerminal[] = [
        { id: "c", cwd: "/c", git: null, lastActivityAt: 3 },
      ];
      setPendingRestoreCard(remainder);

      await runAutosaveOnce({ terminals: live, activeTerminalId: "a" });

      const session = getSavedSession();
      assert.ok(session !== null, "autosave dropped the whole session");
      // C is NOT deleted — it rides the autosave union alongside live A, B.
      expect(session.terminals.map((t) => t.id).sort()).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("an explicit session write clears the pending set (no stale leak)", async () => {
      setPendingRestoreCard([
        { id: "c", cwd: "/c", git: null, lastActivityAt: 3 },
      ]);
      // A successful restore writes null; this must drop the pending remainder
      // so it can't reappear in a later autosave union.
      setSavedSession(null);

      await runAutosaveOnce({
        terminals: [{ id: "a", cwd: "/a", git: null, lastActivityAt: 1 }],
        activeTerminalId: "a",
      });

      const session = getSavedSession();
      assert.ok(
        session !== null,
        "autosave should have persisted the live set",
      );
      expect(session.terminals.map((t) => t.id)).toEqual(["a"]);
    });
  });
});
