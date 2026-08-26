/**
 * Sleep / wake state-machine tests — the pty-host-free transitions, under the
 * awareness-derive-store cutover (the OBSERVATION and the AUTHORED record on one
 * registry entry).
 *
 * These pin the invariants the discarded first cut (PR #1466) violated, now
 * across the two halves:
 *   - sleep flips the SAME registry entry to the AUTHORED sleeping arm in place;
 *     the resume inputs ride `entry.meta` (the authored record) — `lastAgentCommand`
 *     and the fold-derived `restoreTarget` (BUG-B stripped the agent so wake resumed
 *     nothing). The OBSERVATION (`cwd`/`git`/`pr`) rides `entry.snapshot`, carried
 *     over unchanged so the dormant tile recomposes cwd/branch/pr off it. `pr` is
 *     restore-relevant now and rides the snapshot, so the frozen-`pr`-on-the-
 *     sleeping-arm special case is GONE;
 *   - the slept terminal serializes through the SAVED sleeping arm: agent/foreground
 *     don't leak, but the restore-relevant `pr` + the authored memory + `restoreTarget`
 *     ride to disk;
 *   - wake RESETS the snapshot to `seedSnapshot(cwd)` (pr pending, agent +
 *     foreground null), keeps the authored memory + `restoreTarget`, and flips the
 *     authored record back to active — so the resume form derives off `entry.meta`;
 *   - discard removes both halves of a sleeping record, never an active one.
 *
 * Wake's PTY re-spawn + agent replay is exercised end-to-end by the
 * `sleeping-terminals.feature` journey on CI (needs a live pty-host); here we pin
 * the synchronous registry/store flips. In the unit env no kaval endpoint is
 * booted, so a wake's spawn RPC rejects on a later microtask — that is exactly the
 * failed-wake path, asserted below.
 */

