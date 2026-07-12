/**
 * Session-restore fixture — the W1.R6 gate. `restoreSession` is now the ONE
 * restore writer (the client respawn loop is deleted), so this pins the host-side
 * outcome the client used to drive step-by-step:
 *
 *   - a reboot-killed ACTIVE record restores by CONSUMING its parked registry
 *     entry (the parked→active flip) and re-spawning a FRESH active PTY;
 *   - the saved recency (`lastActivityAt`) survives onto the fresh spawn (RISK Q6);
 *   - the saved active MARKER survives, mapped to the restored terminal's new id;
 *   - sub-terminals re-parent onto the FRESH parent id;
 *   - a top-level SLEEPING record restores DORMANT (kept id), never a live PTY;
 *   - a SLEPT SUB-TERMINAL (#1651) restores DORMANT under its now-live parent
 *     (honoring the saved state, F3), NOT as a fresh active split;
 *   - the parked→active flip is idempotent — a second `restoreSession` no-ops
 *     rather than duplicating a terminal;
 *   - per-terminal resume opt-out never DROPS a terminal (it only skips resume).
 *
 * The env has no kaval, so a fresh spawn's async tail rejects on a later
 * microtask (exactly the failed-spawn path the sleep/wake tests use); every
 * assertion reads the SYNCHRONOUS registry state `restoreSession` establishes
 * before that tail runs, then a macrotask lets the rejections settle.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import { getSavedSession, setSavedSession } from "./session.ts";
import { restoreSession } from "./sessionRestore.ts";
import {
  getTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { seedParkedTerminal } from "./terminalEndpoint/local.ts";
import {
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
  type SavedTerminal,
} from "./vocab.ts";

// Restore drives the discard path (`cleanupTerminalScratch`), which reads the
// per-instance scratch root. Boot injects the server id before any of this runs;
// mirror that here so the read hits the happy path, not the boot-order crash.
setDaemonProcessId("sessionrestore-test-server");

const PARENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLEEP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SLEPT_SUB_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const base = {
  git: null,
  pr: { kind: "absent" } as const,
  location: LOCAL_LOCATION,
};

// The reboot-killed session on disk: a top-level active parent (marked active)
// with a live sub + a SLEPT sub, plus a top-level sleeping terminal. The two
// ACTIVE records are the ones the boot parks (`seedParkedTerminal`), typed
// `SavedActiveTerminal` so the seed's signature is satisfied.
const parentRecord: SavedActiveTerminal = {
  ...base,
  id: PARENT_ID,
  state: "active",
  cwd: "/parent",
  lastActivityAt: 12345,
  restoreTarget: { kind: "none" },
};
const subRecord: SavedActiveTerminal = {
  ...base,
  id: SUB_ID,
  state: "active",
  cwd: "/sub",
  parentId: PARENT_ID,
  lastActivityAt: 200,
  restoreTarget: { kind: "none" },
};
const sleeperRecord: SavedTerminal = {
  ...base,
  id: SLEEP_ID,
  state: "sleeping",
  sleptAt: 111,
  cwd: "/sleep",
  lastActivityAt: 7,
};
const sleptSubRecord: SavedTerminal = {
  ...base,
  id: SLEPT_SUB_ID,
  state: "sleeping",
  sleptAt: 222,
  cwd: "/slept-sub",
  parentId: PARENT_ID,
  lastActivityAt: 9,
};

function savedSession(): SavedSession {
  return {
    terminals: [parentRecord, sleeperRecord, subRecord, sleptSubRecord],
    activeTerminalId: PARENT_ID,
    savedAt: 1,
  };
}

/** A PADI surface ctx whose `session` cell is a real in-memory store (so
 *  `setSavedSession` / `getSavedSession` — which read `padiSurfaceCtx.cells.session`
 *  now — round-trip), everything else no-op. */
