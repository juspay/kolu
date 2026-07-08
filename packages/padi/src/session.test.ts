/**
 * Session-clobber data-loss guards — the autosave loop must NOT shrink the saved
 * session while a restore is pending (parked entries stand in for the on-disk
 * blob), yet must persist / clear normally when nothing is parked.
 *
 * The PATH-B bug: parked records are boot-produced restore-card rows that
 * `snapshotSession` deliberately EXCLUDES. Without a guard, a `terminals:dirty`
 * autosave firing while parked entries linger persists a snapshot that omits them
 * — shrinking (or nulling) the saved session on disk, the restore source of
 * truth. The guard lives in `autosaveGate.ts`'s fire decision: the LIVE
 * `isRestorePending()` query short-circuits to `suppressed-parked` before any
 * persist. Tests (vi) and (iv) are red-when-reverted against that guard; the two
 * control cases pin that it is scoped (normal autosave still persists / clears).
 *
 * Async-timer pattern mirrors `packages/server/src/session.test.ts`'s autosave
 * test: REAL timers, a `terminalsDirtyChannel.publish({})` to arm the gate, a
 * short tick to let it schedule the 500 ms timer, then a longer wait to pass the
 * autosave window.
 */

import type { TerminalSnapshot } from "@kolu/terminal-workspace/schema";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cancelPendingAutosave, initAutosaveGate } from "./autosaveGate.ts";
import { setDaemonProcessId } from "./koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import { publishDaemonStatus } from "./ptyHost/daemonStatus.ts";
import { terminalsDirtyChannel } from "./publisher.ts";
import {
  getSavedSession,
  saveSession,
  setSavedSession,
  setSavedSessionFromSnapshot,
} from "./session.ts";
import {
  type ActiveTerminalProcess,
  hasParkedTerminals,
  type ParkedTerminalProcess,
  registerTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { snapshotSession } from "./terminals.ts";
import {
  type AuthoredActiveTerminal,
  AuthoredParkedSchema,
  type AuthoredParkedTerminal,
  encodeHostLocation,
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
} from "./vocab.ts";

// Boot injects the server id before any of this runs; some registry paths read
// the per-instance scratch root, so seed it here as the other padi tests do.
setDaemonProcessId("padi-session-test");

const ACTIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARKED_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARKED_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const activeMeta: AuthoredActiveTerminal = {
  state: "active",
  location: LOCAL_LOCATION,
  lastActivityAt: 42,
  themeName: "rose",
  intent: "fix the auth race",
};

const activeSnapshot: TerminalSnapshot = {
  cwd: "/work/repo",
  git: null,
  pr: { kind: "pending" },
  agent: null,
  foreground: null,
};

// Parse through the authored-parked schema so the fixture is a VALID parked arm —
// the boot reconcile builds this same authored base off a saved ACTIVE record.
const parkedMeta: AuthoredParkedTerminal = AuthoredParkedSchema.parse({
  state: "parked",
  parkedAt: 999,
  location: LOCAL_LOCATION,
  lastActivityAt: 55,
  lastAgentCommand: "claude --model opus",
  themeName: "nord",
});

const parkedSnapshot: TerminalSnapshot = {
  cwd: "/work/parked",
  git: null,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
};

const base = {
  git: null,
  pr: { kind: "absent" } as const,
  location: LOCAL_LOCATION,
};

/** One ACTIVE saved record — the on-disk shape the restore card offers. */
function savedActive(id: string, cwd: string): SavedActiveTerminal {
  return {
    ...base,
    id,
    state: "active",
    cwd,
    lastActivityAt: 5,
    restoreTarget: { kind: "none" },
  };
}

/** The pre-reboot session on disk — two ACTIVE records the restore card offers. */
function savedBlob(): SavedSession {
  return {
    terminals: [
      savedActive("11111111-1111-4111-8111-111111111111", "/a"),
      savedActive("22222222-2222-4222-8222-222222222222", "/b"),
    ],
    activeTerminalId: null,
    savedAt: 1,
  };
}

/** A padi ctx whose `session` cell is a real in-memory store, so
 *  `setSavedSession` / `getSavedSession` round-trip; every other member no-op.
 *  Copied from `servePadi.test.ts` / `reattach.test.ts`. */
function sessionBackedCtx(): ReturnType<typeof noopPadiSurfaceCtxForTest> {
  const b = noopPadiSurfaceCtxForTest();
  let session: SavedSession | null = null;
  return {
    ...b,
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
          : (b.cells as Record<string, unknown>)[name as string],
    }),
  } as ReturnType<typeof noopPadiSurfaceCtxForTest>;
}

function registerParked(id: string): void {
  registerTerminal(id, {
    info: { id, pid: 0 },
    meta: parkedMeta,
    snapshot: parkedSnapshot,
  } as ParkedTerminalProcess);
}

