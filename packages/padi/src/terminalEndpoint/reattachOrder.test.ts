/**
 * A survivor reattach must rebuild the registry in SAVED ORDER.
 *
 * The registry is a `Map`, and `listTerminals` contracts that its insertion
 * order IS the client's row order ("new terminals append to the tail; clients
 * render this order directly"). Since juspay/kolu#2141 the dock consumes that
 * order verbatim — repo → branch → creation — instead of re-sorting every level
 * by recency, and `Cmd+1..9` is bound to the result. So an insertion order that
 * quietly disagrees with the saved session is no longer a cosmetic detail: it
 * moves rows a user has learned the position of.
 *
 * The seam these pin: `adoptSurvivingSession` used to rebuild in two passes —
 * every adopted ACTIVE first, then every SLEEPING record — so a session saved as
 * [active, sleeping, active] came back as [active, active, sleeping]. Every ☾
 * tile jumped to the bottom of its repo section on a padi restart, and since
 * dock SECTION order is decided by each repo's first row, a repo whose earliest
 * terminal was the sleeper lost its section position too. It is one walk now.
 *
 * The cold-boot restore path (`restoreSession`) already walked its saved list
 * once, in order; this is the survivor path agreeing with it.
 */

import type { PtyHostListEntry } from "kaval";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listEntries = vi.hoisted(() => ({ value: [] as PtyHostListEntry[] }));
const killed = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { Stream } = await import("effect");
  // Same surviving-daemon double as `adoptTolerance.test.ts`: empty per-terminal
  // taps (adoption must not depend on a sensor emitting, and an ABSENT tap would
  // make adoption reap the PTY under test), and a recording `kill`.
  const emptyTap = () => Stream.empty;
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
        cwd: { get: emptyTap },
        title: { get: emptyTap },
        commandRun: { get: emptyTap },
        foreground: { get: emptyTap },
        exit: { get: emptyTap },
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
import {
  encodeHostLocation,
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
  type SavedTerminal,
} from "../vocab.ts";
import { adoptSurvivingSession } from "./reattach.ts";

setDaemonProcessId("reattach-order-test-server");

const FIRST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLEEPER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LAST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORPHAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const base = {
  git: null,
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
  // A GENUINE survivor (same kaval process across the redeploy), so the boot
  // takes the converge path rather than the replaced-daemon park.
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
    // Both actives survived; the sleeper released its PTY at sleep, so it is
    // seeded rather than adopted — which is exactly why it used to be seeded in
    // a separate pass, at the tail.
    listEntries.value = [liveEntry(FIRST, "/first"), liveEntry(LAST, "/last")];

    await Effect.runPromise(adoptSurvivingSession);
    await new Promise((r) => setTimeout(r, 0));

    expect([...terminalEntries()].map(([id]) => id)).toEqual([
      FIRST,
      SLEEPER,
      LAST,
    ]);
    // Nothing was reaped on the way — the ordering fix must not cost a survivor.
    expect(killed.ids).toEqual([]);
  });

  it("appends a true orphan last — it has no saved position and IS the newest", async () => {
    setSavedSession({
      terminals: [active(FIRST, "/first"), sleeping(SLEEPER, "/sleeper")],
      activeTerminalId: FIRST,
      savedAt: 1,
    });
    // A create the debounced autosave never saw. The daemon happens to list it
    // FIRST, so this also pins that the daemon's list order does not decide the
    // position of terminals that do have a saved one.
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
