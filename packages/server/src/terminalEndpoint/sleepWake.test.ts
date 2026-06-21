/**
 * Sleep / wake state-machine tests — the pty-host-free transitions.
 *
 * These pin the invariants the discarded first cut (PR #1466) violated:
 *   - sleep flips the SAME registry entry to the sleeping arm IN PLACE,
 *     dropping the live overlay but KEEPING the persisted base — crucially
 *     `lastAgentCommand`, the resume input (BUG-B was that the agent got
 *     stripped, so wake resumed nothing);
 *   - the slept entry serializes through the SAVED sleeping arm (no live
 *     overlay leaks to disk);
 *   - wake re-derives a fresh active meta whose persisted base rode through
 *     WHOLE (so the resume form can be built);
 *   - discard removes only a sleeping record, never an active one.
 *
 * Wake's PTY re-spawn + agent replay is exercised end-to-end by the
 * `sleeping-terminals.feature` journey on CI (needs a live pty-host); here we
 * pin the pure mapping `wakeMeta` and the synchronous registry flips.
 */

import {
  type ActiveTerminal,
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
  wakeMeta,
} from "./local.ts";

const ID = "11111111-1111-4111-8111-111111111111";

function activeEntry(): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 4242 },
    meta: {
      state: "active",
      cwd: "/work/repo",
      git: null,
      location: LOCAL_LOCATION,
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      lastActivityAt: 123,
      lastAgentCommand: "opencode --model sonnet",
      themeName: "rose",
      intent: "fix the auth race",
    },
    // The publish path never reads the handle in these tests.
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

beforeEach(() => {
  setSurfaceCtx(noopSurfaceCtxForTest());
});

afterEach(() => {
  unregisterTerminal(ID);
  __resetSurfaceCtxForTest();
});

describe("beginSleep — flip active → sleeping in place", () => {
  it("keeps the SAME id, drops the live overlay, preserves the persisted base, releases the handle", () => {
    registerTerminal(ID, activeEntry());
    expect(beginSleepLocal(ID)).toBe(true);

    const entry = getTerminal(ID);
    expect(entry).toBeDefined();
    if (entry?.meta.state !== "sleeping") throw new Error("expected sleeping");

    // Persisted base survives — incl. lastAgentCommand, the resume input
    // (the BUG-B guard: the discarded cut stripped this as "live overlay").
    expect(entry.meta.lastAgentCommand).toBe("opencode --model sonnet");
    expect(entry.meta.cwd).toBe("/work/repo");
    expect(entry.meta.themeName).toBe("rose");
    expect(entry.meta.intent).toBe("fix the auth race");
    expect(entry.meta.sleptAt).toBeGreaterThan(0);

    // Live overlay gone — absent by type AND at runtime.
    const raw = entry.meta as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
    expect(raw.pr).toBeUndefined();
    expect(raw.foreground).toBeUndefined();

    // No live PTY handle on a sleeping process.
    expect(entry.handle).toBeUndefined();
    // The same stable id rides on.
    expect(entry.info.id).toBe(ID);
  });

  it("is a no-op (returns false) on an absent id", () => {
    expect(beginSleepLocal(ID)).toBe(false);
  });

  it("is a no-op on an already-sleeping id (idempotent)", () => {
    registerTerminal(ID, activeEntry());
    expect(beginSleepLocal(ID)).toBe(true);
    expect(beginSleepLocal(ID)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });
});

describe("snapshotSession — a slept terminal serializes through the sleeping arm", () => {
  it("emits state=sleeping + sleptAt, strips the live overlay, keeps lastAgentCommand", () => {
    registerTerminal(ID, activeEntry());
    beginSleepLocal(ID);

    const saved = snapshotSession().terminals.find((t) => t.id === ID);
    expect(saved).toBeDefined();
    if (saved?.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(saved.sleptAt).toBeGreaterThan(0);
    expect(saved.lastAgentCommand).toBe("opencode --model sonnet");

    // It round-trips through the saved discriminated union — no live field leaked.
    expect(() => SavedTerminalSchema.parse(saved)).not.toThrow();
    const raw = saved as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
    expect(raw.pr).toBeUndefined();
  });
});

describe("wakeMeta — the inverse mapping (pure)", () => {
  const sleeping: SleepingTerminal = {
    state: "sleeping",
    sleptAt: 999,
    cwd: "/work/repo",
    git: null,
    location: LOCAL_LOCATION,
    lastActivityAt: 5,
    lastAgentCommand: "opencode --model sonnet",
    themeName: "rose",
    intent: "fix the auth race",
  };

  it("flips to active, rides the persisted base through WHOLE, and resets the live overlay", () => {
    const active: ActiveTerminal = wakeMeta(sleeping);
    expect(active.state).toBe("active");
    // Persisted base preserved (the resume input survives → wake can resume).
    expect(active.lastAgentCommand).toBe("opencode --model sonnet");
    expect(active.cwd).toBe("/work/repo");
    expect(active.themeName).toBe("rose");
    expect(active.intent).toBe("fix the auth race");
    // Live overlay re-seeded to defaults (sensors re-derive on the re-spawned PTY).
    expect(active.agent).toBeNull();
    expect(active.foreground).toBeNull();
    expect(active.pr).toEqual({ kind: "pending" });
    // The sleeping-only scalar is gone.
    expect((active as Record<string, unknown>).sleptAt).toBeUndefined();
  });
});

describe("discardSleeping — removes only a sleeping record", () => {
  it("removes a sleeping record", () => {
    registerTerminal(ID, activeEntry());
    beginSleepLocal(ID);
    expect(discardLocalSleeping(ID)).toBe(true);
    expect(getTerminal(ID)).toBeUndefined();
  });

  it("is a no-op on an active id (active terminals must be killed, not discarded)", () => {
    registerTerminal(ID, activeEntry());
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
