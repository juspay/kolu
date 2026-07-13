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
import {
  persistSettledRestoreSnapshot,
  reconcileRestoreSettlement,
  restoreSession,
} from "./sessionRestore.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  parkedTerminalIds,
  registerTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import {
  seedParkedTerminal,
  TerminalSpawnRacedError,
} from "./terminalEndpoint/local.ts";
import { setTerminalTheme } from "./terminals.ts";
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

  // Shared fixtures for the two W12 restore-respawn tests: one saved ACTIVE record
  // carrying an EXACT resume target, seeded as BOTH the saved session and a parked
  // entry (restore's idempotency token). The tests differ only in the resume opt-in.
  const W12_EXACT = {
    kind: "exact",
    command: "claude --model sonnet",
    agent: { kind: "claude-code", sessionId: "S1" },
  } as const;
  const w12AgentRecord: SavedActiveTerminal = {
    ...base,
    id: PARENT_ID,
    state: "active",
    cwd: "/agent",
    lastActivityAt: 500,
    lastAgentCommand: "claude --model sonnet",
    restoreTarget: W12_EXACT,
  };
  const seedW12Agent = (): void => {
    setSavedSession({
      terminals: [w12AgentRecord],
      activeTerminalId: PARENT_ID,
      savedAt: 1,
    });
    seedParkedTerminal(w12AgentRecord);
  };
  const restoredW12Agent = () =>
    getSavedSession()?.terminals.find((t) => t.cwd === "/agent");

  it("W12 — a resuming agent's restoreTarget survives the restore re-persist (not clobbered to none)", async () => {
    // Restore closes with `saveSession(snapshotSession())`. The fresh terminal must
    // carry the saved EXACT resume target on disk — BEFORE the fix, `createTerminal`
    // seeded no `restoreTarget`/`lastAgentCommand`, so that re-persist wrote `none`
    // and a second unclean death (or a resume that never landed) left a bare shell.
    seedW12Agent();

    const done = restoreSession({});

    const restored = restoredW12Agent();
    expect(restored).toBeDefined();
    expect(restored?.restoreTarget).toEqual(W12_EXACT);
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
    seedW12Agent();

    // Opt OUT of resuming this terminal (empty resume set).
    const done = restoreSession({ resumeIds: [] });

    const restored = restoredW12Agent();
    expect(restored).toBeDefined();
    expect(restored?.restoreTarget).toBeUndefined();
    expect(restored?.lastAgentCommand).toBeUndefined();

    await done;
  });

  it("W12/CONF-6 — a spawn that FAILS mid-restore is re-parked under the FRESH id, NOT deleted", async () => {
    // The env has no kaval, so every fresh spawn's async tail rejects — exactly the
    // mid-restore kaval-death shape. `restoreSession` freezes the autosave across the
    // spawn window and re-parks each failed respawn, so the failure NEVER journals a
    // removal that would delete the terminal from the saved session (CONF-6).
    seedW12Agent();

    await restoreSession({}); // await the full spawn-settle + re-park

    // The saved session was NOT shrunk away — it still names a terminal (the optimistic
    // snapshot written before the tails rejected).
    const restored = restoredW12Agent();
    expect(restored).toBeDefined();
    // The failed respawn is re-parked under the SAME (fresh) id the durable snapshot
    // named — disk id and parked id MATCH, so a retry can consume the token (F1). The
    // OLD saved id was consumed by the parked→active flip and must NOT linger parked.
    expect(getTerminal(restored!.id)?.meta.state).toBe("parked");
    expect(getTerminal(PARENT_ID)).toBeUndefined();
    expect(parkedTerminalIds()).toHaveLength(1);
  });

  it("W12/F2 — a parked child under an ALREADY-LIVE parent restores (not dropped) on retry", async () => {
    // The mixed-outcome retry half of F2. After a PARTIAL mid-restore failure (the parent
    // spawn confirmed, a later child spawn's `ready` rejected) the live parent stays live
    // and only the child is re-parked. On the RETRY, `respawnActive` skips the already-live
    // parent — BEFORE the fix that skip produced NO `oldToNew` mapping, so the parked child
    // (`parentId` → the live parent) got `oldToNew.get(parent) === undefined` and was
    // DROPPED, leaving its token parked forever (pinning `hasParkedTerminals()`, suppressing
    // autosave). The fix maps the already-live parent to itself, so the child re-parents
    // onto the LIVE parent and restores. Here we seed that exact post-partial-failure state
    // directly (a live parent registered + a parked child under it).
    const LIVE_PARENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const CHILD_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const liveParent: ActiveTerminalProcess = {
      info: { id: LIVE_PARENT_ID, pid: 0 },
      meta: { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
      snapshot: {
        cwd: "/live-parent",
        git: null,
        pr: { kind: "absent" },
        agent: null,
        foreground: null,
      },
      handle: {} as ActiveTerminalProcess["handle"],
    };
    registerTerminal(LIVE_PARENT_ID, liveParent);
    const childRecord: SavedActiveTerminal = {
      ...base,
      id: CHILD_ID,
      state: "active",
      cwd: "/retry-child",
      parentId: LIVE_PARENT_ID,
      lastActivityAt: 42,
      restoreTarget: { kind: "none" },
    };
    // The child is the re-parked failed respawn from the first (partial) attempt.
    seedParkedTerminal(childRecord);
    // The disk session names both (the optimistic snapshot from the first attempt): the
    // parent is still active/live, the child active under it.
    setSavedSession({
      terminals: [
        {
          ...base,
          id: LIVE_PARENT_ID,
          state: "active",
          cwd: "/live-parent",
          lastActivityAt: 0,
          restoreTarget: { kind: "none" },
        },
        childRecord,
      ],
      activeTerminalId: LIVE_PARENT_ID,
      savedAt: 1,
    });

    const done = restoreSession({});

    // The parked child RESTORED to a fresh live PTY under the still-live parent — the old
    // parked token was consumed (not left to linger).
    const child = activeByCwd("/retry-child");
    expect(child).toBeDefined();
    expect(child?.id).not.toBe(CHILD_ID);
    expect(child?.parentId).toBe(LIVE_PARENT_ID);
    expect(getTerminal(CHILD_ID)).toBeUndefined();
    // The already-live parent was left untouched (a live PTY, never re-parked).
    expect(getTerminal(LIVE_PARENT_ID)?.meta.state).toBe("active");

    await done;
  });

  it("W12/F1 — a failed restore then a RETRY leaves NO orphan parked residue", async () => {
    // The F1 regression: re-parking under the OLD saved id (while the disk snapshot names
    // the FRESH id) desyncs the two identity spaces. A retry reads the fresh-id disk
    // record, can't consume the old-id park, spawns yet another terminal, and leaves the
    // old-id park orphaned FOREVER — and any lingering park pins `hasParkedTerminals()`
    // true, suppressing every future autosave. Re-parking under the fresh id keeps the
    // token consumable: each retry consumes the prior park and re-parks exactly one, so
    // the parked set never accumulates and the original id never re-appears.
    seedW12Agent();

    await restoreSession({}); // first attempt fails (no kaval) → one parked entry
    const firstParked = parkedTerminalIds();
    expect(firstParked).toHaveLength(1);

    await restoreSession({}); // retry: consume that park, fail again, re-park exactly one

    // Still exactly one parked entry — no accumulation, no orphan under the original id.
    expect(parkedTerminalIds()).toHaveLength(1);
    expect(getTerminal(PARENT_ID)).toBeUndefined();
    // And the surviving parked id matches the id the current saved snapshot names.
    const restored = restoredW12Agent();
    expect(restored).toBeDefined();
    expect(getTerminal(restored!.id)?.meta.state).toBe("parked");
  });
});

