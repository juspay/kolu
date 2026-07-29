/**
 * Boot-adoption reconciliation (`adoptSurvivingSession`) — the SESSION-CLOBBER
 * regression fixtures.
 *
 * The zest incident: kolu-server boots, the supervisor ADOPTS a kaval at the
 * socket (gate + handshake pass), but that kaval is a REPLACED daemon — it was
 * restarted out-of-band, so it is empty (`terminal.list` → []). The converge then
 * ran `saveSession(snapshotSession())`, and with an empty registry `snapshotSession`
 * is `[]`, so `saveSession`'s empty→null erased the user's saved session — no
 * restore card ever showed (matching the user's report: their session vanished on a
 * restart).
 *
 * These pin the fix: an adopted daemon that cannot be OUR surviving daemon (its
 * live set is empty while the saved session still holds ACTIVE records — a genuine
 * survivor of an active session keeps its PTYs alive) is treated as a no-survivor
 * boot: the saved session is PRESERVED and its actives PARKED for the restore card,
 * exactly as `onNotAdopted` does — never converged-to-empty.
 *
 * The env has no kaval, so `ptyHostClient.surface.terminal.list` is stubbed via a
 * module mock; every assertion reads the SYNCHRONOUS registry / session state the
 * boot establishes.
 */

import type { PtyHostListEntry } from "kaval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The boot reconcile reads the surviving daemon's live PTYs off `ptyHostClient`.
// There is no kaval in the unit env, so stub the ONE call the empty-daemon path
// makes (`terminal.list`) to model a REPLACED, empty daemon; every other export
// (buildTerminalSpawnInput, …) rides through untouched.
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
        terminal: { list: async () => ({ entries: listEntries.value }) },
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

import { inMemoryStore } from "@kolu/surface/server";
import { setPadiLastPairedDaemonStore } from "../session/confStores.ts";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import type { PairedDaemon } from "../session/pairedDaemon.ts";
import { publishDaemonStatus } from "../ptyHost/daemonStatus.ts";
import { getSavedSession, setSavedSession } from "../session/session.ts";
import {
  getTerminal,
  terminalEntries,
  unregisterTerminal,
} from "../terminal-registry.ts";
import {
  encodeHostLocation,
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
  type SavedTerminal,
} from "../vocab.ts";
import { adoptSurvivingSession } from "./reattach.ts";

setDaemonProcessId("reattach-test-server");

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

