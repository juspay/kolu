/**
 * The in-app **Restart kaval** path (`restartLocalDaemon` → capture → drain →
 * recycle → reattach/park) must NOT lose the session — the zest regression.
 *
 * The trace from the deployed diagnostic build: the drain (`killAllTerminals` → the
 * PTYs exit → `notifyDirty`) arms the 500 ms autosave; it fires in the
 * drain→park GAP (the daemon recycle), when the registry is empty AND no parked
 * entries exist yet — so the `hasParkedTerminals()` guard is inert and
 * `saveSession([])` nulls the just-captured session before park runs; park then reads
 * null and no-ops. Session lost.
 *
 * This drives the REAL `restartLocalDaemon` (via `__setEndpointForTest`, a fake
 * daemon standing in for the recycle) with the REAL `AutosaveGate` loop and
 * the REAL `terminals:dirty` channel, and lets the autosave timer actually fire in
 * the drain→park window. The interleave is the whole bug, so it is pinned
 * explicitly (the recycle gap outlasts the 500 ms autosave).
 */

import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  cancelPendingAutosave,
  initAutosaveGate,
  unfreezeAutosave,
} from "../session/autosaveGate.ts";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import {
  getSavedSession,
  saveSession,
  setSavedSession,
} from "../session/session.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  hasParkedTerminals,
  registerTerminal,
  terminalEntries,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { parkSavedSession } from "../terminalEndpoint/reattach.ts";
import { snapshotSession } from "../terminals.ts";
import type {
  AuthoredActiveTerminal,
  SavedActiveTerminal,
  SavedSession,
} from "../vocab.ts";
import { LOCAL_LOCATION } from "../vocab.ts";
import {
  createEndpoint,
  destructiveRecycleSteps,
  recycle,
} from "@kolu/surface-daemon-supervisor";
import { assertDaemonSpawnAllowed } from "@kolu/daemon-test-gate";
import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __setEndpointForTest } from "./index.ts";
import { restartLocalDaemon } from "./restartLocal.ts";

setDaemonProcessId("restartlocal-test-server");

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function activeMeta(): AuthoredActiveTerminal {
  return { state: "active", location: LOCAL_LOCATION, lastActivityAt: 1 };
}
function activeSnapshot(cwd: string): TerminalSnapshot {
  return {
    cwd,
    git: null,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
  };
}
function seedActive(id: string, cwd: string): void {
  registerTerminal(id, {
    info: { id, pid: 1 },
    meta: activeMeta(),
    snapshot: activeSnapshot(cwd),
    handle: {} as ActiveTerminalProcess["handle"],
  });
}

/** One saved ACTIVE record — the on-disk shape a restore card offers, and what
 *  `parkSavedSession` stands up as a parked entry. */
function savedActiveRec(id: string, cwd: string): SavedActiveTerminal {
  return {
    id,
    state: "active",
    cwd,
    lastActivityAt: 5,
    restoreTarget: { kind: "none" },
    git: null,
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
  };
}

/** A padi ctx whose `session` cell is a real in-memory store so
 *  capture/park/autosave round-trip; every other member no-op. */
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

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const epTmpDirs: string[] = [];
const epServers: Server[] = [];
const epChildren: ChildProcess[] = [];

/**
 * A genuine createEndpoint standing in for the daemon recycle. Its `ensure()`
 * (the recycle) OUTLASTS the 500 ms autosave — timing via the driver.spawn seam
 * (second spawn delays). No forged binds (F12). The held client's killAll
 * publishes terminals:dirty so the drain arms autosave.
 *
 * Gate holder is a disposable `sleep` child (never this vitest process) so
 * recycle's SIGTERM targets the stand-in daemon only.
 */
