import { Effect } from "effect";
import type { PtyHostListEntry } from "kaval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listEntries = vi.hoisted(() => ({ value: [] as PtyHostListEntry[] }));
const killed = vi.hoisted(() => ({ ids: [] as string[] }));
const logCalls = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { emptySensorTaps } = await import("./sensorTaps.testlib.ts");
  return {
    ...actual,
    ptyHostClient: {
      surface: {
        terminal: {
          list: () => Effect.succeed({ entries: listEntries.value }),
          kill: ({ id }: { id: string }) =>
            Effect.sync(() => {
              killed.ids.push(id);
            }),
        },
        ...emptySensorTaps(),
      },
    },
  };
});
vi.mock("../log.ts", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: logCalls.warn,
    error: logCalls.error,
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: logCalls.warn,
      error: logCalls.error,
    }),
  },
}));

import {
  encodeHostLocation,
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
} from "@kolu/padi-client/surface";
import { inMemoryStore } from "@kolu/surface/server";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { publishDaemonStatus } from "../ptyHost/daemonStatus.ts";
import { unreachableDispatch } from "../ptyHost/dispatch.testlib.ts";
import { setPadiLastPairedDaemonStore } from "../session/confStores.ts";
import type { PairedDaemon } from "../session/pairedDaemon.ts";
import { getSavedSession, setSavedSession } from "../session/session.ts";
import {
  getTerminal,
  terminalEntries,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { adoptSurvivingSession } from "./reattach.ts";

setDaemonProcessId("adopt-tolerance-test-server");

const GOOD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUTURE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const base = {
  git: { kind: "none" as const },
  pr: { kind: "absent" } as const,
  location: LOCAL_LOCATION,
};

function active(id: string, cwd: string): SavedActiveTerminal {
  return {
    ...base,
    id,
    state: "active",
    cwd,
    lastActivityAt: 5,
    promptedAt: null,
    themeName: "Dracula",
    intent: "saved intent",
    restoreTarget: { kind: "none" },
  };
}

function futureAgentActive(id: string, cwd: string): SavedActiveTerminal {
  return {
    ...active(id, cwd),
    restoreTarget: {
      kind: "exact",
      agent: {
        kind: "an-agent-kind-from-the-future",
        sessionId: "019fdd5e-7524-793f-acbc-66250aac65ea",
      },
      argv: [],
    },
  } as unknown as SavedActiveTerminal;
}

function liveEntry(id: string, cwd: string): PtyHostListEntry {
  return { id, pid: 4242, cwd, lastActivity: 0 };
}

function sessionBackedPadiCtx(): ReturnType<typeof noopPadiSurfaceCtxForTest> {
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

function connectDaemon(startedAt: number): void {
  publishDaemonStatus(encodeHostLocation(LOCAL_LOCATION), {
    state: "connected",
    identity: undefined,
    startedAt,
    metadata: {
      contractVersion: "test",
      pid: 4242,
      dispatch: unreachableDispatch,
    },
  });
}

beforeEach(() => {
  listEntries.value = [];
  killed.ids = [];
  setPadiSurfaceCtx(sessionBackedPadiCtx());
  setPadiLastPairedDaemonStore(
    inMemoryStore<PairedDaemon | null>({ startedAt: 1000 }),
  );
  connectDaemon(1000);
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
  vi.clearAllMocks();
  for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
  __resetPadiSurfaceCtxForTest();
});

describe("adoptSurvivingSession — an undecodable saved record must not cost the host its terminals (#2122)", () => {
  function seedIncident(): void {
    setSavedSession({
      terminals: [
        active(GOOD_ID, "/good"),
        futureAgentActive(FUTURE_ID, "/future"),
        active(OTHER_ID, "/other"),
      ],
      activeTerminalId: GOOD_ID,
      savedAt: 1,
    });
    listEntries.value = [
      liveEntry(GOOD_ID, "/good"),
      liveEntry(FUTURE_ID, "/future"),
      liveEntry(OTHER_ID, "/other"),
    ];
  }

  it("does not throw — so the boot never reaches its fail-closed daemon recycle", async () => {
    seedIncident();
    await expect(
      Effect.runPromise(adoptSurvivingSession),
    ).resolves.toBeUndefined();
  });

  it("adopts EVERY live PTY — the decodable ones and the undecodable one alike", async () => {
    seedIncident();
    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    for (const id of [GOOD_ID, FUTURE_ID, OTHER_ID]) {
      expect(getTerminal(id)?.meta.state).toBe("active");
    }
  });

  it("never kills a survivor merely because its saved record would not decode (F1)", async () => {
    seedIncident();
    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect(killed.ids).toEqual([]);
  });

  it("the undecodable record's terminal keeps its LIVE identity, seeded from the daemon snapshot", async () => {
    seedIncident();
    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    const adopted = getTerminal(FUTURE_ID);
    expect(adopted?.info.pid).toBe(4242);
    expect(adopted?.snapshot.cwd).toBe("/future");
  });

  it("the DECODABLE records still ride through whole — one bad record costs only itself", async () => {
    seedIncident();
    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    const good = getTerminal(GOOD_ID);
    expect(good?.meta.themeName).toBe("Dracula");
    expect(good?.meta.intent).toBe("saved intent");
  });

  it("says WHICH record it could not decode, rather than dropping it silently", async () => {
    seedIncident();
    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect(logCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({ id: FUTURE_ID }),
      expect.stringContaining("adopt"),
    );
  });

  it("the converged session keeps every adopted terminal", async () => {
    seedIncident();
    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect(
      getSavedSession()
        ?.terminals.map((t) => t.id)
        .sort(),
    ).toEqual([GOOD_ID, FUTURE_ID, OTHER_ID].sort());
  });
});