describe("reconcileRestoreSettlement — tree settlement (F2 / F3)", () => {
  const mkRecord = (
    id: string,
    cwd: string,
    parentId?: string,
  ): SavedActiveTerminal => ({
    ...base,
    id,
    state: "active",
    cwd,
    lastActivityAt: 1,
    restoreTarget: { kind: "none" },
    ...(parentId ? { parentId } : {}),
  });

  const liveEntry = (
    id: string,
    cwd: string,
    parentId?: string,
  ): ActiveTerminalProcess => ({
    info: { id, pid: 1 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      ...(parentId ? { parentId } : {}),
    },
    snapshot: {
      cwd,
      git: null,
      pr: { kind: "absent" },
      agent: null,
      foreground: null,
    },
    handle: {} as ActiveTerminalProcess["handle"],
  });

  it("F3 — a pre-ready KILL/SLEEP (typed race error) is NOT re-parked; a genuine spawn failure IS", () => {
    // A rejected `ready` carries WHY it rejected: `TerminalSpawnRacedError` is a second
    // client's kill/sleep mid-spawn (honor it — never resurrect as a restore card), while a
    // raw RPC error is a genuine infra spawn failure (re-park so the restore card re-offers).
    const killed = mkRecord("11111111-1111-4111-8111-111111111111", "/killed");
    const failed = mkRecord("22222222-2222-4222-8222-222222222222", "/failed");
    reconcileRestoreSettlement(
      [
        { newId: killed.id, record: killed, parentIdMapped: undefined },
        { newId: failed.id, record: failed, parentIdMapped: undefined },
      ],
      [
        { status: "rejected", reason: new TerminalSpawnRacedError() },
        {
          status: "rejected",
          reason: new Error("pty-host terminal.spawn failed"),
        },
      ],
    );
    expect(getTerminal(killed.id)).toBeUndefined();
    expect(getTerminal(failed.id)?.meta.state).toBe("parked");
  });

  it("F2 — a live child under an infra-failed (re-parked) parent is PROMOTED to top-level", () => {
    // The non-monotonic mixed outcome: the parent respawn rejects for a per-record reason
    // (a removed cwd) while its later-queued child spawn SUCCEEDS. Without the sweep the live
    // child would dangle under the now-parked parent (hidden on the canvas). It is reparented
    // to top-level, keeping its live PTY.
    const parent = mkRecord(
      "33333333-3333-4333-8333-333333333333",
      "/p2-parent",
    );
    const CHILD = "44444444-4444-4444-8444-444444444444";
    registerTerminal(CHILD, liveEntry(CHILD, "/p2-child", parent.id));
    const child = mkRecord(CHILD, "/p2-child", parent.id);
    reconcileRestoreSettlement(
      [
        { newId: parent.id, record: parent, parentIdMapped: undefined },
        { newId: CHILD, record: child, parentIdMapped: parent.id },
      ],
      [
        { status: "rejected", reason: new Error("spawn failed — removed cwd") },
        { status: "fulfilled", value: undefined },
      ],
    );
    expect(getTerminal(parent.id)?.meta.state).toBe("parked");
    expect(getTerminal(CHILD)?.meta.state).toBe("active");
    expect(getTerminal(CHILD)?.meta.parentId).toBeUndefined();
  });

  it("F2 — a live child under a still-LIVE parent is left untouched", () => {
    const PARENT = "55555555-5555-4555-8555-555555555555";
    const CHILD = "66666666-6666-4666-8666-666666666666";
    registerTerminal(PARENT, liveEntry(PARENT, "/p3-parent"));
    registerTerminal(CHILD, liveEntry(CHILD, "/p3-child", PARENT));
    const child = mkRecord(CHILD, "/p3-child", PARENT);
    reconcileRestoreSettlement(
      [{ newId: CHILD, record: child, parentIdMapped: PARENT }],
      [{ status: "fulfilled", value: undefined }],
    );
    expect(getTerminal(CHILD)?.meta.parentId).toBe(PARENT);
  });
});