import {
  type AuthoredTerminal,
  LOCAL_LOCATION,
  SavedTerminalSchema,
} from "@kolu/padi-client/surface";
import { resumeFormFor } from "anyagent/cli";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import {
  getTerminal,
  registerTerminal,
  snapshotFor,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { snapshotSession } from "../terminals.ts";
import {
  beginSleepLocal,
  discardLocalSleeping,
  seedSleepingTerminal,
  wakeLocalTerminal,
} from "./local.ts";
import { installSnapshot, updateMemory } from "./metadata.ts";
import {
  activeEntry,
  EXACT_TARGET,
  seedActiveTerminal,
} from "./terminalFixtures.testlib.ts";

// discardSleeping drives `cleanupTerminalScratch`, which reads the per-instance
// scratch root. Boot injects the server id before any of this runs; mirror that
// here so the read hits the happy path, not the boot-order crash.
setDaemonProcessId("sleepwake-test-server");

const ID = "11111111-1111-4111-8111-111111111111";

/** A padi ctx that RECORDS every `terminals.upsert` into `sink` (id + state), so a
 *  test can assert the composed record was actually PUSHED to the collection on a
 *  lifecycle flip — not merely that a `terminals:dirty` trigger fired. Built off the
 *  no-op ctx, overriding only the collections proxy. */
function recordingPadiCtx(
  sink: Array<{ id: string; state: AuthoredTerminal["state"] }>,
): ReturnType<typeof noopPadiSurfaceCtxForTest> {
  const base = noopPadiSurfaceCtxForTest();
  return {
    ...base,
    collections: new Proxy({} as never, {
      get: (_t, name) => {
        const inner = (base.collections as Record<string, unknown>)[
          name as string
        ];
        return name === "terminals"
          ? {
              ...(inner as object),
              // Production upserts the COMPOSED record on a lifecycle flip; the
              // composed `active|sleeping` value carries its `state` discriminant,
              // so record it off the value.
              upsert: (
                id: string,
                value: { state: AuthoredTerminal["state"] },
              ) => sink.push({ id, state: value.state }),
            }
          : inner;
      },
    }),
  } as ReturnType<typeof noopPadiSurfaceCtxForTest>;
}

beforeEach(() => {
  // padi's ctx backs the composed `terminals` collection + `urgency` cell + the
  // `terminalExit` event — the whole terminal publish seam. A no-op here (surface.ts
  // isn't imported); the terminal-list wire rides the collection's keys stream, so
  // there is no separate kolu ctx to seed.
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
});

afterEach(() => {
  // Dropping the entry drops its awareness too (one backing store now).
  unregisterTerminal(ID);
  __resetPadiSurfaceCtxForTest();
});

describe("beginSleep — flip active → sleeping in place", () => {
  it("keeps the SAME id, rides the resume inputs on the authored arm, keeps the snapshot (incl. pr), releases the handle", () => {
    seedActiveTerminal(ID);
    expect(beginSleepLocal(ID)).toBe(true);

    const entry = getTerminal(ID);
    expect(entry).toBeDefined();
    if (entry?.meta.state !== "sleeping") throw new Error("expected sleeping");

    // The AUTHORED sleeping arm — client chrome + discriminant.
    expect(entry.meta.themeName).toBe("rose");
    expect(entry.meta.intent).toBe("fix the auth race");
    expect(entry.meta.sleptAt).toBeGreaterThan(0);

    // The resume inputs ride the AUTHORED arm — `lastAgentCommand` + the
    // `restoreTarget` (the resume inputs, BUG-B/#1495). The fold set `restoreTarget`
    // during the active session; the sleep freeze carries it over with no special
    // capture.
    expect(entry.meta.lastAgentCommand).toBe("opencode --model sonnet");
    expect(entry.meta.restoreTarget).toEqual(EXACT_TARGET);

    // Authored names NO snapshot field — cwd/git/pr/agent are absent from entry.meta
    // (pr is restore-relevant now and rides the OBSERVATION, not a frozen arm field).
    const raw = entry.meta as Record<string, unknown>;
    expect(raw.cwd).toBeUndefined();
    expect(raw.git).toBeUndefined();
    expect(raw.pr).toBeUndefined();
    expect(raw.agent).toBeUndefined();
    expect(raw.foreground).toBeUndefined();

    // The OBSERVATION stays (sleep does not drop it) — cwd/git + the restore-relevant
    // `pr` ride through so the dormant tile recomposes cwd/branch/pr off it.
    const aw = snapshotFor(ID);
    expect(aw?.cwd).toBe("/work/repo");
    if (aw?.pr?.kind !== "ok") {
      throw new Error("expected the resolved pr to ride the snapshot");
    }
    expect(aw.pr.value.number).toBe(42);

    // No live PTY handle on a sleeping process; the same stable id rides on.
    expect(entry.handle).toBeUndefined();
    expect(entry.info.id).toBe(ID);
  });

  it("is a no-op (returns false) on an absent id", () => {
    expect(beginSleepLocal(ID)).toBe(false);
  });

  it("is a no-op on an already-sleeping id (idempotent)", () => {
    seedActiveTerminal(ID);
    expect(beginSleepLocal(ID)).toBe(true);
    expect(beginSleepLocal(ID)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });
});

describe("beginSleep after the fold's authored write — the sleeping decode", () => {
  // `beginSleep` re-DECODES the authored record it spreads
  // (`decodeAuthoredSleeping({...entry.meta, state:"sleeping", sleptAt})`), so any
  // producer that leaves a PRESENT `undefined` on an `optionalKey` field takes the
  // sleep flip down — the tile stays live forever and the user's ☾ silently does
  // nothing (`sleeping-terminals.feature`'s agent journeys, which sleep a terminal
  // the fold has already written memory for). The fold's `updateMemory` is that
  // producer, and this pins the flip THROUGH it rather than through a hand-built
  // meta, so a re-introduced field-by-field copy fails HERE and not only in the
  // autosave (`metadata.test.ts`'s disk-persist twin).
  const MEM_ID = "55555555-5555-4555-8555-555555555555";
  let upserts: Array<{ id: string; state: AuthoredTerminal["state"] }>;

  beforeEach(() => {
    __resetPadiSurfaceCtxForTest();
    upserts = [];
    setPadiSurfaceCtx(recordingPadiCtx(upserts));
  });

  afterEach(() => {
    unregisterTerminal(MEM_ID);
  });

  it("flips and PUBLISHES sleeping for a terminal whose fold remembered no launch line", () => {
    const entry = activeEntry(MEM_ID, { restoreTarget: { kind: "none" } });
    // A terminal that never ran a KNOWN agent has no remembered launch line —
    // the absent-key shape, the only one `Schema.optionalKey` accepts.
    delete (entry.meta as { lastAgentCommand?: string }).lastAgentCommand;
    registerTerminal(MEM_ID, entry);
    installSnapshot(MEM_ID);

    // The fold's ONE authored writer, exactly as the first agent observation
    // drives it: recency stamped, nothing remembered, target `none`.
    updateMemory(MEM_ID, { lastActivityAt: 456 }, { kind: "none" });
    expect(getTerminal(MEM_ID)?.meta.lastActivityAt).toBe(456);

    upserts.length = 0;
    expect(beginSleepLocal(MEM_ID)).toBe(true);
    expect(getTerminal(MEM_ID)?.meta.state).toBe("sleeping");
    // The flip must reach the WIRE — a swallowed publish is the same dead tile.
    expect(upserts).toContainEqual({ id: MEM_ID, state: "sleeping" });
    // And the absent fact stays absent, never a present `undefined`.
    expect("lastAgentCommand" in (getTerminal(MEM_ID)?.meta ?? {})).toBe(false);
  });
});

describe("snapshotSession — a slept terminal serializes through the sleeping arm", () => {
  it("emits state=sleeping + sleptAt, strips agent/foreground, keeps the pr snapshot + lastAgentCommand + restoreTarget", () => {
    seedActiveTerminal(ID);
    beginSleepLocal(ID);

    const saved = snapshotSession().terminals.find((t) => t.id === ID);
    expect(saved).toBeDefined();
    if (saved?.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(saved.sleptAt).toBeGreaterThan(0);
    // The authored memory + the restore target ride to disk (joined at save).
    expect(saved.lastAgentCommand).toBe("opencode --model sonnet");
    expect(saved.restoreTarget).toEqual(EXACT_TARGET);

    // Round-trips through the saved discriminated union — agent/foreground don't
    // leak, but the `pr` SNAPSHOT persists (a dormant tile keeps its last-known
    // PR across a daemon restart, like cwd/branch — restore-relevant now).
    expect(() =>
      Schema.decodeUnknownSync(SavedTerminalSchema)(saved),
    ).not.toThrow();
    const raw = saved as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
    expect(raw.foreground).toBeUndefined();
    expect(saved.pr?.kind).toBe("ok");
  });
});

describe("wake — resets the snapshot, keeps the authored memory", () => {
  it("re-seeds the snapshot to defaults, rides the resume inputs through on the authored record, and resumes the exact conversation", async () => {
    seedActiveTerminal(ID);
    expect(beginSleepLocal(ID)).toBe(true);

    // Wake registers the active sync-shadow synchronously (the spawn tail fails on
    // a later microtask — no kaval); assert the store at that sync point.
    wakeLocalTerminal(ID);
    expect(getTerminal(ID)?.meta.state).toBe("active");

    const aw = snapshotFor(ID);
    // TerminalSnapshot reset to `seedSnapshot(cwd)` — the frozen pr DISCARDED; the
    // re-spawned PTY's producer re-derives agent/foreground/pr.
    expect(aw?.pr).toEqual({ kind: "pending" });
    expect(aw?.agent).toBeNull();
    expect(aw?.foreground).toBeNull();
    // The saved cwd rides through the reset (so the git sensor re-resolves against it).
    expect(aw?.cwd).toBe("/work/repo");

    // The restore target rides `entry.meta` (the AUTHORED record), surviving the
    // flip back to active — so wake can resume.
    const meta = getTerminal(ID)?.meta;
    expect(meta?.lastAgentCommand).toBe("opencode --model sonnet");
    expect(meta?.restoreTarget).toEqual(EXACT_TARGET);

    // The resume form switches on the AUTHORED `restoreTarget` and targets the EXACT
    // conversation by id — NOT the most-recent `--continue` marker (juspay/kolu#1495).
    const resumeCommand = resumeFormFor(meta?.restoreTarget);
    expect(resumeCommand).toBe(
      "opencode --session ses_118316090ffewMmbj6bsfKwj4R --model sonnet",
    );
    expect(resumeCommand).not.toContain("--continue");

    // Let the rejected spawn RPC settle (it restores the sleeping record).
    await new Promise((r) => setTimeout(r, 0));
  });

  it("wakes to a BARE SHELL on a `none` restore target (quit-to-shell, by construction)", async () => {
    // A quit-to-shell drops the live agent, so the fold wrote `restoreTarget: none`.
    // Even with a sticky `lastAgentCommand` still on the record, wake resumes NOTHING
    // — `none` is read as a bare shell, never the most-recent fallback (model B).
    const entry = activeEntry(ID, { restoreTarget: { kind: "none" } });
    registerTerminal(ID, entry);
    installSnapshot(ID);
    expect(beginSleepLocal(ID)).toBe(true);

    wakeLocalTerminal(ID);
    expect(resumeFormFor(getTerminal(ID)?.meta.restoreTarget)).toBeNull();

    await new Promise((r) => setTimeout(r, 0));
  });

  it("resumes most-recent on a `legacyMostRecent` target (migrated pre-1.29 record)", async () => {
    // A pre-1.29 record that remembered a launch command but never captured the
    // session id migrates to a NAMED `legacyMostRecent` target — so the old
    // most-recent behavior is preserved for already-saved sessions, distinctly from
    // a quit-to-shell `none`.
    const entry = activeEntry(ID, {
      restoreTarget: {
        kind: "legacyMostRecent",
        command: "opencode --model sonnet",
      },
    });
    registerTerminal(ID, entry);
    installSnapshot(ID);
    expect(beginSleepLocal(ID)).toBe(true);

    wakeLocalTerminal(ID);
    const resumeCommand = resumeFormFor(getTerminal(ID)?.meta.restoreTarget);
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
    // `pr` is a PERSISTED, restore-relevant field now (no longer a live-only field),
    // so a saved sleeping record carries it.
    pr: { kind: "absent" } as const,
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
    // The resume input (the authored `lastAgentCommand`) rode through on the restored
    // sleeping arm — never dropped on a wake-spawn failure.
    expect(entry.meta.lastAgentCommand).toBe("claude --model sonnet");
    // The snapshot survives too (one backing store).
    expect(snapshotFor(WAKE_ID)?.cwd).toBe("/work/repo");
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
    pr: { kind: "absent" } as const,
    location: LOCAL_LOCATION,
    lastActivityAt: 7,
    lastAgentCommand: "claude --model sonnet",
  });

  let upserts: Array<{ id: string; state: AuthoredTerminal["state"] }>;

  beforeEach(() => {
    // Replace the suite-wide no-op `padi` ctx with a recording one (the
    // double-call guard forbids swapping ctx without a reset first). The `kolu`
    // ctx stays the suite-wide no-op (it backs `terminalList`, not `terminals`).
    __resetPadiSurfaceCtxForTest();
    upserts = [];
    setPadiSurfaceCtx(recordingPadiCtx(upserts));
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
  it("removes a sleeping record and its snapshot", () => {
    seedActiveTerminal(ID);
    beginSleepLocal(ID);
    expect(discardLocalSleeping(ID)).toBe(true);
    expect(getTerminal(ID)).toBeUndefined();
    expect(snapshotFor(ID)).toBeUndefined();
  });

  it("is a no-op on an active id (active terminals must be killed, not discarded)", () => {
    seedActiveTerminal(ID);
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
    pr: { kind: "absent" } as const,
    location: LOCAL_LOCATION,
    lastActivityAt: 5,
    lastAgentCommand: "claude --model sonnet",
    // The restore target the cold-restored terminal will resume — rides the authored
    // sleeping record (its `exact` arm keeps only the identity, no full-agent
    // reconstruction across a cold restart).
    restoreTarget: {
      kind: "exact",
      command: "claude --model sonnet",
      agent: {
        kind: "claude-code",
        sessionId: "9b2f1c34-5a6d-4e7f-8a90-b1c2d3e4f567",
      },
    } as const,
  });

  afterEach(() => {
    unregisterTerminal(SEED_ID);
  });

  it("seeds both halves: authored sleeping in the registry (memory + restore target), snapshot in the entry", () => {
    expect(seedSleepingTerminal(validRecord())).toBe(true);
    const entry = getTerminal(SEED_ID);
    if (entry?.meta.state !== "sleeping") throw new Error("expected sleeping");
    expect(entry.meta.sleptAt).toBe(111);
    expect(entry.handle).toBeUndefined();
    // The authored memory + the restore target rode onto `entry.meta`.
    expect(entry.meta.lastAgentCommand).toBe("claude --model sonnet");
    expect(entry.meta.restoreTarget).toEqual({
      kind: "exact",
      command: "claude --model sonnet",
      agent: {
        kind: "claude-code",
        sessionId: "9b2f1c34-5a6d-4e7f-8a90-b1c2d3e4f567",
      },
    });
    // The restore-relevant snapshot (cwd + the persisted pr) rode into the entry
    // (the dormant tile reads cwd/pr off it).
    expect(snapshotFor(SEED_ID)?.cwd).toBe("/work/repo");
    expect(snapshotFor(SEED_ID)?.pr).toEqual({ kind: "absent" });
  });

  it("DROPS a malformed record (missing sleptAt) without throwing or polluting the set", () => {
    const malformed = { ...validRecord(), sleptAt: undefined };
    expect(seedSleepingTerminal(malformed as never)).toBe(false);
    expect(getTerminal(SEED_ID)).toBeUndefined();
    expect(snapshotFor(SEED_ID)).toBeUndefined();
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
