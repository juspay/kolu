import { describe, it, expect, afterAll } from "vitest";
import {
  saveSession,
  getSavedSession,
  clearSavedSession,
  setSavedSession,
} from "./session.ts";
import type { SavedTerminal } from "kolu-common";

const terminal: SavedTerminal = {
  id: "term-1",
  cwd: "/home/user/project",
  repoName: "project",
  branch: "main",
  sortOrder: 0,
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
    saveSession([terminal]);
    const session = getSavedSession();
    expect(session).not.toBeNull();
    expect(session!.terminals).toHaveLength(1);
    expect(session!.terminals[0]).toMatchObject({
      id: "term-1",
      cwd: "/home/user/project",
      repoName: "project",
      branch: "main",
    });
    expect(session!.savedAt).toBeTypeOf("number");
  });

  it("clears session when saving empty terminals", () => {
    saveSession([terminal]);
    expect(getSavedSession()).not.toBeNull();
    saveSession([]);
    expect(getSavedSession()).toBeNull();
  });

  it("returns null when session has empty terminals array", () => {
    // Use setSavedSession to bypass the empty check in saveSession
    setSavedSession({ terminals: [], savedAt: Date.now() });
    expect(getSavedSession()).toBeNull();
  });

  it("preserves multiple terminals with ordering", () => {
    const terminals: SavedTerminal[] = [
      { id: "a", cwd: "/a", sortOrder: 0 },
      { id: "b", cwd: "/b", sortOrder: 1 },
      { id: "c", cwd: "/c", parentId: "a", sortOrder: 2 },
    ];
    saveSession(terminals);
    const session = getSavedSession();
    expect(session!.terminals).toHaveLength(3);
    expect(session!.terminals.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(session!.terminals[2]!.parentId).toBe("a");
  });

  it("preserves themeName on round-trip", () => {
    const terminals: SavedTerminal[] = [
      { id: "a", cwd: "/a", sortOrder: 0, themeName: "Dracula" },
      { id: "b", cwd: "/b", sortOrder: 1 },
    ];
    saveSession(terminals);
    const session = getSavedSession();
    expect(session!.terminals[0]!.themeName).toBe("Dracula");
    expect(session!.terminals[1]!.themeName).toBeUndefined();
  });

  it("clearSavedSession removes the session", () => {
    saveSession([terminal]);
    expect(getSavedSession()).not.toBeNull();
    clearSavedSession();
    expect(getSavedSession()).toBeNull();
  });
});
