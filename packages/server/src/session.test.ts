import * as assert from "node:assert";
import { SavedSessionSchema, type SavedTerminal } from "kolu-common/surface";
import { afterAll, describe, expect, it } from "vitest";
import {
  clearSavedSession,
  getSavedSession,
  saveSession,
  setSavedSession,
} from "./session.ts";
import { injectLocalLocation } from "./state.ts";

// KOLU_STATE_DIR is set by the `test:unit` script in package.json to route
// conf state into $TMPDIR, keeping ~/.config clean. state.ts reads it at
// module load — no extra setup is needed here.

const terminal: SavedTerminal = {
  id: "term-1",
  location: { kind: "local" },
  cwd: "/home/user/project",
  git: {
    repoRoot: "/home/user/project",
    repoName: "project",
    worktreePath: "/home/user/project",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/home/user/project",
  },
  lastActivityAt: 0,
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
      {
        id: "a",
        location: { kind: "local" },
        cwd: "/a",
        git: null,
        lastActivityAt: 0,
      },
      {
        id: "b",
        location: { kind: "local" },
        cwd: "/b",
        git: null,
        lastActivityAt: 0,
      },
      {
        id: "c",
        location: { kind: "local" },
        cwd: "/c",
        git: null,
        parentId: "a",
        lastActivityAt: 0,
      },
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
        location: { kind: "local" },
        cwd: "/a",
        git: null,
        themeName: "Dracula",
        lastActivityAt: 0,
      },
      {
        id: "b",
        location: { kind: "local" },
        cwd: "/b",
        git: null,
        lastActivityAt: 0,
      },
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
      {
        id: "a",
        location: { kind: "local" },
        cwd: "/a",
        git: null,
        lastActivityAt: t1,
      },
      {
        id: "b",
        location: { kind: "local" },
        cwd: "/b",
        git: null,
        lastActivityAt: t2,
      },
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

// ────────────────────────────────────────────────────────────────
//  R-1 migration: old saved sessions (without `location`/
//  `connectionState`) must round-trip cleanly. Two paths cover the
//  contract:
//
//    1. **On-disk migration** (`state.ts:"1.24.0"` → `injectLocalLocation`)
//       — what real users hit when their kolu first boots into R-1.
//       Stamps `location: { kind: "local" }` onto every saved terminal
//       that doesn't already have one. Idempotent on already-migrated
//       data.
//    2. **Schema default** (`TerminalLocationSchema.default(...)` on
//       `ServerPersistedTerminalFieldsSchema`) — secondary safety net
//       for disk shapes that somehow skip the Conf migration (e.g.
//       tests bypassing the Conf instance). `SavedSessionSchema.parse`
//       on a pre-R-1 blob succeeds and fills in the default.
//
//  Both layers MUST hold; either alone is brittle. Migration is the
//  forward fix; schema default is the recovery path. Tested
//  independently so a regression in one doesn't hide behind the other.
// ────────────────────────────────────────────────────────────────
describe("R-1 saved-session migration", () => {
  /** Golden fixture: shape a kolu shipped before R-1 wrote to disk.
   *  No `location` field. Other fields match what `snapshotSession()`
   *  produced on master @ b5413c60. */
  const preR1Terminals = [
    {
      id: "pre-r1-a",
      cwd: "/home/user/old-project",
      git: {
        repoRoot: "/home/user/old-project",
        repoName: "old-project",
        worktreePath: "/home/user/old-project",
        branch: "main",
        isWorktree: false,
        mainRepoRoot: "/home/user/old-project",
      },
      themeName: "Solarized",
      lastActivityAt: 1_700_000_000_000,
    },
    {
      id: "pre-r1-b",
      cwd: "/tmp",
      git: null,
      parentId: "pre-r1-a",
      lastActivityAt: 0,
    },
  ];

  it("injectLocalLocation stamps `{ kind: 'local' }` on legacy terminals", () => {
    const migrated = preR1Terminals.map(injectLocalLocation);
    expect(migrated[0]?.location).toEqual({ kind: "local" });
    expect(migrated[1]?.location).toEqual({ kind: "local" });
    // Original fields survive byte-equal.
    expect(migrated[0]?.themeName).toBe("Solarized");
    expect((migrated[0]?.git as { repoName?: string } | null)?.repoName).toBe(
      "old-project",
    );
    expect(migrated[1]?.parentId).toBe("pre-r1-a");
  });

  it("injectLocalLocation is idempotent", () => {
    const once = preR1Terminals.map(injectLocalLocation);
    const twice = once.map(injectLocalLocation);
    expect(twice).toEqual(once);
  });

  it("SavedSessionSchema.parse on a pre-R-1 blob fills the default", () => {
    // The schema's `.default({ kind: "local" })` is the safety net for
    // disk shapes that skip the Conf migration. Direct parse to verify
    // the schema accepts old terminals and produces the post-R-1 shape.
    const result = SavedSessionSchema.safeParse({
      terminals: preR1Terminals,
      activeTerminalId: "pre-r1-a",
      savedAt: 1_700_000_900_000,
    });
    assert.ok(
      result.success,
      `pre-R-1 fixture must parse cleanly: ${
        result.success ? "ok" : JSON.stringify(result.error.issues)
      }`,
    );
    expect(result.data.terminals[0]?.location).toEqual({ kind: "local" });
    expect(result.data.terminals[1]?.location).toEqual({ kind: "local" });
  });

  it("migrated terminals round-trip through saveSession/getSavedSession", () => {
    // End-to-end: take a fixture-migrated session, write it, read it
    // back, verify location survives and no field disappears on the
    // second save (the "field disappears on resave" bug class).
    const migratedTerminals = preR1Terminals.map(injectLocalLocation);
    saveSession({
      terminals: migratedTerminals as unknown as SavedTerminal[],
      activeTerminalId: "pre-r1-a",
    });
    const reloaded = getSavedSession();
    assert.ok(reloaded !== null, "round-trip lost the saved value");
    expect(reloaded.terminals[0]?.location).toEqual({ kind: "local" });
    expect(reloaded.terminals[0]?.themeName).toBe("Solarized");
    expect(reloaded.terminals[1]?.location).toEqual({ kind: "local" });
    expect(reloaded.terminals[1]?.parentId).toBe("pre-r1-a");
    clearSavedSession();
  });
});
