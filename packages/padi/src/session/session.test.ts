import {
  type AuthoredActiveTerminal,
  AuthoredParkedSchema,
  type AuthoredParkedTerminal,
  encodeHostLocation,
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
} from "@kolu/padi-client/surface";
import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setDaemonProcessId } from "../koluRoot.ts";
import { log } from "../log.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { publishDaemonStatus } from "../ptyHost/daemonStatus.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import {
  type ActiveTerminalProcess,
  hasParkedTerminals,
  type ParkedTerminalProcess,
  registerTerminal,
  terminalEntries,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { snapshotSession } from "../terminals.ts";
import { cancelPendingAutosave, initAutosaveGate } from "./autosaveGate.ts";
import {
  getSavedSession,
  orphanedParkedIds,
  saveActiveTerminalId,
  saveSession,
  setSavedSession,
  setSavedSessionFromSnapshot,
} from "./session.ts";

setDaemonProcessId("padi-session-test");

const ACTIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARKED_A = "11111111-1111-4111-8111-111111111111";
const PARKED_B = "22222222-2222-4222-8222-222222222222";
const ORPHAN_PARKED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const activeMeta: AuthoredActiveTerminal = {
  state: "active",
  location: LOCAL_LOCATION,
  lastActivityAt: 42,
  promptedAt: null,
  themeName: "rose",
  intent: "fix the auth race",
};

const activeSnapshot: TerminalSnapshot = {
  cwd: "/work/repo",
  git: { kind: "none" as const },
  pr: { kind: "pending" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

const parkedMeta: AuthoredParkedTerminal = Schema.decodeUnknownSync(
  AuthoredParkedSchema,
)({
  state: "parked",
  parkedAt: 999,
  location: LOCAL_LOCATION,
  lastActivityAt: 55,
  themeName: "nord",
});

const parkedSnapshot: TerminalSnapshot = {
  cwd: "/work/parked",
  git: { kind: "none" as const },
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

const base = {
  git: { kind: "none" as const },
  pr: { kind: "absent" } as const,
  location: LOCAL_LOCATION,
};

function savedActive(id: string, cwd: string): SavedActiveTerminal {
  return {
    ...base,
    id,
    state: "active",
    cwd,
    lastActivityAt: 5,
    promptedAt: null,
    restoreTarget: { kind: "none" },
  };
}

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

function captureLogError(): {
  calls: unknown[][];
  restore: () => void;
} {
  const original = log.error;
  const calls: unknown[][] = [];
  log.error = ((...args: unknown[]) => {
    calls.push(args);
  }) as unknown as typeof log.error;
  return {
    calls,
    restore: () => {
      log.error = original;
    },
  };
}

async function fireAutosave(): Promise<void> {
  terminalsDirtyChannel.publish({});
  await tick(10);
  await tick(650);
}

beforeAll(async () => {
  initAutosaveGate({
    snapshot: snapshotSession,
    isRestorePending: hasParkedTerminals,
    orphanedParkedIds,
    persist: saveSession,
    persistFinal: setSavedSessionFromSnapshot,
    persistActiveId: saveActiveTerminalId,
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
    setSavedSession(savedBlob());
    registerParked(PARKED_A);
    registerParked(PARKED_B);

    for (let i = 0; i < 3; i++) {
      terminalsDirtyChannel.publish({});
      await tick(10);
      await tick(650);
    }

    expect(getSavedSession()?.terminals.length).toBe(2);
  });

  it("(iv) an autosave whose snapshot is empty preserves the saved session while a restore is pending", async () => {
    setSavedSession(savedBlob());
    registerParked(PARKED_A);

    await fireAutosave();

    expect(getSavedSession()).not.toBeNull();
  });

  it("(vii) REPORTS the contradiction — a parked entry the blob does not name pins the autosave, and says so", async () => {
    setSavedSession(savedBlob());
    registerParked(ORPHAN_PARKED);
    expect(orphanedParkedIds()).toEqual([ORPHAN_PARKED]);

    const captured = captureLogError();
    try {
      await fireAutosave();
      const orphanLines = captured.calls.filter(([, msg]) =>
        String(msg).includes("suppressed-parked"),
      );
      expect(orphanLines).toHaveLength(1);
      expect(orphanLines[0]?.[0]).toEqual({
        orphanedParkedIds: [ORPHAN_PARKED],
      });
    } finally {
      captured.restore();
    }

    expect(getSavedSession()?.terminals.length).toBe(2);
  });

  it("(control-A) with NO parked entries, an autosave persists the live terminals normally (guard is scoped)", async () => {
    expect(getSavedSession()).toBeNull();
    registerActive(ACTIVE_ID);

    await fireAutosave();

    expect(getSavedSession()?.terminals.length).toBe(1);
  });

  it("(control-B) with NO parked entries, closing the last terminal (empty snapshot) still clears the session", async () => {
    setSavedSession(savedBlob());

    await fireAutosave();

    expect(getSavedSession()).toBeNull();
  });

  it("(iii) an out-of-band daemon-death (degraded status) under a live server does NOT touch the saved session (R-3 status quo)", () => {
    setSavedSession(savedBlob());
    registerActive(ACTIVE_ID);
    registerActive(PARKED_A);

    const registryBefore = [...terminalEntries()].map(([id, e]) => [
      id,
      e.meta.state,
    ]);
    const savedBefore = getSavedSession();

    publishDaemonStatus(encodeHostLocation(LOCAL_LOCATION), {
      state: "degraded",
    });

    expect(getSavedSession()).toEqual(savedBefore);
    expect(getSavedSession()?.terminals.length).toBe(2);
    expect([...terminalEntries()].map(([id, e]) => [id, e.meta.state])).toEqual(
      registryBefore,
    );
  });
});

describe("saveActiveTerminalId — the focus write touches ONE field (#2286)", () => {
  it("patches `activeTerminalId` and leaves the trace and its `savedAt` byte-identical", () => {
    setSavedSession(savedBlob());
    const before = getSavedSession();

    saveActiveTerminalId("22222222-2222-4222-8222-222222222222");

    const after = getSavedSession();
    expect(after?.activeTerminalId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(after?.terminals).toEqual(before?.terminals);
    expect(after?.savedAt).toBe(before?.savedAt);
  });

  it("is a NO-OP when nothing is saved — a marker with no trace is not a session", () => {
    setSavedSession(null);
    saveActiveTerminalId("22222222-2222-4222-8222-222222222222");
    expect(getSavedSession()).toBeNull();
  });
});

describe("setSavedSessionFromSnapshot — the drain-path no-shrink receptacle", () => {
  it("an EMPTY snapshot preserves the existing saved session (never null/shrink) and cancels any pending autosave", async () => {
    setSavedSession(savedBlob());
    terminalsDirtyChannel.publish({});
    await tick(10);

    setSavedSessionFromSnapshot({ terminals: [], activeTerminalId: null });

    expect(getSavedSession()?.terminals.length).toBe(2);

    await tick(650);
    expect(getSavedSession()?.terminals.length).toBe(2);
  });

  it("a NON-EMPTY snapshot persists normally, replacing the on-disk blob", () => {
    setSavedSession(savedBlob());
    const fresh = savedActive("99999999-9999-4999-8999-999999999999", "/fresh");

    setSavedSessionFromSnapshot({
      terminals: [fresh],
      activeTerminalId: fresh.id,
    });

    expect(getSavedSession()?.terminals.length).toBe(1);
    expect(getSavedSession()?.terminals[0]?.id).toBe(fresh.id);
    expect(getSavedSession()?.activeTerminalId).toBe(fresh.id);
  });

  it("MERGE: restore-pending capture (2 parked + 1 live) persists the UNION — exactly 3 records, the live one fresh (no shrink)", () => {
    setSavedSession(savedBlob());
    registerParked("11111111-1111-4111-8111-111111111111");
    registerParked("22222222-2222-4222-8222-222222222222");
    registerActive(ACTIVE_ID);
    expect(snapshotSession().terminals.map((t) => t.id)).toEqual([ACTIVE_ID]);

    setSavedSessionFromSnapshot(snapshotSession());

    const saved = getSavedSession();
    expect(saved?.terminals.map((t) => t.id).sort()).toEqual(
      [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        ACTIVE_ID,
      ].sort(),
    );
    expect(
      saved?.terminals.find(
        (t) => t.id === "11111111-1111-4111-8111-111111111111",
      )?.state,
    ).toBe("active");
    const live = saved?.terminals.find((t) => t.id === ACTIVE_ID);
    expect(live?.state).toBe("active");
    if (live?.state === "active") expect(live.cwd).toBe("/work/repo");
  });

  it("MERGE collision: an id in BOTH the on-disk set AND the live capture yields ONE record — the LIVE one winning", () => {
    setSavedSession(savedBlob());
    registerActive("11111111-1111-4111-8111-111111111111");
    registerParked("22222222-2222-4222-8222-222222222222");
    expect(snapshotSession().terminals.map((t) => t.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);

    setSavedSessionFromSnapshot(snapshotSession());

    const saved = getSavedSession();
    expect(saved?.terminals.length).toBe(2);
    const collided = saved?.terminals.filter(
      (t) => t.id === "11111111-1111-4111-8111-111111111111",
    );
    expect(collided?.length).toBe(1);
    const won = collided?.[0];
    expect(won?.state).toBe("active");
    if (won?.state === "active") expect(won.cwd).toBe("/work/repo");
    expect(
      saved?.terminals.find(
        (t) => t.id === "22222222-2222-4222-8222-222222222222",
      ),
    ).toBeTruthy();
  });
});
