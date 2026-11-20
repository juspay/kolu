import { Effect } from "effect";
import type { PtyHostListEntry } from "kaval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listEntries = vi.hoisted(() => ({ value: [] as PtyHostListEntry[] }));
const listFails = vi.hoisted(() => ({ value: false }));
const listDelay = vi.hoisted(() => ({
  value: undefined as undefined | (() => Promise<void>),
}));
const taps = vi.hoisted(() => ({ opened: [] as string[] }));
const killed = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { Stream } = await import("effect");
  const { emptySensorTaps } = await import("./sensorTaps.testlib.ts");
  return {
    ...actual,
    ptyHostClient: {
      surface: {
        terminal: {
          list: () =>
            listFails.value
              ? Effect.fail(new Error("daemon refused to list"))
              : Effect.promise(async () => {
                  const entries = listEntries.value;
                  await listDelay.value?.();
                  return { entries };
                }),
          kill: ({ id }: { id: string }) =>
            Effect.sync(() => {
              killed.ids.push(id);
            }),
        },
        ...emptySensorTaps((name) => ({
          get: () => {
            taps.opened.push(name);
            return Stream.empty;
          },
        })),
      },
    },
  };
});

import {
  encodeHostLocation,
  LOCAL_LOCATION,
  type SavedActiveTerminal,
} from "@kolu/padi-client/surface";
import { inMemoryStore } from "@kolu/surface/server";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import {
  publishDaemonStatus,
  readDaemonStatus,
} from "../ptyHost/daemonStatus.ts";
import { unreachableDispatch } from "../ptyHost/dispatch.testlib.ts";
import { setPadiLastPairedDaemonStore } from "../session/confStores.ts";
import type { PairedDaemon } from "../session/pairedDaemon.ts";
import { setSavedSession } from "../session/session.ts";
import {
  getTerminal,
  terminalEntries,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { adoptLocalTerminal, rewireLocalSurvivor } from "./local.ts";
import { rewireSurvivingSession } from "./reattach.ts";

setDaemonProcessId("heal-rewire-test-server");

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const YOUNG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const LIVE_INTENT = "what the user renamed it to after the last autosave";
const SAVED_INTENT = "stale intent from the last autosave";

function savedActive(id: string): SavedActiveTerminal {
  return {
    id,
    state: "active",
    cwd: "/repo",
    lastActivityAt: 5,
    promptedAt: null,
    themeName: "Dracula",
    intent: SAVED_INTENT,
    restoreTarget: { kind: "none" },
    git: { kind: "none" },
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
  };
}

function liveEntry(id: string): PtyHostListEntry {
  return { id, pid: 4242, cwd: "/repo", lastActivity: 0 };
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

function seedLiveTerminal(id: string): void {
  adoptLocalTerminal(savedActive(id), liveEntry(id));
  const entry = getTerminal(id as TerminalId);
  if (!entry) throw new Error(`seed failed: ${id} did not register`);
  (entry.meta as { intent?: string }).intent = LIVE_INTENT;
}

beforeEach(() => {
  listEntries.value = [];
  listFails.value = false;
  listDelay.value = undefined;
  taps.opened = [];
  killed.ids = [];
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
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

describe("a link heal re-wires the terminals padi holds (#2182)", () => {
  it("re-installs the sensor set of an already-held terminal", async () => {
    seedLiveTerminal(ID);
    listEntries.value = [liveEntry(ID)];
    taps.opened = [];

    await Effect.runPromise(rewireSurvivingSession);

    expect(taps.opened).toEqual(
      expect.arrayContaining([
        "cwd",
        "title",
        "commandRun",
        "foreground",
        "exit",
      ]),
    );
  });

  it("does NOT rewind chrome the user changed since the last autosave", async () => {
    seedLiveTerminal(ID);
    setSavedSession({
      terminals: [savedActive(ID)],
      activeTerminalId: ID,
      savedAt: 1,
    });
    listEntries.value = [liveEntry(ID)];

    await Effect.runPromise(rewireSurvivingSession);

    const entry = getTerminal(ID as TerminalId);
    expect((entry?.meta as { intent?: string }).intent).toBe(LIVE_INTENT);
  });

  it("does NOT stamp `adoptedAt` — nothing was adopted, so the client must not announce a reattach", async () => {
    seedLiveTerminal(ID);
    listEntries.value = [liveEntry(ID)];
    connectDaemon(1000);
    const before = readDaemonStatus(
      encodeHostLocation(LOCAL_LOCATION),
    )?.adoptedAt;

    await Effect.runPromise(rewireSurvivingSession);

    const after = readDaemonStatus(
      encodeHostLocation(LOCAL_LOCATION),
    )?.adoptedAt;
    expect(after).toBe(before);
  });

  it("claims nothing it does not already hold — an out-of-band PTY is the inventory reconciler's", async () => {
    seedLiveTerminal(ID);
    listEntries.value = [liveEntry(ID), liveEntry(YOUNG_ID)];

    await Effect.runPromise(rewireSurvivingSession);

    expect(getTerminal(YOUNG_ID as TerminalId)).toBeUndefined();
    expect(rewireLocalSurvivor(liveEntry(YOUNG_ID))).toBe("unknown");
  });

  it("never kills a terminal — a live PTY is not a half-wired orphan", async () => {
    seedLiveTerminal(ID);
    listEntries.value = [liveEntry(ID), liveEntry(YOUNG_ID)];

    await Effect.runPromise(rewireSurvivingSession);

    expect(killed.ids).toEqual([]);
  });

  it("FAILS when it cannot list, so the heal reports `incomplete` instead of announcing a restored link", async () => {
    seedLiveTerminal(ID);
    listFails.value = true;

    await expect(
      Effect.runPromise(rewireSurvivingSession),
    ).rejects.toBeDefined();

    expect(getTerminal(ID as TerminalId)).toBeDefined();
    expect(killed.ids).toEqual([]);
  });

  it("drops a terminal that EXITED while the link was down — its exit tap died with the link", async () => {
    seedLiveTerminal(ID);
    seedLiveTerminal(YOUNG_ID);
    listEntries.value = [liveEntry(ID)];

    await Effect.runPromise(rewireSurvivingSession);

    expect(getTerminal(ID as TerminalId)).toBeDefined();
    expect(getTerminal(YOUNG_ID as TerminalId)).toBeUndefined();
  });

  it("does not drop a terminal merely because re-wiring is happening — the live one survives", async () => {
    seedLiveTerminal(ID);
    listEntries.value = [liveEntry(ID)];

    await Effect.runPromise(rewireSurvivingSession);

    expect(getTerminal(ID as TerminalId)).toBeDefined();
  });

  it("never drops a terminal BORN while the list was in flight — it is absent from an answer that predates it", async () => {
    seedLiveTerminal(ID);
    listEntries.value = [liveEntry(ID)];
    listDelay.value = async () => {
      seedLiveTerminal(YOUNG_ID);
    };

    await Effect.runPromise(rewireSurvivingSession);

    expect(getTerminal(YOUNG_ID as TerminalId)).toBeDefined();
    expect(getTerminal(ID as TerminalId)).toBeDefined();
  });
});