async function realEndpoint(recycleMs: number) {
  const dir = mkdtempSync(join(tmpdir(), "restart-local-ep-"));
  epTmpDirs.push(dir);
  const socketPath = join(dir, "k.sock");
  const gatePath = join(dir, "k.pid");
  let spawnN = 0;

  const listen = async (): Promise<void> => {
    // Close prior server if re-spawning at the same path.
    for (const s of epServers.splice(0)) {
      try {
        s.close();
      } catch {
        // already closed
      }
    }
    try {
      rmSync(socketPath, { force: true });
    } catch {
      // absent
    }
    const s = createServer((c) => c.on("error", () => {}));
    epServers.push(s);
    await new Promise<void>((resolve, reject) => {
      s.once("error", reject);
      s.listen(socketPath, () => resolve());
    });
    // Disposable gate holder for recycle SIGTERM (not this vitest process).
    assertDaemonSpawnAllowed();
    const child = spawnChild("sleep", ["3600"], { stdio: "ignore" });
    epChildren.push(child);
    if (child.pid === undefined) throw new Error("sleep spawn produced no pid");
    writeFileSync(gatePath, `${child.pid}\n`);
  };

  const makeClient = () => ({
    surface: {
      terminal: {
        killAll: async () => {
          // The PTYs die with the daemon → a genuine dirty arms the autosave.
          terminalsDirtyChannel.publish({});
          return { killed: 2 };
        },
      },
    },
  });

  const ep = createEndpoint({
    hostId: "local-kaval-test",
    home: { dir, gatePath, socketPath },
    policy: {
      capability: "not-drainable" as const,
      baked: {
        contractVersion: "test",
        build: { kind: "off-nix" as const },
      },
      onContractSkew: { kind: "recycle" as const },
      onBuildMismatch: { kind: "nudge-human" as const },
    },
    probe: async () => null,
    driver: {
      spawn: async () => {
        spawnN += 1;
        // First spawn warms the endpoint; subsequent ensure (recycle) is the gap.
        if (spawnN > 1) await delay(recycleMs);
        await listen();
      },
    },
    connect: async () => ({
      client: makeClient(),
      identity: undefined as undefined,
      startedAt: Date.now(),
      metadata: { contractVersion: "test" },
      dispose: () => {},
      onClose: () => {},
    }),
    log: silentLog,
    onStatus: () => {},
    socketReadyMs: 200,
    socketPollMs: 5,
    adoptConnectAttempts: 1,
    adoptConnectRetryMs: 1,
  });

  // Warm so current() is held before restart (drain's killAll needs it).
  await recycle(ep, destructiveRecycleSteps());
  // Minimal client shape for the restart path; production Endpoint is wider.
  // biome-ignore lint/suspicious/noExplicitAny: test stand-in for recycle timing
  return ep as any;
}

// When set (by the ordering test), every autosave-callback evaluation records the
// terminal count `snapshotSession()` returned at that instant — so we can PROVE the
// autosave actually fired in the empty-registry (snapshot=0) drain→park window, not
// that the test passed because the timer never fired.
let autosaveEvals: number[] | null = null;

beforeAll(() => {
  // One real autosave loop for the whole file (module-level subscription). The
  // callback calls this every time it fires (for its diagnostic log), BEFORE the
  // freeze/parked guards, so recording here observes the fire regardless of skip.
  initAutosaveGate({
    snapshot: () => {
      const s = snapshotSession();
      if (autosaveEvals) autosaveEvals.push(s.terminals.length);
      return s;
    },
    isRestorePending: hasParkedTerminals,
    persist: saveSession,
  });
});

beforeEach(async () => {
  autosaveEvals = null;
  cancelPendingAutosave();
  setPadiSurfaceCtx(sessionBackedCtx());
  seedActive(A_ID, "/a");
  seedActive(B_ID, "/b");
  __setEndpointForTest(await realEndpoint(700));
});