function registerActive(id: string): void {
  registerTerminal(id, {
    info: { id, pid: 1 },
    meta: activeMeta,
    snapshot: activeSnapshot,
    handle: {} as ActiveTerminalProcess["handle"],
  });
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Arm the autosave loop once and let it pass the 500 ms window: publish a dirty
 *  event, tick so the loop schedules the timer, then wait past the window. */
async function fireAutosave(): Promise<void> {
  terminalsDirtyChannel.publish({});
  await tick(10);
  await tick(650);
}

// The autosave loop subscribes exactly ONCE — register it here, not per test, and
// give the async subscription a moment to attach before the first publish.
beforeAll(async () => {
  initAutosaveGate({
    snapshot: snapshotSession,
    isRestorePending: hasParkedTerminals,
    persist: saveSession,
  });
  await tick(10);
});

beforeEach(() => {
  setPadiSurfaceCtx(sessionBackedCtx());
  cancelPendingAutosave();
});

afterEach(() => {
  for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
  cancelPendingAutosave();
  __resetPadiSurfaceCtxForTest();
});

describe("session autosave — the PATH-B session-clobber guard", () => {
  it("(vi) autosave while parked entries exist NEVER shrinks the saved blob (property over dirty events)", async () => {
    // The on-disk pre-reboot session: 2 active records the restore card offers.
    setSavedSession(savedBlob());
    // The pending restore: 2 PARKED entries stand in for those records. The live
    // registry has NO active terminals — only parked.
    registerParked(PARKED_A);
    registerParked(PARKED_B);

    // Property: no number of dirty events (create/close/agent churn arms the
    // autosave) may shrink the blob while the restore is pending.
    for (let i = 0; i < 3; i++) {
      terminalsDirtyChannel.publish({});
      await tick(10);
      await tick(650);
    }

    // The blob never shrank — still 2. Red-when-reverted: without the
    // `hasParkedTerminals()` guard, `snapshotSession()` (which excludes parked) is
    // [] so `saveSession` clears the blob to null and this length is undefined.
    expect(getSavedSession()?.terminals.length).toBe(2);
  });

  it("(iv) an autosave whose snapshot is empty preserves the saved session while a restore is pending", async () => {
    setSavedSession(savedBlob());
    // A single PARKED entry, nothing else → `snapshotSession()` is [].
    registerParked(PARKED_A);

    await fireAutosave();

    // The saved session survives (NOT null). Red-when-reverted: guard removed →
    // the empty snapshot clears it to null.
    expect(getSavedSession()).not.toBeNull();
  });

  it("(control-A) with NO parked entries, an autosave persists the live terminals normally (guard is scoped)", async () => {
    expect(getSavedSession()).toBeNull();
    // One ACTIVE terminal, no parked entries.
    registerActive(ACTIVE_ID);

    await fireAutosave();

    // The live terminal was persisted — the guard does not over-block normal
    // autosave. (Byte-identity guard: passes with AND without the fix.)
    expect(getSavedSession()?.terminals.length).toBe(1);
  });

  it("(control-B) with NO parked entries, closing the last terminal (empty snapshot) still clears the session", async () => {
    setSavedSession(savedBlob());
    // Registry EMPTY, NO parked entries — a genuine user close-to-empty.

    await fireAutosave();

    // A real user close still clears normally; the guard only holds while parked
    // entries are pending. (Byte-identity guard: passes with AND without the fix.)
    expect(getSavedSession()).toBeNull();
  });

  it("(iii) an out-of-band daemon-death (degraded status) under a live server does NOT touch the saved session (R-3 status quo)", () => {
    setSavedSession(savedBlob());
    registerActive(ACTIVE_ID);
    registerActive(PARKED_A); // a second live active — reuse the id as a distinct live entry

    const registryBefore = [...terminalEntries()].map(([id, e]) => [
      id,
      e.meta.state,
    ]);
    const savedBefore = getSavedSession();

    // The supervisor flips the local kaval to degraded on daemon death.
    publishDaemonStatus(encodeHostLocation(LOCAL_LOCATION), {
      state: "degraded",
    });

    // The degraded transition writes ONLY status — never the session, never the
    // registry. Nobody wires a session-clobber into the degraded path.
    expect(getSavedSession()).toEqual(savedBefore);
    expect(getSavedSession()?.terminals.length).toBe(2);
    expect([...terminalEntries()].map(([id, e]) => [id, e.meta.state])).toEqual(
      registryBefore,
    );
  });
});

describe("setSavedSessionFromSnapshot — the drain-path no-shrink receptacle", () => {
  // The W2.2 drain (padi drains + exits; the surviving kaval keeps the PTYs) captures
  // the live registry through `setSavedSessionFromSnapshot`. When it fires with an
  // EMPTY snapshot — the parked-only / empty-registry case a drain hits — it must NOT
  // erase the user's only restore data. This pins the F1 empty-preserve invariant on
  // the path the drain now actually depends on.
  it("an EMPTY snapshot preserves the existing saved session (never null/shrink) and cancels any pending autosave", async () => {
    // A non-empty session already on disk — the pre-drain blob the restore card offers.
    setSavedSession(savedBlob());
    // Arm a pending autosave the way a stale `terminals:dirty` would: schedule the
    // 500 ms timer but don't let it fire yet. Registry is EMPTY (no active, no parked).
    terminalsDirtyChannel.publish({});
    await tick(10);

    // The drain captures an EMPTY registry snapshot.
    setSavedSessionFromSnapshot({ terminals: [], activeTerminalId: null });

    // Empty-preserve: the existing blob is left intact, not shrunk or nulled.
    expect(getSavedSession()?.terminals.length).toBe(2);

    // …and the pending autosave was cancelled: past the 500 ms window it never fires,
    // so it cannot clobber the preserved blob to null (an uncancelled timer would call
    // `saveSession([])` on the empty registry and clear it).
    await tick(650);
    expect(getSavedSession()?.terminals.length).toBe(2);
  });

  it("a NON-EMPTY snapshot persists normally, replacing the on-disk blob", () => {
    setSavedSession(savedBlob()); // 2 records on disk
    const fresh = savedActive("99999999-9999-4999-8999-999999999999", "/fresh");

    setSavedSessionFromSnapshot({
      terminals: [fresh],
      activeTerminalId: fresh.id,
    });

    // The fresh single-terminal snapshot was written (with a `savedAt` stamp).
    expect(getSavedSession()?.terminals.length).toBe(1);
    expect(getSavedSession()?.terminals[0]?.id).toBe(fresh.id);
    expect(getSavedSession()?.activeTerminalId).toBe(fresh.id);
  });

  // ── The no-shrink MERGE guard (restore-pending capture) ──────────────────
  // The PATH-B capture bug: a restore is pending (N parked entries stand for N
  // on-disk records that `snapshotSession` EXCLUDES) AND the user has created a
  // fresh live terminal (create no longer forfeits the parked set). A plain
  // persist of the parked-excluding snapshot would OVERWRITE the N-record blob with
  // a 1-record one and `parkSavedSession` would then drop the N pending terminals.
  // The guard MERGES (union by id, live-wins) so nothing shrinks.
  it("MERGE: restore-pending capture (2 parked + 1 live) persists the UNION — exactly 3 records, the live one fresh (no shrink)", () => {
    // On disk: 2 ACTIVE records (savedBlob ids 1111/2222), stood up as 2 PARKED
    // entries under the SAME ids — snapshotSession filters those out.
    setSavedSession(savedBlob());
    registerParked("11111111-1111-4111-8111-111111111111");
    registerParked("22222222-2222-4222-8222-222222222222");
    // The user creates ONE fresh live terminal (cwd `/work/repo` from activeSnapshot).
    registerActive(ACTIVE_ID);
    // The hazard: the parked-excluding snapshot names ONLY the live terminal.
    expect(snapshotSession().terminals.map((t) => t.id)).toEqual([ACTIVE_ID]);

    setSavedSessionFromSnapshot(snapshotSession());

    const saved = getSavedSession();
    // COUNT: exactly N+1 = 3 records, no duplicates, no shrink.
    expect(saved?.terminals.map((t) => t.id).sort()).toEqual(
      [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        ACTIVE_ID,
      ].sort(),
    );
    // CONTENT: the two pending records survived from disk…
    expect(
      saved?.terminals.find(
        (t) => t.id === "11111111-1111-4111-8111-111111111111",
      )?.state,
    ).toBe("active");
    // …and the live record carries its FRESH captured state, not a stale/parked copy.
    const live = saved?.terminals.find((t) => t.id === ACTIVE_ID);
    expect(live?.state).toBe("active");
    if (live?.state === "active") expect(live.cwd).toBe("/work/repo");
  });

  it("MERGE collision: an id in BOTH the on-disk set AND the live capture yields ONE record — the LIVE one winning", () => {
    // On disk: 1111 (cwd /a) + 2222 (cwd /b). The user RESTORED 1111 (parked→active
    // flip done → a LIVE active under id 1111, cwd /work/repo) while 2222 is STILL
    // parked — and the on-disk blob has not been rewritten when Restart lands.
    setSavedSession(savedBlob());
    registerActive("11111111-1111-4111-8111-111111111111"); // restored → live
    registerParked("22222222-2222-4222-8222-222222222222"); // still pending
    // snapshotSession filters the parked 2222 → only the live 1111.
    expect(snapshotSession().terminals.map((t) => t.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);

    setSavedSessionFromSnapshot(snapshotSession());

    const saved = getSavedSession();
    // Exactly 2 records — NO duplicate for the collided id 1111.
    expect(saved?.terminals.length).toBe(2);
    const collided = saved?.terminals.filter(
      (t) => t.id === "11111111-1111-4111-8111-111111111111",
    );
    expect(collided?.length).toBe(1);
    // The LIVE capture WON: cwd is the live snapshot's /work/repo, NOT the stale
    // on-disk /a. A merge that kept the disk copy (or duplicated) fails here.
    const won = collided?.[0];
    expect(won?.state).toBe("active");
    if (won?.state === "active") expect(won.cwd).toBe("/work/repo");
    // The still-pending 2222 survived from disk.
    expect(
      saved?.terminals.find(
        (t) => t.id === "22222222-2222-4222-8222-222222222222",
      ),
    ).toBeTruthy();
  });
});
