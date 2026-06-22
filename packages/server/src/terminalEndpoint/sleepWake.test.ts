/**
 * Sleep / wake state-machine tests — the pty-host-free transitions.
 *
 * R8: a terminal's OBSERVED state (cwd/git/pr/lastAgentCommand/agentSession) lives
 * in the in-process awareness store, not kolu's record. So sleep SAMPLES the
 * observation into the frozen dormant snapshot, and wake re-SEEDS the observation
 * from it. These pin:
 *   - sleep flips the SAME registry entry to the sleeping arm IN PLACE, freezing
 *     the sampled observation (incl. `lastAgentCommand`, the resume input, and a
 *     `pr` snapshot) and dropping the live overlay (agent/foreground);
 *   - the slept entry serializes through the SAVED sleeping arm;
 *   - `wakeMeta` splits a sleeping record into the AUTHORED active arm + the
 *     re-seeded observation (the frozen `pr` discarded — re-derived on re-spawn);
 *   - discard removes only a sleeping record.
 *
 * Wake's PTY re-spawn + agent replay is exercised end-to-end by the
 * `sleeping-terminals.feature` journey on CI; here we pin the pure mappings and
 * the synchronous registry flips.
 */

import { resumeFormFor } from "anyagent/cli";
import {
  type AwarenessValue,
  type KoluActiveTerminal,
  LOCAL_LOCATION,
  SavedTerminalSchema,
  type SleepingTerminal,
} from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSurfaceCtxForTest,
  noopSurfaceCtxForTest,
  setSurfaceCtx,
} from "../surfaceCtx.ts";
import {
  __resetWorkspaceSurfaceCtxForTest,
  noopWorkspaceSurfaceCtxForTest,
  setWorkspaceSurfaceCtx,
} from "../workspaceSurfaceCtx.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  registerTerminal,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { snapshotSession } from "../terminals.ts";
import {
  beginSleepLocal,
  discardLocalSleeping,
  seedSleepingTerminal,
  wakeLocalTerminal,
  wakeMeta,
} from "./local.ts";
import { forgetAwareness, setAwareness } from "./workspaceSurface.ts";

const ID = "11111111-1111-4111-8111-111111111111";

/** kolu's AUTHORED active record — location + chrome + state, NO observed fields. */
function activeEntry(): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 4242 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      themeName: "rose",
      intent: "fix the auth race",
    } satisfies KoluActiveTerminal,
    // The publish path never reads the handle in these tests.
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

/** The live OBSERVATION the sensors would have published for `ID` — what sleep
 *  SAMPLES into the frozen dormant snapshot. A RESOLVED `pr` so the sleep-time
 *  snapshot is meaningful, and the exact-conversation ref (#1495). */
const OBSERVATION: AwarenessValue = {
  cwd: "/work/repo",
  git: null,
  lastActivityAt: 123,
  lastAgentCommand: "opencode --model sonnet",
  agentSession: { kind: "opencode", id: "ses_118316090ffewMmbj6bsfKwj4R" },
  pr: {
    kind: "ok",
    value: {
      number: 42,
      title: "Fix the auth race",
      url: "https://github.com/o/r/pull/42",
      state: "open",
      checks: "pass",
      checkRuns: [],
    },
  },
  agent: null,
  foreground: null,
};

/** Register an active terminal AND seed its observation into the store, so a
 *  subsequent `beginSleep` samples real values (the sensors would have published
 *  them in production). */
function registerActiveWithObservation(): void {
  registerTerminal(ID, activeEntry());
  setAwareness(ID, OBSERVATION);
}

beforeEach(() => {
  setSurfaceCtx(noopSurfaceCtxForTest());
  setWorkspaceSurfaceCtx(noopWorkspaceSurfaceCtxForTest());
});

afterEach(() => {
  unregisterTerminal(ID);
  forgetAwareness(ID);
  __resetSurfaceCtxForTest();
  __resetWorkspaceSurfaceCtxForTest();
});