function sessionBackedPadiCtx(): ReturnType<typeof noopPadiSurfaceCtxForTest> {
  const base = noopPadiSurfaceCtxForTest();
  let session: SavedSession | null = null;
  return {
    ...base,
    cells: new Proxy({} as never, {
      get: (_t, name) =>
        name === "session"
          ? {
              get: () => session,
              set: (v: SavedSession | null) => {
                session = v;
              },
              patch: () => {},
            }
          : (base.cells as Record<string, unknown>)[name as string],
    }),
  } as ReturnType<typeof noopPadiSurfaceCtxForTest>;
}

/** The live active entry seeded at `cwd` (fresh spawn re-observes cwd off
 *  `opts.cwd`), or undefined. Its id is the FRESH id `restoreSession` minted. */
function activeByCwd(
  cwd: string,
): { id: string; parentId?: string } | undefined {
  for (const [id, entry] of terminalEntries()) {
    if (entry.handle && entry.snapshot.cwd === cwd) {
      return { id, parentId: entry.meta.parentId };
    }
  }
  return undefined;
}

function clearRegistry(): void {
  for (const id of [...terminalEntries()].map(([id]) => id)) {
    unregisterTerminal(id);
  }
}

beforeEach(() => {
  setPadiSurfaceCtx(sessionBackedPadiCtx());
});

afterEach(async () => {
  // Let the kaval-less fresh spawns' async tails reject + unwind before the next
  // test seeds a fresh ctx.
  await new Promise((r) => setTimeout(r, 0));
  clearRegistry();
  __resetPadiSurfaceCtxForTest();
});

