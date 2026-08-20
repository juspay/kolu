/**
 * A mid-session link heal must RE-WIRE, never RE-ADOPT (juspay/kolu#2182).
 *
 * The heal exists because padi's held connection to kaval can die while kaval is
 * perfectly healthy — the field incident this PR fixes. What dies with the link
 * is the per-terminal taps: they are bridged ONCE, with no re-subscribe loop of
 * their own, so a healed terminal needs its sensor set re-installed.
 *
 * The trap this file pins is the shortcut of re-running the BOOT's adopt hook to
 * get that. Boot adoption reconciles a SAVED SESSION into an EMPTY registry;
 * mid-session neither premise holds, and running it over a live registry does
 * four kinds of damage to a session that was never lost:
 *
 *   1. it re-registers each terminal from the saved record, rewinding any chrome
 *      newer than the last autosave — which `saveSession` then PERSISTS;
 *   2. a terminal born inside the 500ms autosave debounce is not in the saved
 *      session at all, so it adopts as an ORPHAN and loses its chrome entirely;
 *   3. it stamps `adoptedAt`, so the client announces "N terminals reattached" —
 *      a boot-adoption sentence about a session that never left;
 *   4. a sensor-wiring throw reaps the PTY as a half-wired orphan, killing a
 *      terminal the user is looking at.
 *
 * The assertions below are written against fields the saved record and the live
 * registry entry deliberately DISAGREE on. That is the whole point: a test whose
 * hook is a bare counter cannot see a rewind, which is exactly how this survived
 * two earlier review rounds.
 */

import type { PtyHostListEntry } from "kaval";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listEntries = vi.hoisted(() => ({ value: [] as PtyHostListEntry[] }));
const listFails = vi.hoisted(() => ({ value: false }));
const taps = vi.hoisted(() => ({ opened: [] as string[] }));
const killed = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { Stream } = await import("effect");
  // Empty taps, for the reason `adoptTolerance.test.ts` names: re-wiring must not
  // depend on any sensor emitting, and a MISSING tap would make the wiring throw
  // — which is a different case, pinned separately below.
  const tap = (name: string) => () => {
    taps.opened.push(name);
    return Stream.empty;
  };
  return {
    ...actual,
    ptyHostClient: {
      surface: {
        terminal: {
          list: () =>
            listFails.value
              ? Effect.fail(new Error("daemon refused to list"))
              : Effect.succeed({ entries: listEntries.value }),
          kill: ({ id }: { id: string }) =>
            Effect.sync(() => {
              killed.ids.push(id);
            }),
        },
        cwd: { get: tap("cwd") },
        title: { get: tap("title") },
        commandRun: { get: tap("commandRun") },
        foreground: { get: tap("foreground") },
        exit: { get: tap("exit") },
      },
    },
  };
});

import { inMemoryStore } from "@kolu/surface/server";
import { setPadiLastPairedDaemonStore } from "../session/confStores.ts";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import type { PairedDaemon } from "../session/pairedDaemon.ts";
import {
  publishDaemonStatus,
  readDaemonStatus,
} from "../ptyHost/daemonStatus.ts";
import { unreachableDispatch } from "../ptyHost/dispatch.testlib.ts";
import { setSavedSession } from "../session/session.ts";
import {
  getTerminal,
  terminalEntries,
  unregisterTerminal,
} from "../terminal-registry.ts";
import {
  encodeHostLocation,
  LOCAL_LOCATION,
  type SavedActiveTerminal,
} from "../vocab.ts";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { adoptLocalTerminal, rewireLocalSurvivor } from "./local.ts";
import { rewireSurvivingSession } from "./reattach.ts";

setDaemonProcessId("heal-rewire-test-server");

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const YOUNG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** The chrome the user had at the moment the link died. */
const LIVE_INTENT = "what the user renamed it to after the last autosave";
/** The chrome the last autosave captured — deliberately DIFFERENT, so a rewind
 *  to the saved record is visible as an assertion rather than invisible. */
const SAVED_INTENT = "stale intent from the last autosave";

function savedActive(id: string): SavedActiveTerminal {
  return {
    id,
    state: "active",
    cwd: "/repo",
    lastActivityAt: 5,
    themeName: "Dracula",
    intent: SAVED_INTENT,
    restoreTarget: { kind: "none" },
    git: null,
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

/** Put a terminal in the registry the way a live session holds it: adopt it once
 *  (the boot), then rename it the way a user would AFTER the last autosave. The
 *  registry now disagrees with the saved record, which is the state a heal must
 *  not resolve by reaching for the saved side. */
function seedLiveTerminal(id: string): void {
  adoptLocalTerminal(savedActive(id), liveEntry(id));
  const entry = getTerminal(id as TerminalId);
  if (!entry) throw new Error(`seed failed: ${id} did not register`);
  (entry.meta as { intent?: string }).intent = LIVE_INTENT;
}

beforeEach(() => {
  listEntries.value = [];
  listFails.value = false;
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

    // The five per-terminal taps are bridged once each; re-wiring opens them
    // again, which is the entire job the heal has.
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
    // The saved session still holds the OLD name — the exact disagreement a
    // re-adoption would resolve in favour of the saved side, then persist.
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
    // Clear whatever the seeding adoption stamped, so this asserts the HEAL.
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
    // A PTY that appeared while the link was down: live on the daemon, no
    // registry entry. Adoption would invent one from the saved session (or as an
    // orphan); the heal must leave it alone.
    listEntries.value = [liveEntry(ID), liveEntry(YOUNG_ID)];

    await Effect.runPromise(rewireSurvivingSession);

    expect(getTerminal(YOUNG_ID as TerminalId)).toBeUndefined();
    expect(rewireLocalSurvivor(liveEntry(YOUNG_ID))).toBe(false);
  });

  it("never kills a terminal — a live PTY is not a half-wired orphan", async () => {
    seedLiveTerminal(ID);
    listEntries.value = [liveEntry(ID), liveEntry(YOUNG_ID)];

    await Effect.runPromise(rewireSurvivingSession);

    // The boot reaps a survivor it could not wire, because at boot such a PTY is
    // an orphan nothing else will claim. Mid-session the same reap would kill a
    // terminal the user is typing into.
    expect(killed.ids).toEqual([]);
  });

  it("absorbs a failed list instead of failing closed — a heal must never trigger a recycle", async () => {
    seedLiveTerminal(ID);
    listFails.value = true;

    // Boot adoption propagates a list failure ON PURPOSE, so the boot recycles a
    // daemon that may hold PTYs kolu cannot see. Mid-session every live PTY
    // already HAS an entry, so there is no hidden-terminal hazard — and a recycle
    // here would destroy the session the heal was invoked to save.
    await Effect.runPromise(rewireSurvivingSession);

    expect(getTerminal(ID as TerminalId)).toBeDefined();
    expect(killed.ids).toEqual([]);
  });
});