describe("beginSleep — flip active → sleeping, sampling the observation", () => {
  it("keeps the SAME id, freezes the sampled observation, releases the handle", () => {
    registerActiveWithObservation();
    expect(beginSleepLocal(ID)).toBe(true);

    const entry = getTerminal(ID);
    expect(entry).toBeDefined();
    if (entry?.meta.state !== "sleeping") throw new Error("expected sleeping");

    // Sampled observation frozen onto the dormant snapshot — incl. lastAgentCommand
    // (the resume input) and the exact-conversation ref (juspay/kolu#1495).
    expect(entry.meta.lastAgentCommand).toBe("opencode --model sonnet");
    expect(entry.meta.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });
    expect(entry.meta.cwd).toBe("/work/repo");
    // Authored chrome rides through from kolu's record.
    expect(entry.meta.themeName).toBe("rose");
    expect(entry.meta.intent).toBe("fix the auth race");
    expect(entry.meta.sleptAt).toBeGreaterThan(0);

    // Live overlay gone — agent/foreground absent. `pr` is the EXCEPTION: frozen as
    // a snapshot (asserted below). The observation store entry is dropped.
    const raw = entry.meta as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
    expect(raw.foreground).toBeUndefined();
    expect(entry.handle).toBeUndefined();
    expect(entry.info.id).toBe(ID);
  });

  it("is a no-op (returns false) on an absent id", () => {
    expect(beginSleepLocal(ID)).toBe(false);
  });

  it("is a no-op on an already-sleeping id (idempotent)", () => {
    registerActiveWithObservation();
    expect(beginSleepLocal(ID)).toBe(true);
    expect(beginSleepLocal(ID)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });

  it("freezes the last-known PR onto the sleeping arm (the dormant-tile metadata)", () => {
    registerActiveWithObservation();
    expect(beginSleepLocal(ID)).toBe(true);
    const entry = getTerminal(ID);
    if (entry?.meta.state !== "sleeping") throw new Error("expected sleeping");
    if (entry.meta.pr?.kind !== "ok") {
      throw new Error("expected a snapshotted resolved PR on the sleeping arm");
    }
    expect(entry.meta.pr.value.number).toBe(42);
    expect(entry.meta.pr.value.title).toBe("Fix the auth race");
  });
});

describe("snapshotSession — a slept terminal serializes through the sleeping arm", () => {
  it("emits state=sleeping + sleptAt, strips agent/foreground, keeps the pr snapshot + lastAgentCommand", () => {
    registerActiveWithObservation();
    beginSleepLocal(ID);

    const saved = snapshotSession().terminals.find((t) => t.id === ID);
    expect(saved).toBeDefined();
    if (saved?.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(saved.sleptAt).toBeGreaterThan(0);
    expect(saved.lastAgentCommand).toBe("opencode --model sonnet");
    expect(saved.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });

    expect(() => SavedTerminalSchema.parse(saved)).not.toThrow();
    const raw = saved as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
    expect(raw.foreground).toBeUndefined();
    expect(saved.pr?.kind).toBe("ok");
  });
});

describe("wakeMeta — splits a sleeping record into authored + re-seeded observation", () => {
  const sleeping: SleepingTerminal = {
    state: "sleeping",
    sleptAt: 999,
    cwd: "/work/repo",
    git: null,
    location: LOCAL_LOCATION,
    lastActivityAt: 5,
    lastAgentCommand: "opencode --model sonnet",
    agentSession: { kind: "opencode", id: "ses_118316090ffewMmbj6bsfKwj4R" },
    themeName: "rose",
    intent: "fix the auth race",
    // A frozen PR snapshot — wake DISCARDS it (the re-spawned PR sensor re-resolves).
    pr: {
      kind: "ok",
      value: {
        number: 42,
        title: "Fix the auth race",
        url: "https://github.com/o/r/pull/42",
        state: "open",
        checks: "pass",
        checkRuns: [],
      },
    },
  };

  it("authored arm: chrome + location + state, no observed fields", () => {
    const { authored } = wakeMeta(sleeping);
    expect(authored.state).toBe("active");
    expect(authored.themeName).toBe("rose");
    expect(authored.intent).toBe("fix the auth race");
    expect(authored.location).toEqual(LOCAL_LOCATION);
    expect((authored as Record<string, unknown>).sleptAt).toBeUndefined();
    expect((authored as Record<string, unknown>).cwd).toBeUndefined();
  });

  it("re-seeded observation: cwd/lastAgentCommand/agentSession ride through, live overlay reset", () => {
    const { awareness } = wakeMeta(sleeping);
    expect(awareness.cwd).toBe("/work/repo");
    expect(awareness.lastAgentCommand).toBe("opencode --model sonnet");
    expect(awareness.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });
    // The frozen `pr` is DISCARDED — re-derived by the re-spawned PTY's sensors.
    expect(awareness.pr).toEqual({ kind: "pending" });
    expect(awareness.agent).toBeNull();
    expect(awareness.foreground).toBeNull();
  });
});

