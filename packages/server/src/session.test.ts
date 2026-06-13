import * as assert from "node:assert";
import { confStore } from "@kolu/surface/server";
import type { SavedSession, SavedTerminal } from "kolu-common/surface";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { terminalsDirtyChannel } from "./publisher.ts";
import {
  clearSavedSession,
  getSavedSession,
  initSessionAutoSave,
  saveSession,
  setSavedSession,
  setSavedSessionFromSnapshot,
} from "./session.ts";
import { store } from "./state.ts";
import { __resetSurfaceCtxForTest, setSurfaceCtx } from "./surfaceCtx.ts";

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

// The F1 receptacle (B3.2): a snapshot-shaped saved-session write that also
// cancels any pending autosave, so the restart-capture path can persist the
// session before the daemon is killed without a stale `terminals:dirty` timer
// clobbering it.
describe("setSavedSessionFromSnapshot — the F1 receptacle", () => {
  beforeAll(() => {
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

  it("PRESERVES an existing saved session when the snapshot is empty (F1)", () => {
    // The restart-capture path on a `dead`/empty registry: the live snapshot has
    // no terminals, but a saved session from a prior run is still on disk and is
    // the only restore data the user has. Capturing must NOT clear it — routing
    // an empty snapshot through `saveSession` (empty→null) would erase the
    // restore data before the recycle, the kill-then-pray data loss F1 guards.
    saveSession({ terminals: [terminal], activeTerminalId: null });
    expect(getSavedSession()).not.toBeNull();
    setSavedSessionFromSnapshot({ terminals: [], activeTerminalId: null });
    const session = getSavedSession();
    assert.ok(
      session !== null,
      "empty capture clobbered the pre-existing session",
    );
    expect(session.terminals[0]?.id).toBe("term-1");
  });

  it("leaves a null session null when the snapshot is empty (no spurious write)", () => {
    clearSavedSession();
    expect(getSavedSession()).toBeNull();
    setSavedSessionFromSnapshot({ terminals: [], activeTerminalId: null });
    expect(getSavedSession()).toBeNull();
  });

  it("persists a non-empty snapshot with its active id", () => {
    setSavedSessionFromSnapshot({
      terminals: [terminal],
      activeTerminalId: "term-1",
    });
    const session = getSavedSession();
    assert.ok(session !== null, "snapshot capture lost the saved value");
    expect(session.terminals).toHaveLength(1);
    expect(session.activeTerminalId).toBe("term-1");
    expect(session.savedAt).toBeTypeOf("number");
  });

  it("cancels a pending autosave so the capture isn't clobbered (the race)", async () => {
    // The autosave loop here snapshots an EMPTY terminal set — the stale
    // post-`killAll` state of a drain. Arm it with a `terminals:dirty` event,
    // then capture a real session via the receptacle BEFORE the 500ms autosave
    // fires. The receptacle must cancel the pending timer; otherwise the empty
    // autosave overwrites the capture with `null` ~500ms later — exactly the
    // mid-restart data-loss the F1 guard exists to prevent.
    const tick = () => new Promise((r) => setTimeout(r, 10));
    let autosaveFired = 0;
    initSessionAutoSave(() => {
      autosaveFired += 1;
      return { terminals: [], activeTerminalId: null };
    });
    await tick(); // let the subscription register
    terminalsDirtyChannel.publish({}); // arm the stale autosave
    await tick(); // let the loop schedule the 500ms timer

    setSavedSessionFromSnapshot({
      terminals: [terminal],
      activeTerminalId: null,
    });
    expect(getSavedSession()).not.toBeNull();

    await new Promise((r) => setTimeout(r, 650)); // past the autosave window
    // The cancel held: the autosave's snapshot callback never ran, and the
    // captured session survived rather than being clobbered to null.
    expect(autosaveFired).toBe(0);
    expect(getSavedSession()?.terminals[0]?.id).toBe("term-1");
  });
});