describe("persistSettledRestoreSnapshot — post-settle persistence (F5)", () => {
  const LIVE_ID = "77777777-7777-4777-8777-777777777777";
  const liveEntry = (id: string, cwd: string): ActiveTerminalProcess => ({
    info: { id, pid: 1 },
    meta: { state: "active", location: LOCAL_LOCATION, lastActivityAt: 1 },
    snapshot: {
      cwd,
      git: null,
      pr: { kind: "absent" },
      agent: null,
      foreground: null,
    },
    handle: {} as ActiveTerminalProcess["handle"],
  });

  it("CLEAN settle — a padi-LOCAL metadata change made during the freeze window is persisted", () => {
    // The F5 loss: while the restore held the process-wide autosave freeze across the
    // spawn `await`, a live sibling's `setTerminalTheme` (a padi-local setter — no kaval
    // RPC) mutated in-memory state and fired `terminals:dirty`, which the freeze
    // suppressed and the caller's `cancelPendingAutosave` would drop. The pre-await
    // optimistic snapshot therefore omits it. The post-settle re-persist captures it.
    registerTerminal(LIVE_ID, liveEntry(LIVE_ID, "/f5-live"));
    setSavedSession({
      terminals: [
        {
          ...base,
          id: LIVE_ID,
          state: "active",
          cwd: "/f5-live",
          lastActivityAt: 1,
          restoreTarget: { kind: "none" },
          // stale on disk — the pre-await snapshot predates the theme change
        },
      ],
      activeTerminalId: LIVE_ID,
      savedAt: 1,
    });
    // The in-window mutation — exactly the setter class codex flagged (commits locally,
    // fires dirty, never touches kaval).
    setTerminalTheme(LIVE_ID as never, "dracula");

    persistSettledRestoreSnapshot();

    const saved = getSavedSession()?.terminals.find(
      (t) => t.cwd === "/f5-live",
    );
    expect(saved?.themeName).toBe("dracula");
  });

  it("PARKED residue — the pre-await optimistic snapshot is NOT shrunk (CONF-6)", () => {
    // A spawn FAILED and was re-parked in pass 1. `snapshotSession` skips parked records,
    // so a blind re-persist here would DELETE the re-parked terminal from disk. The guard
    // leaves the optimistic snapshot standing; restore-pending suppression takes over.
    const PARKED_ID = "88888888-8888-4888-8888-888888888888";
    const record: SavedActiveTerminal = {
      ...base,
      id: PARKED_ID,
      state: "active",
      cwd: "/f5-parked",
      lastActivityAt: 1,
      restoreTarget: { kind: "none" },
    };
    setSavedSession({
      terminals: [record],
      activeTerminalId: PARKED_ID,
      savedAt: 1,
    });
    seedParkedTerminal(record);

    persistSettledRestoreSnapshot();

    // Disk still names the re-parked terminal — not shrunk to an empty session.
    expect(
      getSavedSession()?.terminals.some((t) => t.cwd === "/f5-parked"),
    ).toBe(true);
  });
});
