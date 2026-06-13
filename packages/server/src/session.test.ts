import * as assert from "node:assert";
import type { SavedSession, SavedTerminal } from "kolu-common/surface";
import { confStore } from "@kolu/surface/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { __resetSurfaceCtxForTest, setSurfaceCtx } from "./surfaceCtx.ts";
import { store } from "./state.ts";
import {
  clearSavedSession,
  getSavedSession,
  saveSession,
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
});
