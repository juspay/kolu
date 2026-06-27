/**
 * Sleep / wake state-machine tests — the pty-host-free transitions, under
 * Design-S (the awareness + authored halves on one registry entry).
 *
 * These pin the invariants the discarded first cut (PR #1466) violated, now
 * across the two halves:
 *   - sleep flips the SAME registry entry to the AUTHORED sleeping arm in place
 *     and FREEZES the live `pr` onto it, while the entry's awareness keeps the
 *     persisted half (crucially `lastAgentCommand`/`agentSession`, the resume
 *     inputs — BUG-B stripped the agent so wake resumed nothing); sleep does NOT
 *     drop awareness, so the dormant tile recomposes cwd/branch;
 *   - the slept terminal serializes through the SAVED sleeping arm (no live
 *     overlay leaks; the frozen pr persists);
 *   - wake resets the entry awareness's LIVE half, keeps the persisted half, and
 *     flips the authored record back to active — so the resume form derives from it;
 *   - discard removes both halves of a sleeping record, never an active one.
 *
 * Wake's PTY re-spawn + agent replay is exercised end-to-end by the
 * `sleeping-terminals.feature` journey on CI (needs a live pty-host); here we pin
 * the synchronous registry/store flips. In the unit env no kaval endpoint is
 * booted, so a wake's spawn RPC rejects on a later microtask — that is exactly the
 * failed-wake path, asserted below.
 */

import { resumeFormFor } from "anyagent/cli";
import {
  type AuthoredTerminal,
  type AwarenessValue,
  LOCAL_LOCATION,
  SavedTerminalSchema,
} from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSurfaceCtxForTest,
  noopSurfaceCtxForTest,
  setSurfaceCtx,
} from "../surfaceCtx.ts";
import {
  type ActiveTerminalProcess,
  awarenessFor,
  getTerminal,
  registerTerminal,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { snapshotSession } from "../terminals.ts";
import {
  __resetWorkspaceSurfaceCtxForTest,
  noopWorkspaceSurfaceCtxForTest,
  setWorkspaceSurfaceCtx,
} from "../workspaceSurfaceCtx.ts";
import {
  beginSleepLocal,
  discardLocalSleeping,
  seedSleepingTerminal,
  wakeLocalTerminal,
} from "./local.ts";
import { installAwareness } from "./metadata.ts";

const ID = "11111111-1111-4111-8111-111111111111";

/** A surface ctx that RECORDS every `authored.upsert` into `sink` (id + state),
 *  so a test can assert the AUTHORED record was actually PUSHED to the collection
 *  on a lifecycle flip — not merely that a `terminals:dirty` trigger fired. Built
 *  off the no-op ctx, overriding only the collections proxy. */
function recordingSurfaceCtx(
  sink: Array<{ id: string; state: AuthoredTerminal["state"] }>,
): ReturnType<typeof noopSurfaceCtxForTest> {
  const base = noopSurfaceCtxForTest();
  return {
    ...base,
    collections: new Proxy({} as never, {
      get: (_t, name) => {
        const inner = (base.collections as Record<string, unknown>)[
          name as string
        ];
        return name === "authored"
          ? {
              ...(inner as object),
              // Production upserts the AUTHORED record on a lifecycle flip; type
              // `value` as an `AuthoredTerminal` so the signature matches what it
              // receives (the live overlay lives on the awareness collection).
              upsert: (id: string, value: AuthoredTerminal) =>
                sink.push({ id, state: value.state }),
            }
          : inner;
      },
    }),
  } as ReturnType<typeof noopSurfaceCtxForTest>;
}

/** An active registry entry — the AUTHORED half (location + client chrome) plus
 *  the AWARENESS half on the one entry (defaulting to `awarenessActive()`). */
function authoredActive(
  awareness: AwarenessValue = awarenessActive(),
): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 4242 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      themeName: "rose",
      intent: "fix the auth race",
    },
    awareness,
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

/** The AWARENESS half — persisted sensor fields + a RESOLVED live PR (so the
 *  sleep-time freeze onto the authored arm is meaningful). */
