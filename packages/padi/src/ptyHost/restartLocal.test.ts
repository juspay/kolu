import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import type {
  AuthoredActiveTerminal,
  SavedActiveTerminal,
  SavedSession,
} from "@kolu/padi-client/surface";
import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import {
  destructiveRecycleSteps,
  recycle,
} from "@kolu/surface-daemon-supervisor";
import { createEndpointForKoluTest as createEndpoint } from "@kolu/surface-daemon-supervisor/createEndpoint.kolu.testlib";
import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import {
  cancelPendingAutosave,
  initAutosaveGate,
  unfreezeAutosave,
} from "../session/autosaveGate.ts";
import {
  getSavedSession,
  saveActiveTerminalId,
  saveSession,
  setSavedSession,
  setSavedSessionFromSnapshot,
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
import { scriptedDispatch } from "./dispatch.testlib.ts";
import { __setEndpointForTest } from "./index.ts";
import { restartLocalDaemon } from "./restartLocal.ts";

setDaemonProcessId("restartlocal-test-server");

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function activeMeta(): AuthoredActiveTerminal {
  return {
    state: "active",
    location: LOCAL_LOCATION,
    lastActivityAt: 1,
    promptedAt: null,
  };
}
function activeSnapshot(cwd: string): TerminalSnapshot {
  return {
    cwd,
    git: { kind: "none" },
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

function savedActiveRec(id: string, cwd: string): SavedActiveTerminal {
  return {
    id,
    state: "active",
    cwd,
    lastActivityAt: 5,
    promptedAt: null,
    restoreTarget: { kind: "none" },
    git: { kind: "none" },
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
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

const epTmpDirs: string[] = [];
const epServers: Server[] = [];

async function realEndpoint(recycleMs: number) {
  const dir = mkdtempSync(join(tmpdir(), "restart-local-ep-"));
  epTmpDirs.push(dir);
  const socketPath = join(dir, "k.sock");
  const gatePath = join(dir, "k.pid");
  let spawnN = 0;

  const listen = async (): Promise<void> => {
    for (const s of epServers.splice(0)) s.close();
    rmSync(socketPath, { force: true });
    const s = createServer((c) => c.on("error", () => {}));
    epServers.push(s);
    await new Promise<void>((resolve, reject) => {
      s.once("error", reject);
      s.listen(socketPath, () => resolve());
    });
  };

  const makeDispatch = () =>
    scriptedDispatch((tag) =>
      tag.endsWith("terminal/killAll") ? killAll : undefined,
    );

  const killAll = async () => {
    terminalsDirtyChannel.publish({});
    for (const s of epServers.splice(0)) s.close();
    rmSync(socketPath, { force: true });
    return { killed: 2 };
  };

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
    probe: () => Effect.succeed(null),
    driver: {
      spawn: Effect.promise(async () => {
        spawnN += 1;
        if (spawnN > 1) await delay(recycleMs);
        await listen();
      }),
    },
    connect: () =>
      Effect.promise(async () => ({
        client: {},
        identity: { staleKey: "", navigableCommit: "" },
        startedAt: Date.now(),
        metadata: {
          contractVersion: "test",
          pid: 4242,
          dispatch: makeDispatch(),
        },
        dispose: () => {},
        onClose: () => {},
      })),
    log: silentLog,
    onStatus: () => {},
    socketReadyMs: 200,
    socketPollMs: 5,
    adoptConnectAttempts: 1,
    adoptConnectRetryMs: 1,
  });

  await Effect.runPromise(recycle(ep, destructiveRecycleSteps()));
  // biome-ignore lint/suspicious/noExplicitAny: test stand-in for recycle timing
  return ep as any;
}

let autosaveEvals: number[] | null = null;

beforeAll(() => {
  initAutosaveGate({
    snapshot: () => {
      const s = snapshotSession();
      if (autosaveEvals) autosaveEvals.push(s.terminals.length);
      return s;
    },
    isRestorePending: hasParkedTerminals,
    orphanedParkedIds: () => [],
    persist: saveSession,
    persistFinal: setSavedSessionFromSnapshot,
    persistActiveId: saveActiveTerminalId,
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
  for (const s of epServers.splice(0)) s.close();
  for (const d of epTmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

afterAll(() => {
  cancelPendingAutosave();
});

describe("restartLocalDaemon — the in-app Restart kaval path must not lose the session", () => {
  it("preserves the captured session across the drain→recycle→park window (autosave fires in the gap)", async () => {
    await Effect.runPromise(restartLocalDaemon());

    expect(getSavedSession()?.terminals.length).toBe(2);
    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });

  it("ORDERING GUARD: the autosave DOES fire in the empty-registry (snapshot=0) drain→park window, and the freeze keeps the session unnulled", async () => {
    autosaveEvals = [];
    await Effect.runPromise(restartLocalDaemon());

    expect(autosaveEvals).toContain(0);
    expect(getSavedSession()?.terminals.length).toBe(2);
    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });

  it("NO-SHRINK: a restart with a restore ALREADY pending (parked) + a live terminal preserves the UNION (N+1), never the shrunken 1-record blob", async () => {
    for (const [id] of [...terminalEntries()]) unregisterTerminal(id);

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
    parkSavedSession();
    expect(getTerminal(P1)?.meta.state).toBe("parked");
    expect(getTerminal(P2)?.meta.state).toBe("parked");

    seedActive(A_ID, "/live");
    expect(snapshotSession().terminals.map((t) => t.id)).toEqual([A_ID]);

    await Effect.runPromise(restartLocalDaemon());

    expect(
      getSavedSession()
        ?.terminals.map((t) => t.id)
        .sort(),
    ).toEqual([P1, P2, A_ID].sort());
    const parkedIds = [...terminalEntries()]
      .filter(([, e]) => e.meta.state === "parked")
      .map(([id]) => id)
      .sort();
    expect(parkedIds).toEqual([P1, P2, A_ID].sort());
  });
});