describe("wake resume targets the EXACT conversation, not most-recent (juspay/kolu#1495)", () => {
  // Wake builds its resume input from the sleeping record's persisted base
  // (lastAgentCommand + agentSession) — mirroring `wake`'s `resumeFormFor(entry.meta)`
  // — never from the cwd's live state, so a terminal slept on conversation A
  // resumes A, not the folder's newest B.
  const CONV_A = "ses_AAAAAAAAAAAAAAAAAAAAAAAAA";
  const sleptOnA: SleepingTerminal = {
    state: "sleeping",
    sleptAt: 999,
    cwd: "/work/repo",
    git: null,
    location: LOCAL_LOCATION,
    lastActivityAt: 5,
    lastAgentCommand: "opencode --model sonnet",
    agentSession: { kind: "opencode", id: CONV_A },
    themeName: "rose",
    pr: { kind: "pending" },
  };

  it("builds a resume-by-id command for the slept conversation", () => {
    const resumeCommand = resumeFormFor(sleptOnA);
    expect(resumeCommand).toBe(`opencode --session ${CONV_A} --model sonnet`);
    expect(resumeCommand).not.toContain("--continue");
  });

  it("falls back to most-recent when no conversation ref was ever captured", () => {
    const { agentSession: _drop, ...noRef } = sleptOnA;
    const resumeCommand = resumeFormFor(noRef as SleepingTerminal);
    expect(resumeCommand).toBe("opencode --continue --model sonnet");
  });
});

describe("wake — a failed PTY spawn must NOT drop the sleeping record (F2)", () => {
  const WAKE_ID = "33333333-3333-4333-8333-333333333333";
  const sleepingRecord = () => ({
    id: WAKE_ID,
    state: "sleeping" as const,
    sleptAt: 222,
    cwd: "/work/repo",
    git: null,
    location: LOCAL_LOCATION,
    lastActivityAt: 7,
    lastAgentCommand: "claude --model sonnet",
  });

  afterEach(() => {
    unregisterTerminal(WAKE_ID);
    forgetAwareness(WAKE_ID);
  });

  it("restores the sleeping entry when the wake spawn fails", async () => {
    expect(seedSleepingTerminal(sleepingRecord())).toBe(true);

    wakeLocalTerminal(WAKE_ID);
    expect(getTerminal(WAKE_ID)?.meta.state).toBe("active");

    await new Promise((r) => setTimeout(r, 0));

    const entry = getTerminal(WAKE_ID);
    expect(entry).toBeDefined();
    if (entry?.meta.state !== "sleeping")
      throw new Error(
        "expected the sleeping record to be RESTORED, not dropped",
      );
    expect(entry.meta.lastAgentCommand).toBe("claude --model sonnet");
    expect(entry.meta.sleptAt).toBe(222);
    expect(entry.handle).toBeUndefined();
  });
});

describe("discardSleeping — removes only a sleeping record", () => {
  it("removes a sleeping record", () => {
    registerActiveWithObservation();
    beginSleepLocal(ID);
    expect(discardLocalSleeping(ID)).toBe(true);
    expect(getTerminal(ID)).toBeUndefined();
  });

  it("is a no-op on an active id (active terminals must be killed, not discarded)", () => {
    registerActiveWithObservation();
    expect(discardLocalSleeping(ID)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("active");
  });
});

describe("seedSleepingTerminal — boot seed with per-record tolerance", () => {
  const SEED_ID = "22222222-2222-4222-8222-222222222222";
  const validRecord = () => ({
    id: SEED_ID,
    state: "sleeping" as const,
    sleptAt: 111,
    cwd: "/work/repo",
    git: null,
    location: LOCAL_LOCATION,
    lastActivityAt: 5,
    lastAgentCommand: "claude --model sonnet",
  });

  afterEach(() => unregisterTerminal(SEED_ID));

  it("seeds a valid sleeping record into the registry, dormant (no handle)", () => {
    expect(seedSleepingTerminal(validRecord())).toBe(true);
    const entry = getTerminal(SEED_ID);
    if (entry?.meta.state !== "sleeping") throw new Error("expected sleeping");
    expect(entry.meta.lastAgentCommand).toBe("claude --model sonnet");
    expect(entry.meta.sleptAt).toBe(111);
    expect(entry.handle).toBeUndefined();
  });

  it("DROPS a malformed record (missing sleptAt) without throwing or polluting the set", () => {
    const malformed = { ...validRecord(), sleptAt: undefined };
    expect(seedSleepingTerminal(malformed as never)).toBe(false);
    expect(getTerminal(SEED_ID)).toBeUndefined();
  });

  it("DROPS a record with a non-uuid id", () => {
    const bad = { ...validRecord(), id: "not-a-uuid" };
    expect(seedSleepingTerminal(bad as never)).toBe(false);
  });

  it("is idempotent — re-seeding a present id is a no-op", () => {
    expect(seedSleepingTerminal(validRecord())).toBe(true);
    expect(seedSleepingTerminal(validRecord())).toBe(false);
    expect(getTerminal(SEED_ID)?.meta.state).toBe("sleeping");
  });
});