function awarenessActive(): AwarenessValue {
  return {
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
}

/** Seed an active terminal's two halves into the registry (one entry), then fan
 *  its awareness out. */
function seedActive(): void {
  const entry = authoredActive();
  registerTerminal(ID, entry);
  installAwareness(ID, entry.awareness);
}

beforeEach(() => {
  setSurfaceCtx(noopSurfaceCtxForTest());
  setWorkspaceSurfaceCtx(noopWorkspaceSurfaceCtxForTest());
});

afterEach(() => {
  // Dropping the entry drops its awareness too (one backing store now).
  unregisterTerminal(ID);
  __resetSurfaceCtxForTest();
  __resetWorkspaceSurfaceCtxForTest();
});

describe("beginSleep — flip active → sleeping in place", () => {
  it("keeps the SAME id, freezes pr onto the authored arm, keeps awareness, releases the handle", () => {
    seedActive();
    expect(beginSleepLocal(ID)).toBe(true);

    const entry = getTerminal(ID);
    expect(entry).toBeDefined();
    if (entry?.meta.state !== "sleeping") throw new Error("expected sleeping");

    // The AUTHORED sleeping arm — client chrome + discriminant + frozen pr.
    expect(entry.meta.themeName).toBe("rose");
    expect(entry.meta.intent).toBe("fix the auth race");
    expect(entry.meta.sleptAt).toBeGreaterThan(0);
    if (entry.meta.pr?.kind !== "ok") {
      throw new Error("expected a snapshotted resolved PR on the sleeping arm");
    }
    expect(entry.meta.pr.value.number).toBe(42);

    // Authored names NO awareness field — cwd/git/agent are absent from entry.meta.
    const raw = entry.meta as Record<string, unknown>;
    expect(raw.cwd).toBeUndefined();
    expect(raw.git).toBeUndefined();
    expect(raw.agent).toBeUndefined();
    expect(raw.foreground).toBeUndefined();

    // The awareness store STAYS (sleep does not drop it) — the persisted half is
    // intact, incl. lastAgentCommand/agentSession (the resume inputs, BUG-B/#1495).
    const aw = awarenessFor(ID);
    expect(aw?.cwd).toBe("/work/repo");
    expect(aw?.lastAgentCommand).toBe("opencode --model sonnet");
    expect(aw?.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });

    // No live PTY handle on a sleeping process; the same stable id rides on.
    expect(entry.handle).toBeUndefined();
    expect(entry.info.id).toBe(ID);
  });

  it("is a no-op (returns false) on an absent id", () => {
    expect(beginSleepLocal(ID)).toBe(false);
  });

  it("is a no-op on an already-sleeping id (idempotent)", () => {
    seedActive();
    expect(beginSleepLocal(ID)).toBe(true);
    expect(beginSleepLocal(ID)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });
});

describe("snapshotSession — a slept terminal serializes through the sleeping arm", () => {
  it("emits state=sleeping + sleptAt, strips agent/foreground, keeps the pr snapshot + lastAgentCommand", () => {
    seedActive();
    beginSleepLocal(ID);

    const saved = snapshotSession().terminals.find((t) => t.id === ID);
    expect(saved).toBeDefined();
    if (saved?.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(saved.sleptAt).toBeGreaterThan(0);
    // The persisted awareness rides to disk (from the store, joined at save).
    expect(saved.lastAgentCommand).toBe("opencode --model sonnet");
    expect(saved.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });

    // Round-trips through the saved discriminated union — agent/foreground don't
    // leak, but the `pr` SNAPSHOT persists (a dormant tile keeps its last-known
    // PR across a daemon restart, like cwd/branch).
    expect(() => SavedTerminalSchema.parse(saved)).not.toThrow();
    const raw = saved as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
    expect(raw.foreground).toBeUndefined();
    expect(saved.pr?.kind).toBe("ok");
  });
});

describe("wake — resets the live half, keeps the persisted half", () => {
  it("re-seeds the store live half to defaults, rides the persisted half through, and resumes the exact conversation", async () => {
    seedActive();
    expect(beginSleepLocal(ID)).toBe(true);

    // Wake registers the active sync-shadow synchronously (the spawn tail fails on
    // a later microtask — no kaval); assert the store at that sync point.
    wakeLocalTerminal(ID);
    expect(getTerminal(ID)?.meta.state).toBe("active");

    const aw = awarenessFor(ID);
    // Live half reset — the frozen pr DISCARDED; the re-spawned PTY's sensors
    // re-derive agent/foreground/pr.
    expect(aw?.pr).toEqual({ kind: "pending" });
    expect(aw?.agent).toBeNull();
    expect(aw?.foreground).toBeNull();
    // Persisted half rode through (so wake can resume).
    expect(aw?.cwd).toBe("/work/repo");
    expect(aw?.lastAgentCommand).toBe("opencode --model sonnet");
    expect(aw?.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });
    // The resume form derives from the STORE and targets the EXACT conversation by
    // id — NOT the most-recent `--continue` marker (juspay/kolu#1495).
    const resumeCommand = resumeFormFor(aw ?? {});
    expect(resumeCommand).toBe(
      "opencode --session ses_118316090ffewMmbj6bsfKwj4R --model sonnet",
    );
    expect(resumeCommand).not.toContain("--continue");

    // Let the rejected spawn RPC settle (it restores the sleeping record).
    await new Promise((r) => setTimeout(r, 0));
  });

  it("falls back to most-recent when no conversation ref was ever captured", async () => {
    const { agentSession: _drop, ...noRef } = awarenessActive();
    const entry = authoredActive(noRef as AwarenessValue);
    registerTerminal(ID, entry);
    installAwareness(ID, entry.awareness);
    expect(beginSleepLocal(ID)).toBe(true);

    wakeLocalTerminal(ID);
    const resumeCommand = resumeFormFor(awarenessFor(ID) ?? {});
    // Nothing to target → today's behavior is preserved (no regression).
    expect(resumeCommand).toBe("opencode --continue --model sonnet");

    await new Promise((r) => setTimeout(r, 0));
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
  });

  it("restores the sleeping entry when the wake spawn fails", async () => {
    expect(seedSleepingTerminal(sleepingRecord())).toBe(true);

    // Wake returns synchronously after registering the active sync-shadow; the
    // spawn tail fails on a later microtask. The shadow IS active right after.
    wakeLocalTerminal(WAKE_ID);
    expect(getTerminal(WAKE_ID)?.meta.state).toBe("active");

    // Let the rejected spawn RPC propagate through `spawnAndWire`'s catch.
    await new Promise((r) => setTimeout(r, 0));

    const entry = getTerminal(WAKE_ID);
    expect(entry).toBeDefined();
    if (entry?.meta.state !== "sleeping")
      throw new Error(
        "expected the sleeping record to be RESTORED, not dropped",
      );
    expect(entry.meta.sleptAt).toBe(222);
    expect(entry.handle).toBeUndefined();
    // The awareness store survives (never dropped on a wake-spawn failure) — the
    // persisted half (the resume input) rode through.
    expect(awarenessFor(WAKE_ID)?.lastAgentCommand).toBe(
      "claude --model sonnet",
    );
  });
});

