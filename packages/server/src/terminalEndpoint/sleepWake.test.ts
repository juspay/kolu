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

import { resumeFormFor } from "anyagent/cli";
import {
  type ActiveTerminal,
  LOCAL_LOCATION,
  SavedTerminalSchema,
  type SleepingTerminal,
  type TerminalMetadata,
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
  wakeLocalTerminal,
  wakeMeta,
} from "./local.ts";

const ID = "11111111-1111-4111-8111-111111111111";

/** A surface ctx that RECORDS every `terminalMetadata.upsert` into `sink` (id +
 *  state), so a test can assert the authored snapshot was actually PUSHED to the
 *  collection — not merely that a `terminals:dirty` trigger fired. Built off the
 *  no-op ctx, overriding only the collections proxy. */
function recordingSurfaceCtx(
  sink: Array<{ id: string; state: TerminalMetadata["state"] }>,
): ReturnType<typeof noopSurfaceCtxForTest> {
  // Compose the canonical no-op ctx and add only this helper's single concern:
  // record `terminalMetadata.upsert`. Every other collection member/method
  // delegates to the base proxy, so the no-op shape lives in exactly one place
  // (`surfaceCtx.ts`) and can't silently diverge here.
  const base = noopSurfaceCtxForTest();
  return {
    ...base,
    collections: new Proxy({} as never, {
      get: (_t, name) => {
        const inner = (base.collections as Record<string, unknown>)[
          name as string
        ];
        return name === "terminalMetadata"
          ? {
              ...(inner as object),
              // Production upserts the WHOLE metadata record (`{ ...m }`); type
              // `value` as that, not a `{ state }` projection, so the signature
              // matches what the collection actually receives.
              upsert: (id: string, value: TerminalMetadata) =>
                sink.push({ id, state: value.state }),
            }
          : inner;
      },
    }),
  } as ReturnType<typeof noopSurfaceCtxForTest>;
}

function activeEntry(): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 4242 },
    meta: {
      state: "active",
      cwd: "/work/repo",
      git: null,
      location: LOCAL_LOCATION,
      // A RESOLVED live PR — so the sleep-time snapshot onto the sleeping arm
      // (the dormant-tile metadata) is meaningful, not a bare `{ kind: "pending" }`.
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
      lastActivityAt: 123,
      lastAgentCommand: "opencode --model sonnet",
      // The EXACT conversation running on this terminal (juspay/kolu#1495) — must
      // ride the persisted base through sleep → snapshot → wake so resume targets
      // THIS session, not the most-recent one in the cwd.
      agentSession: { kind: "opencode", id: "ses_118316090ffewMmbj6bsfKwj4R" },
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
    // …and the exact-conversation ref rides through too (juspay/kolu#1495).
    expect(entry.meta.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });
    expect(entry.meta.cwd).toBe("/work/repo");
    expect(entry.meta.themeName).toBe("rose");
    expect(entry.meta.intent).toBe("fix the auth race");
    expect(entry.meta.sleptAt).toBeGreaterThan(0);

    // Live overlay gone — agent/foreground absent by type AND at runtime. `pr`
    // is the EXCEPTION: it's frozen onto the sleeping arm as a snapshot (asserted
    // by the dedicated "freezes the last-known PR" test below).
    const raw = entry.meta as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
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

  it("freezes the last-known PR onto the sleeping arm (the dormant-tile metadata)", () => {
    // The dormant tile surfaces the GitHub PR the terminal was on, but the live
    // `pr` overlay is gone with the PTY — so sleep FREEZES a snapshot onto the
    // sleeping arm (it rides the `...entry.meta` spread; `agent`/`foreground`,
    // absent from the sleeping schema, are still stripped). Wake discards it
    // (see the wakeMeta test) and the re-spawned PR sensor re-resolves.
    registerTerminal(ID, activeEntry());
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
    registerTerminal(ID, activeEntry());
    beginSleepLocal(ID);

    const saved = snapshotSession().terminals.find((t) => t.id === ID);
    expect(saved).toBeDefined();
    if (saved?.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(saved.sleptAt).toBeGreaterThan(0);
    expect(saved.lastAgentCommand).toBe("opencode --model sonnet");
    // The exact-conversation ref persists across a daemon restart (juspay/kolu#1495).
    expect(saved.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });

    // It round-trips through the saved discriminated union — agent/foreground
    // don't leak, but the `pr` SNAPSHOT persists (so a dormant tile keeps its
    // last-known PR across a daemon restart, like cwd/branch).
    expect(() => SavedTerminalSchema.parse(saved)).not.toThrow();
    const raw = saved as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
    expect(raw.foreground).toBeUndefined();
    expect(saved.pr?.kind).toBe("ok");
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
    agentSession: { kind: "opencode", id: "ses_118316090ffewMmbj6bsfKwj4R" },
    themeName: "rose",
    intent: "fix the auth race",
    // A frozen PR snapshot on the sleeping arm — wake must DISCARD it (the
    // re-spawned PR sensor re-resolves it live), never ride it onto the active arm.
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

  it("flips to active, rides the persisted base through WHOLE, and resets the live overlay", () => {
    const active: ActiveTerminal = wakeMeta(sleeping);
    expect(active.state).toBe("active");
    // Persisted base preserved (the resume input survives → wake can resume).
    expect(active.lastAgentCommand).toBe("opencode --model sonnet");
    // The exact-conversation ref rides through wake too (juspay/kolu#1495).
    expect(active.agentSession).toEqual({
      kind: "opencode",
      id: "ses_118316090ffewMmbj6bsfKwj4R",
    });
    expect(active.cwd).toBe("/work/repo");
    expect(active.themeName).toBe("rose");
    expect(active.intent).toBe("fix the auth race");
    // Live overlay re-seeded to defaults — incl. the frozen `pr` snapshot
    // DISCARDED (reset to `{ kind: "pending" }`, NOT ridden onto the active arm);
    // the re-spawned PTY's sensors re-derive agent/foreground/pr.
    expect(active.agent).toBeNull();
    expect(active.foreground).toBeNull();
    expect(active.pr).toEqual({ kind: "pending" });
    // The sleeping-only scalar is gone.
    expect((active as Record<string, unknown>).sleptAt).toBeUndefined();
  });
});

