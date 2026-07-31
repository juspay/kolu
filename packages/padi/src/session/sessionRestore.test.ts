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
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { getSavedSession, setSavedSession } from "./session.ts";
import {
  persistSettledRestoreSnapshot,
  restoreSession,
  settleRestoreRespawns,
} from "./sessionRestore.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  parkedTerminalIds,
  registerTerminal,
  terminalEntries,
  unregisterTerminal,
} from "../terminal-registry.ts";
import {
  seedParkedTerminal,
  TerminalSpawnRacedError,
} from "../terminalEndpoint/local.ts";
import { setTerminalTheme } from "../terminals.ts";
import {
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
  type SavedTerminal,
} from "../vocab.ts";

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
  // Default fixture: a parented terminal running an agent — the class of
  // record the client used to drop from the resume set.
  lastAgentCommand: "claude --permission-mode auto",
  restoreTarget: {
    kind: "exact",
    command: "claude --permission-mode auto",
    agent: {
      kind: "claude-code",
      sessionId: "12341234-1234-1234-1234-123412341234",
    },
  },
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

    // Opt OUT of resuming the parent. The terminal must still come back —
    // opt-out only skips the agent replay.
    const done = restoreSession({
      resumeAgents: true,
      optOutIds: [PARENT_ID],
    });
    expect(activeByCwd("/parent")).toBeDefined();
    expect(activeByCwd("/sub")).toBeDefined();
    await done;
  });

  // Shared fixtures for the two W12 restore-respawn tests: one saved ACTIVE record
  // carrying an EXACT resume target, seeded as BOTH the saved session and a parked
  // entry (restore's idempotency token). The tests differ only in the resume opt-in.
  // Session id must pass the shell-safe UUID gate so the host-owned
  // resumable fold counts this terminal (matches wake / resumeFormFor).
  const W12_EXACT = {
    kind: "exact",
    command: "claude --model sonnet",
    agent: {
      kind: "claude-code",
      sessionId: "12341234-1234-1234-1234-123412341234",
    },
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

    // Opt OUT of resuming this terminal entirely.
    const done = restoreSession({ resumeAgents: false });

    const restored = restoredW12Agent();
    expect(restored).toBeDefined();
    expect(restored?.restoreTarget).toBeUndefined();
    expect(restored?.lastAgentCommand).toBeUndefined();

    await done;
  });

  it("missing-parent unrestored keeps restoreTarget after sibling spawn settles", async () => {
    // One valid active + an orphaned child (parent id not in the session). The
    // optimistic write merges the orphan; a later settle write must NOT drop it
    // (and its exact resume token) before the loud incomplete-restore error.
    const orphanId = "deadbeef-dead-4beef-8bee-deadbeefdead";
    const orphanExact = {
      kind: "exact" as const,
      command: "claude --model sonnet",
      agent: {
        kind: "claude-code" as const,
        sessionId: "12341234-1234-1234-1234-123412341234",
      },
    };
    const orphan: SavedActiveTerminal = {
      ...base,
      id: orphanId,
      state: "active",
      cwd: "/orphan",
      parentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", // not in session
      lastActivityAt: 9,
      lastAgentCommand: "claude --model sonnet",
      restoreTarget: orphanExact,
    };
    setSavedSession({
      terminals: [parentRecord, orphan],
      activeTerminalId: PARENT_ID,
      savedAt: 1,
    });
    seedParkedTerminal(parentRecord);
    seedParkedTerminal(orphan);

    await expect(restoreSession({})).rejects.toThrow(/missing parent/);

    const saved = getSavedSession();
    const kept = saved?.terminals.find((t) => t.id === orphanId);
    expect(kept).toBeDefined();
    expect(kept?.restoreTarget).toEqual(orphanExact);
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
        ports: { status: "unknown" },
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

describe("settleRestoreRespawns — independent per-spawn settlement (F2 / F3 / F5)", () => {
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
      ports: { status: "unknown" },
    },
    handle: {} as ActiveTerminalProcess["handle"],
  });

  it("F3 — a pre-ready KILL/SLEEP (typed race error) is NOT re-parked; a genuine spawn failure IS", async () => {
    // A rejected `ready` carries WHY it rejected: `TerminalSpawnRacedError` is a second
    // client's kill/sleep mid-spawn (honor it — never resurrect as a restore card), while a
    // raw RPC error is a genuine infra spawn failure (re-park so the restore card re-offers).
    const killed = mkRecord("11111111-1111-4111-8111-111111111111", "/killed");
    const failed = mkRecord("22222222-2222-4222-8222-222222222222", "/failed");
    await settleRestoreRespawns([
      {
        ready: Promise.reject(new TerminalSpawnRacedError()),
        newId: killed.id,
        record: killed,
        parentIdMapped: undefined,
      },
      {
        ready: Promise.reject(new Error("pty-host terminal.spawn failed")),
        newId: failed.id,
        record: failed,
        parentIdMapped: undefined,
      },
    ]);
    expect(getTerminal(killed.id)).toBeUndefined();
    expect(getTerminal(failed.id)?.meta.state).toBe("parked");
  });

  it("F2 — a live child under an infra-failed (re-parked) parent is PROMOTED to top-level", async () => {
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
    await settleRestoreRespawns([
      {
        ready: Promise.reject(new Error("spawn failed — removed cwd")),
        newId: parent.id,
        record: parent,
        parentIdMapped: undefined,
      },
      {
        ready: Promise.resolve(),
        newId: CHILD,
        record: child,
        parentIdMapped: parent.id,
      },
    ]);
    expect(getTerminal(parent.id)?.meta.state).toBe("parked");
    expect(getTerminal(CHILD)?.meta.state).toBe("active");
    expect(getTerminal(CHILD)?.meta.parentId).toBeUndefined();
  });

  it("F2 — a SLEEPING sub under an infra-failed (re-parked) parent is promoted too", async () => {
    // The residual the batch-scoped sweep could not reach (#2059): a slept split
    // (#1651) is seeded SYNCHRONOUSLY during restore and never joins the respawn
    // list, so a sweep keyed on that list was blind to it. Its parent then fails
    // and re-parks — and a parked parent is filtered out of the canvas entirely,
    // so the sleeper became a dormant tile the user could never reach again.
    // Reading the live REGISTRY rather than the respawn list is what covers it.
    const parent = mkRecord(
      "77777777-7777-4777-8777-777777777777",
      "/p4-parent",
    );
    const SLEEPER = "88888888-8888-4888-8888-888888888888";
    registerTerminal(SLEEPER, {
      info: { id: SLEEPER, pid: 0 },
      meta: {
        state: "sleeping",
        location: LOCAL_LOCATION,
        lastActivityAt: 1,
        sleptAt: 1,
        parentId: parent.id,
      },
      snapshot: {
        cwd: "/p4-sleeper",
        git: null,
        pr: { kind: "absent" },
        agent: null,
        foreground: null,
        ports: { status: "unknown" },
      },
    });

    await settleRestoreRespawns([
      {
        ready: Promise.reject(new Error("spawn failed — removed cwd")),
        newId: parent.id,
        record: parent,
        parentIdMapped: undefined,
      },
    ]);

    expect(getTerminal(parent.id)?.meta.state).toBe("parked");
    // Still dormant — the repair moves a tile, it never wakes or drops one.
    expect(getTerminal(SLEEPER)?.meta.state).toBe("sleeping");
    expect(getTerminal(SLEEPER)?.meta.parentId).toBeUndefined();
  });

  it("F2 — a PARKED child's saved split is NOT flattened", async () => {
    // A parked record is a restore-card placeholder, and its parentId is how the
    // card will restore the split. The repair must leave it alone even when its
    // parent is unpaintable, or the user's saved grouping is silently un-grouped.
    const parent = mkRecord(
      "99999999-9999-4999-8999-999999999999",
      "/p5-parent",
    );
    const PARKED_CHILD = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
    registerTerminal(PARKED_CHILD, {
      info: { id: PARKED_CHILD, pid: 0 },
      meta: {
        state: "parked",
        location: LOCAL_LOCATION,
        lastActivityAt: 1,
        parkedAt: 1,
        parentId: parent.id,
      },
      snapshot: {
        cwd: "/p5-child",
        git: null,
        pr: { kind: "absent" },
        agent: null,
        foreground: null,
        ports: { status: "unknown" },
      },
    });

    await settleRestoreRespawns([
      {
        ready: Promise.reject(new Error("spawn failed — removed cwd")),
        newId: parent.id,
        record: parent,
        parentIdMapped: undefined,
      },
    ]);

    expect(getTerminal(PARKED_CHILD)?.meta.parentId).toBe(parent.id);
  });

  it("F2 — a live child under a still-LIVE parent is left untouched", async () => {
    const PARENT = "55555555-5555-4555-8555-555555555555";
    const CHILD = "66666666-6666-4666-8666-666666666666";
    registerTerminal(PARENT, liveEntry(PARENT, "/p3-parent"));
    registerTerminal(CHILD, liveEntry(CHILD, "/p3-child", PARENT));
    const child = mkRecord(CHILD, "/p3-child", PARENT);
    await settleRestoreRespawns([
      {
        ready: Promise.resolve(),
        newId: CHILD,
        record: child,
        parentIdMapped: PARENT,
      },
    ]);
    expect(getTerminal(CHILD)?.meta.parentId).toBe(PARENT);
  });

  it("F5 — a spawn whose `ready` NEVER settles does not block re-parking a sibling that DID fail", async () => {
    // The wedged-kaval residual codex sharpened: one respawn's `ready` never settles (socket
    // open, `spawn` never answered). Because the settlement is per-spawn — NOT an
    // `await Promise.allSettled` under a held freeze — a SIBLING that genuinely failed is
    // still re-parked and RETAINED on disk while the wedged spawn hangs, so no live sibling's
    // persistence is pinned for the process lifetime.
    const wedged = mkRecord("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "/wedged");
    const failed = mkRecord(
      "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
      "/failed-sib",
    );
    setSavedSession({
      terminals: [wedged, failed],
      activeTerminalId: wedged.id,
      savedAt: 1,
    });
    // The wedged spawn's `ready` never resolves or rejects — a permanently-pending RPC.
    const settle = settleRestoreRespawns([
      {
        ready: new Promise<void>(() => {}),
        newId: wedged.id,
        record: wedged,
        parentIdMapped: undefined,
      },
      {
        ready: Promise.reject(new Error("spawn failed")),
        newId: failed.id,
        record: failed,
        parentIdMapped: undefined,
      },
    ]);
    // Let the failed sibling's rejection microtask chain drain. `settle` itself stays PENDING
    // forever (the wedged spawn never settles), so we deliberately do NOT await it.
    await new Promise((r) => setTimeout(r, 0));
    void settle;

    // The failed sibling was re-parked and its record retained on disk — all WITHOUT the
    // wedged spawn settling.
    expect(getTerminal(failed.id)?.meta.state).toBe("parked");
    expect(
      getSavedSession()?.terminals.some((t) => t.cwd === "/failed-sib"),
    ).toBe(true);
  });

  it("F2 — a live child of a re-parked parent is PROMOTED even while an UNRELATED spawn never settles", async () => {
    // The topology regression codex sharpened: parent A rejects and re-parks, its child B
    // succeeded, and an UNRELATED spawn C never settles. If promotion waited on the whole
    // batch's `Promise.all`, C's wedge would keep B hidden under A's parked entry forever.
    // Because the reconcile now runs the INSTANT A settles — not after the batch — B is
    // promoted to top-level without C ever settling.
    const parentA = mkRecord("cccccccc-1111-4111-8111-cccccccccccc", "/A");
    const CHILD_B = "dddddddd-2222-4222-8222-dddddddddddd";
    registerTerminal(CHILD_B, liveEntry(CHILD_B, "/B", parentA.id));
    const childB = mkRecord(CHILD_B, "/B", parentA.id);
    const wedgedC = mkRecord("eeeeeeee-3333-4333-8333-eeeeeeeeeeee", "/C");

    const settle = settleRestoreRespawns([
      {
        ready: Promise.reject(new Error("spawn failed — removed cwd")),
        newId: parentA.id,
        record: parentA,
        parentIdMapped: undefined,
      },
      {
        ready: Promise.resolve(),
        newId: CHILD_B,
        record: childB,
        parentIdMapped: parentA.id,
      },
      // C's `ready` never resolves or rejects — a permanently-pending RPC.
      {
        ready: new Promise<void>(() => {}),
        newId: wedgedC.id,
        record: wedgedC,
        parentIdMapped: undefined,
      },
    ]);
    // Let A's rejection microtask chain drain. `settle` stays PENDING forever (C never
    // settles), so we deliberately do NOT await it.
    await new Promise((r) => setTimeout(r, 0));
    void settle;

    // A re-parked, and B — its live child — was promoted to top-level, WITHOUT C settling.
    expect(getTerminal(parentA.id)?.meta.state).toBe("parked");
    expect(getTerminal(CHILD_B)?.meta.state).toBe("active");
    expect(getTerminal(CHILD_B)?.meta.parentId).toBeUndefined();
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
      ports: { status: "unknown" },
    },
    handle: {} as ActiveTerminalProcess["handle"],
  });

  it("CLEAN settle — a padi-LOCAL metadata change made during the spawn window is persisted", () => {
    // The F5 capture: during the spawn window a live sibling's `setTerminalTheme` (a
    // padi-local setter — no kaval RPC) mutated in-memory state and fired `terminals:dirty`
    // AFTER the optimistic snapshot was written. The post-settle re-persist folds that
    // freshest metadata onto disk (and, now that no process-wide freeze is held across the
    // spawn `await`, the normal autosave gate would ALSO catch it — this pins the merge).
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

    persistSettledRestoreSnapshot([]);

    const saved = getSavedSession()?.terminals.find(
      (t) => t.cwd === "/f5-live",
    );
    expect(saved?.themeName).toBe("dracula");
  });

  it("PARKED residue — the re-parked record is RETAINED on disk (CONF-6)", () => {
    // A spawn FAILED and was re-parked as it settled. `snapshotSession` skips parked records,
    // so persisting it ALONE would DELETE the re-parked terminal from disk. Threading the
    // re-parked record back into the merge keeps it named on disk.
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

    persistSettledRestoreSnapshot([record]);

    // Disk still names the re-parked terminal — not shrunk to an empty session.
    expect(
      getSavedSession()?.terminals.some((t) => t.cwd === "/f5-parked"),
    ).toBe(true);
  });

  it("MIXED outcome — a live sibling's change AND a re-parked failure BOTH persist", () => {
    // The reachable loss codex sharpened in round 5: terminal A rejects and is re-parked
    // while already-live terminal B receives a theme change. The old `hasParkedTerminals()`
    // guard made the re-persist RETURN early, so B's change was dropped and only the stale
    // optimistic snapshot survived. The merge keeps A's re-parked record AND captures B's
    // fresh metadata — neither is lost.
    const PARKED_A = "99999999-9999-4999-8999-999999999999";
    const parkedRecord: SavedActiveTerminal = {
      ...base,
      id: PARKED_A,
      state: "active",
      cwd: "/f5-mixed-parked",
      lastActivityAt: 1,
      restoreTarget: { kind: "none" },
    };
    // B is live; the pre-await optimistic snapshot named BOTH A (still live then) and B.
    registerTerminal(LIVE_ID, liveEntry(LIVE_ID, "/f5-mixed-live"));
    setSavedSession({
      terminals: [
        parkedRecord,
        {
          ...base,
          id: LIVE_ID,
          state: "active",
          cwd: "/f5-mixed-live",
          lastActivityAt: 1,
          restoreTarget: { kind: "none" },
          // stale on disk — predates B's theme change below
        },
      ],
      activeTerminalId: LIVE_ID,
      savedAt: 1,
    });
    // A failed its spawn and was re-parked; B took a padi-local metadata change in-window.
    seedParkedTerminal(parkedRecord);
    setTerminalTheme(LIVE_ID as never, "dracula");

    persistSettledRestoreSnapshot([parkedRecord]);

    const saved = getSavedSession()?.terminals ?? [];
    // B's fresh metadata reached disk (the loss the guard caused)...
    expect(saved.find((t) => t.cwd === "/f5-mixed-live")?.themeName).toBe(
      "dracula",
    );
    // ...AND A's re-parked record was retained (CONF-6, not shrunk).
    expect(saved.some((t) => t.cwd === "/f5-mixed-parked")).toBe(true);
  });
});

