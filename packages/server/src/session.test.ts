import { unwrap } from "kolu-common/unwrap";
import type { SavedTerminal } from "kolu-common";
import { afterAll, describe, expect, it } from "vitest";
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
  },
};

describe("session persistence", () => {
  afterAll(() => {
    clearSavedSession();
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
    const session = unwrap(
      getSavedSession(),
      "session round-trip lost the saved value",
    );
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
      { id: "a", cwd: "/a", git: null },
      { id: "b", cwd: "/b", git: null },
      { id: "c", cwd: "/c", git: null, parentId: "a" },
    ];
    saveSession({ terminals, activeTerminalId: null });
    const session = unwrap(
      getSavedSession(),
      "session round-trip lost the saved value",
    );
    expect(session.terminals).toHaveLength(3);
    expect(session.terminals.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(session.terminals[2]?.parentId).toBe("a");
  });

  it("preserves themeName on round-trip", () => {
    const terminals: SavedTerminal[] = [
      { id: "a", cwd: "/a", git: null, themeName: "Dracula" },
      { id: "b", cwd: "/b", git: null },
    ];
    saveSession({ terminals, activeTerminalId: null });
    const session = unwrap(
      getSavedSession(),
      "session round-trip lost the saved value",
    );
    expect(session.terminals[0]?.themeName).toBe("Dracula");
    expect(session.terminals[1]?.themeName).toBeUndefined();
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