describe("wake resume targets the EXACT conversation, not most-recent (juspay/kolu#1495)", () => {
  // The issue's scenario, at the model layer: a terminal slept on conversation A;
  // a SECOND conversation B later ran in the same cwd. Wake must resume A — the
  // conversation that was running on THIS terminal — not B (the folder's newest).
  // Wake builds its resume input purely from the persisted base (lastAgentCommand
  // + agentSession), never from the cwd's live state, so the woken meta's ref IS A.
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
    const active = wakeMeta(sleptOnA);
    const resumeCommand = resumeFormFor(active);
    // Targets conversation A by id — NOT the most-recent `--continue` marker.
    expect(resumeCommand).toBe(`opencode --session ${CONV_A} --model sonnet`);
    expect(resumeCommand).not.toContain("--continue");
  });

  it("falls back to most-recent when no conversation ref was ever captured", () => {
    const { agentSession: _drop, ...noRef } = sleptOnA;
    const active = wakeMeta(noRef as SleepingTerminal);
    const resumeCommand = resumeFormFor(active);
    // Nothing to target → today's behavior is preserved (no regression).
    expect(resumeCommand).toBe("opencode --continue --model sonnet");
  });
});

describe("wake — a failed PTY spawn must NOT drop the sleeping record (F2)", () => {
  // In the unit-test env no kaval endpoint is booted, so the wake's spawn RPC
  // rejects at `buildTerminalSpawnInput` (the pty-host facade throws "not
  // connected"). That is exactly the failed-wake path: `wake` flips the entry to
  // an active sync-shadow, the async spawn tail fails, and — before this fix —
  // `unwindSpawnShadow` unregistered the id, ERASING the dormant record the user
  // can still wake (the next autosave would persist that loss). The fix restores
  // the captured `prior` sleeping entry on a wake-spawn failure.
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

  afterEach(() => unregisterTerminal(WAKE_ID));

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
    // The whole persisted base + sleeping discriminant rode back through.
    expect(entry.meta.lastAgentCommand).toBe("claude --model sonnet");
    expect(entry.meta.sleptAt).toBe(222);
    expect(entry.handle).toBeUndefined();
  });
});

describe("wake/spawn PUSHES the authored active snapshot (issue #1529)", () => {
  // Pins the invariant documented at `publishTerminalState`: a lifecycle flip
  // reaches the client only through that publish, never through `terminals:dirty`
  // alone. Before this fix the wake/spawn core (`registerActiveAndSpawn`) emitted
  // only the dirty trigger, so a woken terminal's registry meta flipped to active
  // while the client stayed pinned to the stale sleeping snapshot.
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

  let upserts: Array<{ id: string; state: TerminalMetadata["state"] }>;

  beforeEach(() => {
    // Replace the suite-wide no-op ctx with a recording one (the double-call
    // guard forbids swapping ctx without a reset first).
    __resetSurfaceCtxForTest();
    upserts = [];
    setSurfaceCtx(recordingSurfaceCtx(upserts));
  });

  afterEach(() => unregisterTerminal(PUB_ID));

  it("pushes the active snapshot on wake, not just a dirty signal", () => {
    expect(seedSleepingTerminal(sleepingRecord())).toBe(true);
    // The seed itself doesn't publish; start from a clean slate regardless.
    upserts.length = 0;

    // Wake registers the active sync-shadow synchronously, publishing the active
    // snapshot BEFORE the async spawn tail (which fails in the unit env — no
    // kaval — and then restores the sleeping record). Assert at that sync point.
    wakeLocalTerminal(PUB_ID);
    expect(getTerminal(PUB_ID)?.meta.state).toBe("active");
    expect(upserts).toContainEqual({ id: PUB_ID, state: "active" });
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