describe("restoreSession — parked→active restore (the W1.R6 gate)", () => {
  it("re-spawns actives fresh, keeps recency + active marker, re-parents subs, keeps sleepers dormant", async () => {
    setSavedSession(savedSession());
    // Boot parked the ACTIVE records (top-level parent + its live sub).
    expect(seedParkedTerminal(parentRecord)).toBe(true);
    expect(seedParkedTerminal(subRecord)).toBe(true);

    // Restore synchronously (the async spawn tails fire later); assert the
    // registry state the flip established before awaiting.
    const done = restoreSession({});

    // (a) The parked entries were CONSUMED — their old ids are gone.
    expect(getTerminal(PARENT_ID)).toBeUndefined();
    expect(getTerminal(SUB_ID)).toBeUndefined();

    // The top-level active re-spawned FRESH (new id), recency preserved (RISK Q6).
    const parent = activeByCwd("/parent");
    expect(parent).toBeDefined();
    expect(parent?.id).not.toBe(PARENT_ID);
    expect(getTerminal(parent?.id ?? "")?.meta.lastActivityAt).toBe(12345);
    expect(parent?.parentId).toBeUndefined();

    // (d) The live sub re-parented onto the FRESH parent id.
    const sub = activeByCwd("/sub");
    expect(sub).toBeDefined();
    expect(sub?.id).not.toBe(SUB_ID);
    expect(sub?.parentId).toBe(parent?.id);

    // (e) The top-level SLEEPING record restored DORMANT on its SAME id.
    const sleeper = getTerminal(SLEEP_ID);
    expect(sleeper?.meta.state).toBe("sleeping");
    expect(sleeper?.handle).toBeUndefined();

    // (f) The SLEPT SUB restored DORMANT (honoring the saved state) and
    // re-parented onto the FRESH parent (F3 — a sub hangs off a LIVE parent).
    const sleptSub = getTerminal(SLEPT_SUB_ID);
    expect(sleptSub?.meta.state).toBe("sleeping");
    expect(sleptSub?.handle).toBeUndefined();
    expect(sleptSub?.meta.parentId).toBe(parent?.id);

    // (c) The active marker survived, mapped to the restored parent's FRESH id.
    expect(getSavedSession()?.activeTerminalId).toBe(parent?.id);

    await done;
  });

  it("is idempotent — a concurrent second restore does not duplicate terminals", async () => {
    setSavedSession(savedSession());
    seedParkedTerminal(parentRecord);
    seedParkedTerminal(subRecord);

    // Fire two restores BACK-TO-BACK (the concurrent double-click / double-RPC
    // the parked→active flip guards). The first consumes every parked token
    // synchronously and re-persists the now-live session; the second reads that
    // live session and finds a live PTY already standing for each active id (and
    // no parked token), so it creates NO duplicate. (This runs synchronously
    // before the kaval-less spawn tails drop the shadows — the real production
    // race is exactly this window.)
    const first = restoreSession({});
    const second = restoreSession({});

    const parents = [...terminalEntries()].filter(
      ([, e]) => e.handle && e.snapshot.cwd === "/parent",
    );
    expect(parents).toHaveLength(1);
    const subs = [...terminalEntries()].filter(
      ([, e]) => e.handle && e.snapshot.cwd === "/sub",
    );
    expect(subs).toHaveLength(1);

    await Promise.all([first, second]);
  });

  it("resume opt-out never DROPS a terminal — an excluded active still restores", async () => {
    setSavedSession(savedSession());
    seedParkedTerminal(parentRecord);
    seedParkedTerminal(subRecord);

    // Opt OUT of resuming the parent (empty-ish set that excludes it). The
    // terminal must still come back — opt-out only skips the agent replay.
    const done = restoreSession({ resumeIds: [SUB_ID] });
    expect(activeByCwd("/parent")).toBeDefined();
    expect(activeByCwd("/sub")).toBeDefined();
    await done;
  });

  it("W12 — a resuming agent's restoreTarget survives the restore re-persist (not clobbered to none)", async () => {
    // Restore closes with `saveSession(snapshotSession())`. The fresh terminal must
    // carry the saved EXACT resume target on disk — BEFORE the fix, `createTerminal`
    // seeded no `restoreTarget`/`lastAgentCommand`, so that re-persist wrote `none`
    // and a second unclean death (or a resume that never landed) left a bare shell.
    const EXACT = {
      kind: "exact",
      command: "claude --model sonnet",
      agent: { kind: "claude-code", sessionId: "S1" },
    } as const;
    const agentRecord: SavedActiveTerminal = {
      ...base,
      id: PARENT_ID,
      state: "active",
      cwd: "/agent",
      lastActivityAt: 500,
      lastAgentCommand: "claude --model sonnet",
      restoreTarget: EXACT,
    };
    setSavedSession({
      terminals: [agentRecord],
      activeTerminalId: PARENT_ID,
      savedAt: 1,
    });
    seedParkedTerminal(agentRecord);

    const done = restoreSession({});

    const restored = getSavedSession()?.terminals.find(
      (t) => t.cwd === "/agent",
    );
    expect(restored).toBeDefined();
    expect(restored?.restoreTarget).toEqual(EXACT);
    expect(restored?.lastAgentCommand).toBe("claude --model sonnet");

    await done;
  });

  it("W12 — an OPTED-OUT agent restores to a bare shell: its exact target does NOT persist", async () => {
    // The inverse of the test above (F2). When the user opts OUT of resuming this
    // terminal's agent, the fresh terminal is a genuine BARE SHELL — seeding the saved
    // `exact` target would persist it (the bare shell's fold never clears it, having no
    // agent to re-derive from) and a later WAKE would resume the very agent the user
    // declined. So the seed is gated on `resume`: the opted-out terminal restores with
    // NO resume target on disk. `resumeFormFor(undefined/none)` → bare shell, so wake
    // can't replay the agent by construction.
    const EXACT = {
      kind: "exact",
      command: "claude --model sonnet",
      agent: { kind: "claude-code", sessionId: "S1" },
    } as const;
    const agentRecord: SavedActiveTerminal = {
      ...base,
      id: PARENT_ID,
      state: "active",
      cwd: "/agent",
      lastActivityAt: 500,
      lastAgentCommand: "claude --model sonnet",
      restoreTarget: EXACT,
    };
    setSavedSession({
      terminals: [agentRecord],
      activeTerminalId: PARENT_ID,
      savedAt: 1,
    });
    seedParkedTerminal(agentRecord);

    // Opt OUT of resuming this terminal (empty resume set).
    const done = restoreSession({ resumeIds: [] });

    const restored = getSavedSession()?.terminals.find(
      (t) => t.cwd === "/agent",
    );
    expect(restored).toBeDefined();
    expect(restored?.restoreTarget).toBeUndefined();
    expect(restored?.lastAgentCommand).toBeUndefined();

    await done;
  });
});
