import { Effect } from "effect";
import type { PtyHostListEntry } from "kaval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unreachableDispatch } from "../ptyHost/dispatch.testlib.ts";

const listEntries = vi.hoisted(() => ({ value: [] as PtyHostListEntry[] }));
const logCalls = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  return {
    ...actual,
    ptyHostClient: {
      surface: {
        terminal: {
          list: () => Effect.succeed({ entries: listEntries.value }),
          kill: () => Effect.void,
        },
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
  },
}));

import {
  encodeHostLocation,
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
  type SavedTerminal,
} from "@kolu/padi-client/surface";
import { inMemoryStore } from "@kolu/surface/server";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { publishDaemonStatus } from "../ptyHost/daemonStatus.ts";
import { setPadiLastPairedDaemonStore } from "../session/confStores.ts";
import type { PairedDaemon } from "../session/pairedDaemon.ts";
import { getSavedSession, setSavedSession } from "../session/session.ts";
import {
  getTerminal,
  terminalEntries,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { adoptSurvivingSession } from "./reattach.ts";

setDaemonProcessId("reattach-test-server");

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    restoreTarget: { kind: "none" },
  };
}

function savedSession(): SavedSession {
  return {
    terminals: [active(A_ID, "/a"), active(B_ID, "/b")],
    activeTerminalId: A_ID,
    savedAt: 1,
  };
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

function clearRegistry(): void {
  for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
}

beforeEach(() => {
  listEntries.value = [];
  setPadiSurfaceCtx(sessionBackedPadiCtx());
  setPadiLastPairedDaemonStore(inMemoryStore<PairedDaemon | null>(null));
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  clearRegistry();
  __resetPadiSurfaceCtxForTest();
});

describe("adoptSurvivingSession — the session-clobber regression (PATH A)", () => {
  it("(i) adopting an EMPTY daemon PRESERVES a non-empty active saved session (never erases it)", async () => {
    setSavedSession(savedSession());
    expect(getSavedSession()?.terminals.length).toBe(2);

    listEntries.value = [];
    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect(getSavedSession()?.terminals.length).toBe(2);
  });

  it("(i) …and PARKS the saved actives so the restore card is offered", async () => {
    setSavedSession(savedSession());
    listEntries.value = [];

    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });
});

describe("adoptSurvivingSession — currency diagnostics", () => {
  it("logs a connected status missing its required identity as an error", async () => {
    vi.stubEnv("KAVAL_BUILD_ID", "expected-build");
    vi.stubEnv("KAVAL_COMMIT_HASH", "expected-commit");
    connectDaemon(1000);

    await Effect.runPromise(adoptSurvivingSession);

    expect(logCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.objectContaining({
          state: "connected",
          identity: undefined,
        }),
      }),
      "kaval currency: adopted daemon status has no identity",
    );
  });
});

const S_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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

describe("adoptSurvivingSession — daemon-identity gate (PATH A, by startedAt)", () => {
  it("REPLACED daemon (startedAt MISMATCH) preserves the session + parks — even though it adopted", async () => {
    setPadiLastPairedDaemonStore(
      inMemoryStore<PairedDaemon | null>({ startedAt: 1000 }),
    );
    connectDaemon(2000);
    setSavedSession(savedSession());
    listEntries.value = [];

    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect(getSavedSession()?.terminals.length).toBe(2);
    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });

  it("(ii) GENUINE survivor (startedAt MATCH) converges — prunes exited actives, keeps dormant, never parks", async () => {
    setPadiLastPairedDaemonStore(
      inMemoryStore<PairedDaemon | null>({ startedAt: 1000 }),
    );
    connectDaemon(1000);
    const sleeper: SavedTerminal = {
      ...base,
      id: S_ID,
      state: "sleeping",
      sleptAt: 111,
      cwd: "/s",
      lastActivityAt: 3,
      promptedAt: null,
    };
    setSavedSession({
      terminals: [active(A_ID, "/a"), sleeper],
      activeTerminalId: A_ID,
      savedAt: 1,
    });
    listEntries.value = [];

    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect(getTerminal(A_ID)).toBeUndefined();
    expect(getTerminal(S_ID)?.meta.state).toBe("sleeping");
    expect(getSavedSession()?.terminals.map((t) => t.id)).toEqual([S_ID]);
  });

  it("(2b) genuine survivor whose PTYs ALL exited during downtime clears the session (observed all-exited)", async () => {
    setPadiLastPairedDaemonStore(
      inMemoryStore<PairedDaemon | null>({ startedAt: 1000 }),
    );
    connectDaemon(1000);
    setSavedSession(savedSession());
    listEntries.value = [];

    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect(getSavedSession()).toBeNull();
    expect(getTerminal(A_ID)).toBeUndefined();
  });

  it("no recorded pairing (store returns UNDEFINED, as the real conf store does) → preserves + parks, never throws", async () => {
    setPadiLastPairedDaemonStore({
      get: () => undefined,
      set: () => {},
    } as unknown as Parameters<typeof setPadiLastPairedDaemonStore>[0]);
    connectDaemon(2000);
    setSavedSession(savedSession());
    listEntries.value = [];

    await expect(
      Effect.runPromise(adoptSurvivingSession),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));

    expect(getSavedSession()?.terminals.length).toBe(2);
    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });
});
