import { Effect } from "effect";
import type { PtyHostListEntry } from "kaval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listEntries = vi.hoisted(() => ({ value: [] as PtyHostListEntry[] }));
const killed = vi.hoisted(() => ({ ids: [] as string[] }));

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
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
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
import { unreachableDispatch } from "../ptyHost/dispatch.testlib.ts";
import { setPadiLastPairedDaemonStore } from "../session/confStores.ts";
import type { PairedDaemon } from "../session/pairedDaemon.ts";
import { setSavedSession } from "../session/session.ts";
import { terminalEntries, unregisterTerminal } from "../terminal-registry.ts";
import { adoptSurvivingSession } from "./reattach.ts";

setDaemonProcessId("reattach-order-test-server");

const FIRST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLEEPER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LAST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORPHAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
    restoreTarget: { kind: "none" },
  };
}

function sleeping(id: string, cwd: string): SavedTerminal {
  return {
    ...base,
    id,
    state: "sleeping",
    cwd,
    sleptAt: 10,
    themeName: "Dracula",
  } as SavedTerminal;
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

describe("adoptSurvivingSession — registry order after a survivor reattach", () => {
  it("rebuilds in SAVED order, with a sleeping record keeping its slot between two actives", async () => {
    setSavedSession({
      terminals: [
        active(FIRST, "/first"),
        sleeping(SLEEPER, "/sleeper"),
        active(LAST, "/last"),
      ],
      activeTerminalId: FIRST,
      savedAt: 1,
    });
    listEntries.value = [liveEntry(FIRST, "/first"), liveEntry(LAST, "/last")];

    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect([...terminalEntries()].map(([id]) => id)).toEqual([
      FIRST,
      SLEEPER,
      LAST,
    ]);
    expect(killed.ids).toEqual([]);
  });

  it("appends a true orphan last — it has no saved position and IS the newest", async () => {
    setSavedSession({
      terminals: [active(FIRST, "/first"), sleeping(SLEEPER, "/sleeper")],
      activeTerminalId: FIRST,
      savedAt: 1,
    });
    listEntries.value = [
      liveEntry(ORPHAN, "/orphan"),
      liveEntry(FIRST, "/first"),
    ];

    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect([...terminalEntries()].map(([id]) => id)).toEqual([
      FIRST,
      SLEEPER,
      ORPHAN,
    ]);
  });
});