/** A padi ctx whose `session` cell is a real in-memory store, so
 *  `setSavedSession` / `getSavedSession` round-trip; every other member no-op. */
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
  // No prior pairing recorded → the replacement check falls back to the
  // empty-daemon-vs-active-session heuristic (which is what the empty-daemon repro
  // below exercises). Individual tests re-inject a specific pairing as needed.
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

    // The adopted daemon is EMPTY (a replaced kaval) — the zest incident.
    listEntries.value = [];
    await adoptSurvivingSession();
    await new Promise((r) => setTimeout(r, 0));

    // The saved session must SURVIVE — on the pre-fix converge this is erased to
    // null (snapshotSession() === [] → saveSession's empty→null).
    expect(getSavedSession()?.terminals.length).toBe(2);
  });

  it("(i) …and PARKS the saved actives so the restore card is offered", async () => {
    setSavedSession(savedSession());
    listEntries.value = [];

    await adoptSurvivingSession();
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

    await adoptSurvivingSession();

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

/** Mark the local daemon connected with a given per-process `startedAt` so
 *  `adoptSurvivingSession`'s identity compare reads it (`readDaemonStatus`). The
 *  `identity`/`metadata` fields the connected `EndpointStatus` arm carries are
 *  immaterial to the startedAt gate under test, so they take placeholder values. */
function connectDaemon(startedAt: number): void {
  publishDaemonStatus(encodeHostLocation(LOCAL_LOCATION), {
    state: "connected",
    identity: undefined,
    startedAt,
    metadata: { contractVersion: "test" },
  });
}

describe("adoptSurvivingSession — daemon-identity gate (PATH A, by startedAt)", () => {
  it("REPLACED daemon (startedAt MISMATCH) preserves the session + parks — even though it adopted", async () => {
    // We were paired with a kaval booted at t=1000; the adopted daemon booted at
    // t=2000 — a different process (restarted out-of-band). Its (empty) live set is
    // NOT our session's, so converging against it would erase the session.
    setPadiLastPairedDaemonStore(
      inMemoryStore<PairedDaemon | null>({ startedAt: 1000 }),
    );
    connectDaemon(2000);
    setSavedSession(savedSession());
    listEntries.value = [];

    await adoptSurvivingSession();
    await new Promise((r) => setTimeout(r, 0));

    expect(getSavedSession()?.terminals.length).toBe(2);
    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });

  it("(ii) GENUINE survivor (startedAt MATCH) converges — prunes exited actives, keeps dormant, never parks", async () => {
    // Same kaval process across a kolu-server redeploy (t=1000 both times) → OUR
    // survivor → the normal converge. A saved ACTIVE with no live PTY exited during
    // downtime and drops; a saved SLEEPING record is seeded dormant and kept. This is
    // byte-identical to the pre-fix converge — the identity match takes the survivor
    // path even though the live set is empty and the session has an active record
    // (the very shape that, WITHOUT a matching pairing, reads as a replacement).
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
    };
    setSavedSession({
      terminals: [active(A_ID, "/a"), sleeper],
      activeTerminalId: A_ID,
      savedAt: 1,
    });
    listEntries.value = [];

    await adoptSurvivingSession();
    await new Promise((r) => setTimeout(r, 0));

    // A (active, no live PTY) is an exited shell — pruned; NOT parked.
    expect(getTerminal(A_ID)).toBeUndefined();
    // S (sleeping) is seeded dormant and kept.
    expect(getTerminal(S_ID)?.meta.state).toBe("sleeping");
    // The converged session holds exactly the surviving dormant record.
    expect(getSavedSession()?.terminals.map((t) => t.id)).toEqual([S_ID]);
  });

  it("(2b) genuine survivor whose PTYs ALL exited during downtime clears the session (observed all-exited)", async () => {
    // Identity MATCH + empty live + only active saved records → every terminal truly
    // ended → the session clears, exactly `handleExit`'s behaviour. This clear is now
    // GATED behind the identity check: an empty REPLACED daemon (above) preserves, an
    // empty GENUINE survivor clears — the whole point of the fix.
    setPadiLastPairedDaemonStore(
      inMemoryStore<PairedDaemon | null>({ startedAt: 1000 }),
    );
    connectDaemon(1000);
    setSavedSession(savedSession());
    listEntries.value = [];

    await adoptSurvivingSession();
    await new Promise((r) => setTimeout(r, 0));

    expect(getSavedSession()).toBeNull();
    expect(getTerminal(A_ID)).toBeUndefined();
  });

  it("no recorded pairing (store returns UNDEFINED, as the real conf store does) → preserves + parks, never throws", async () => {
    // The fresh-boot zest path: server#1 never converged onto a survivor, so
    // `recordPairedDaemon` never ran and the conf key is absent — the store's `get()`
    // returns `undefined`, NOT `null`. Pre-fix, that `undefined` slipped past the
    // `lastPaired !== null` guard and threw on `.startedAt`, failing the boot CLOSED
    // (recycle) instead of cleanly preserving + parking. The empty adopted daemon
    // must still be treated as replaced — session intact, actives parked, no throw.
    setPadiLastPairedDaemonStore({
      get: () => undefined,
      set: () => {},
    } as unknown as Parameters<typeof setPadiLastPairedDaemonStore>[0]);
    connectDaemon(2000);
    setSavedSession(savedSession());
    listEntries.value = [];

    await expect(adoptSurvivingSession()).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));

    expect(getSavedSession()?.terminals.length).toBe(2);
    expect(getTerminal(A_ID)?.meta.state).toBe("parked");
    expect(getTerminal(B_ID)?.meta.state).toBe("parked");
  });
});