afterEach(async () => {
  unfreezeAutosave();
  cancelPendingAutosave();
  await delay(0);
  for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
  __resetPadiSurfaceCtxForTest();
  for (const c of epChildren.splice(0)) {
    try {
      c.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const s of epServers.splice(0)) s.close();
  for (const d of epTmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

afterAll(() => {
  cancelPendingAutosave();
});

describe("restartLocalDaemon — the in-app Restart kaval path must not lose the session", () => {
  it("preserves the captured session across the drain→recycle→park window (autosave fires in the gap)", async () => {
    // 2 live terminals; the restart captures them, drains (arming the autosave with an
    // empty registry), recycles (the autosave fires here), then parks.
    await restartLocalDaemon();

    // The saved session must SURVIVE the restart — on the current head the autosave
    // fires in the drain→park gap with snapshot=0 and nulls it before park runs.
    expect(getSavedSession()?.terminals.length).toBe(2);
    // …and park must have seeded a parked entry per active for the restore card.
    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });

  it("ORDERING GUARD: the autosave DOES fire in the empty-registry (snapshot=0) drain→park window, and the freeze keeps the session unnulled", async () => {
    autosaveEvals = [];
    await restartLocalDaemon();

    // The interleave is REAL, not skipped by luck: the autosave callback fired during
    // the restart with an EMPTY registry (snapshot=0) — the exact drain→park window
    // the freeze exists to cover. If a refactor reordered park before drain, or made
    // the recycle shorter than the 500ms autosave, this window would not be hit and
    // this assertion would fail.
    expect(autosaveEvals).toContain(0);
    // And DESPITE the autosave firing on that empty registry, the freeze kept the
    // session intact + parked. Drop the freeze and this (and the test above) go red.
    expect(getSavedSession()?.terminals.length).toBe(2);
    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });

  it("NO-SHRINK: a restart with a restore ALREADY pending (parked) + a live terminal preserves the UNION (N+1), never the shrunken 1-record blob", async () => {
    // Rebuild the precondition from scratch — the beforeEach's two live actives are
    // not part of this scenario.
    for (const [id] of [...terminalEntries()]) unregisterTerminal(id);

    // Restore PENDING: two saved ACTIVE records on disk, stood up as two PARKED
    // registry entries — exactly what padi's boot/park produces while a restore
    // card is showing (`snapshotSession` deliberately EXCLUDES the parked pair).
    const P1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const P2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    setSavedSession({
      terminals: [
        savedActiveRec(P1, "/pending-1"),
        savedActiveRec(P2, "/pending-2"),
      ],
      activeTerminalId: null,
      savedAt: 1,
    });
    parkSavedSession(); // seed the two parked entries from that saved session
    expect(getTerminal(P1)?.meta.state).toBe("parked");
    expect(getTerminal(P2)?.meta.state).toBe("parked");

    // The user then creates ONE fresh live terminal (create no longer forfeits the
    // parked set — PATH B): the restore stays pending AND a live terminal exists.
    seedActive(A_ID, "/live");
    // The parked-excluding snapshot names ONLY the live terminal — the shrink hazard.
    expect(snapshotSession().terminals.map((t) => t.id)).toEqual([A_ID]);

    // Restart kaval: capture MERGES (2 pending ∪ 1 live = 3), drain clears the
    // registry, park re-seeds all 3 from the merged blob.
    await restartLocalDaemon();

    // No shrink: the saved blob holds ALL three — the two pending PLUS the live one
    // — not the 1-record blob an un-merged capture would have written (which
    // parkSavedSession would then read, dropping the two pending terminals forever).
    expect(
      getSavedSession()
        ?.terminals.map((t) => t.id)
        .sort(),
    ).toEqual([P1, P2, A_ID].sort());
    // …and the post-restart restore offers exactly those three (parked per record).
    const parkedIds = [...terminalEntries()]
      .filter(([, e]) => e.meta.state === "parked")
      .map(([id]) => id)
      .sort();
    expect(parkedIds).toEqual([P1, P2, A_ID].sort());
  });
});