describe("wake/spawn PUSHES the authored active snapshot (issue #1529)", () => {
  const PUB_ID = "44444444-4444-4444-8444-444444444444";
  const sleepingRecord = () => ({
    id: PUB_ID,
    state: "sleeping" as const,
    sleptAt: 222,
    cwd: "/work/repo",
    git: null,
    location: LOCAL_LOCATION,
    lastActivityAt: 7,
    lastAgentCommand: "claude --model sonnet",
  });

  let upserts: Array<{ id: string; state: AuthoredTerminal["state"] }>;

  beforeEach(() => {
    // Replace the suite-wide no-op `kolu` ctx with a recording one (the
    // double-call guard forbids swapping ctx without a reset first). The
    // `terminalWorkspace` ctx stays the suite-wide no-op.
    __resetSurfaceCtxForTest();
    upserts = [];
    setSurfaceCtx(recordingSurfaceCtx(upserts));
  });

  afterEach(() => {
    unregisterTerminal(PUB_ID);
  });

  it("pushes the active snapshot on wake, not just a dirty signal", () => {
    expect(seedSleepingTerminal(sleepingRecord())).toBe(true);
    // The seed itself doesn't publish the wire; start from a clean slate.
    upserts.length = 0;

    wakeLocalTerminal(PUB_ID);
    expect(getTerminal(PUB_ID)?.meta.state).toBe("active");
    expect(upserts).toContainEqual({ id: PUB_ID, state: "active" });
  });
});

describe("discardSleeping — removes only a sleeping record (both halves)", () => {
  it("removes a sleeping record and its awareness", () => {
    seedActive();
    beginSleepLocal(ID);
    expect(discardLocalSleeping(ID)).toBe(true);
    expect(getTerminal(ID)).toBeUndefined();
    expect(awarenessFor(ID)).toBeUndefined();
  });

  it("is a no-op on an active id (active terminals must be killed, not discarded)", () => {
    seedActive();
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

  afterEach(() => {
    unregisterTerminal(SEED_ID);
  });

  it("seeds both halves: authored sleeping in the registry, persisted in the store", () => {
    expect(seedSleepingTerminal(validRecord())).toBe(true);
    const entry = getTerminal(SEED_ID);
    if (entry?.meta.state !== "sleeping") throw new Error("expected sleeping");
    expect(entry.meta.sleptAt).toBe(111);
    expect(entry.handle).toBeUndefined();
    // The persisted awareness rode into the store (the dormant tile reads cwd off it).
    expect(awarenessFor(SEED_ID)?.cwd).toBe("/work/repo");
    expect(awarenessFor(SEED_ID)?.lastAgentCommand).toBe(
      "claude --model sonnet",
    );
  });

  it("DROPS a malformed record (missing sleptAt) without throwing or polluting the set", () => {
    const malformed = { ...validRecord(), sleptAt: undefined };
    expect(seedSleepingTerminal(malformed as never)).toBe(false);
    expect(getTerminal(SEED_ID)).toBeUndefined();
    expect(awarenessFor(SEED_ID)).toBeUndefined();
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