const GRANDCHILD_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** #2059's legacy-data half on the cold-restore path. A blob written before the
 *  generative writes were fenced can hold a split of a split; rehydrating it
 *  verbatim would put a terminal back exactly where the canvas cannot show it
 *  (top-level tiles plus ONE hop). The sleeping arm matters on its own: a sleeper
 *  is seeded SYNCHRONOUSLY and never joins `activeRespawns`, so the post-settle
 *  sweep would not see it — the repair has to happen at the seed. */
describe("restoreSession — a saved split of a split comes back visible (#2059)", () => {
  const nestedSleeper: SavedTerminal = {
    ...base,
    id: GRANDCHILD_ID,
    state: "sleeping",
    sleptAt: 333,
    cwd: "/grandchild",
    parentId: SUB_ID, // …which is itself parented under PARENT_ID
    lastActivityAt: 11,
  };

  it("restores a SLEEPING grandchild TOP-LEVEL instead of under the split", async () => {
    setSavedSession({
      terminals: [parentRecord, subRecord, nestedSleeper],
      activeTerminalId: PARENT_ID,
      savedAt: 1,
    });
    expect(seedParkedTerminal(parentRecord)).toBe(true);
    expect(seedParkedTerminal(subRecord)).toBe(true);

    const done = restoreSession({});

    // The one-level split is untouched: it still hangs off the fresh parent.
    const parent = activeByCwd("/parent");
    const sub = activeByCwd("/sub");
    expect(sub?.parentId).toBe(parent?.id);

    // The grandchild came back — dormant, on its stable id, and TOP-LEVEL. It is
    // not dropped (that would lose a terminal) and not left at depth 2 (that
    // would leave it unpaintable for the life of the process).
    const grandchild = getTerminal(GRANDCHILD_ID);
    expect(grandchild?.meta.state).toBe("sleeping");
    expect(grandchild?.meta.parentId).toBeUndefined();

    await done;
  });
});
