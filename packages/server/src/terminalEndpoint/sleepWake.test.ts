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

import { resumeFormFor } from "anyagent/cli";
import {
  type AgentIdentity,
  type AuthoredTerminal,
  LOCAL_LOCATION,
  type TerminalSnapshot,
  type RestoreTarget,
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
  snapshotFor,
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
import { installSnapshot } from "./metadata.ts";
import { resolveTerminalEndpoint } from "./resolve.ts";

// The sleep/wake/discard/seed state machine is exercised through the SEALED resolver
// (the same seam the lifecycle façade routes through), NOT the deleted `*Local*`
// direct handles — these are pty-host-free transition tests, so they call the
// endpoint's sync methods straight (no save / release / routing side effects).
const endpoint = resolveTerminalEndpoint(LOCAL_LOCATION);

const ID = "11111111-1111-4111-8111-111111111111";

/** The native session id of the opencode conversation that was live at sleep —
 *  the EXACT conversation wake must resume (#1495). */
const SESSION_ID = "ses_118316090ffewMmbj6bsfKwj4R";

/** The agent IDENTITY the fold derived from the live agent (its `kind` + native
 *  `sessionId`) — the `exact` target's payload. Replaces the deleted sticky
 *  `agentSession` ref. */
const RESUME_AGENT: AgentIdentity = { kind: "opencode", sessionId: SESSION_ID };

/** The fold-derived `restoreTarget` the fixture seeds — an `exact` target carrying
 *  the launch command + the live agent's identity, so wake resumes THAT
 *  conversation by id (#1495). The `command` matches the seeded `lastAgentCommand`,
 *  exactly as `restoreTargetOf` would have produced it. */
const EXACT_TARGET: RestoreTarget = {
  kind: "exact",
  command: "opencode --model sonnet",
  agent: RESUME_AGENT,
};

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
              // receives (the snapshot lives on the snapshots collection).
              upsert: (id: string, value: AuthoredTerminal) =>
                sink.push({ id, state: value.state }),
            }
          : inner;
      },
    }),
  } as ReturnType<typeof noopSurfaceCtxForTest>;
}

/** An active registry entry — the AUTHORED half (location + client chrome + the
 *  remembered `AgentMemory` + the fold-derived `restoreTarget`) plus the
 *  OBSERVATION half on the one entry (defaulting to `snapshotActive()`).
 *  `restoreTarget` rides an options object so a test can pass `{ restoreTarget:
 *  { kind: "none" } }` for the quit-to-shell case (wake → bare shell) or a
 *  `legacyMostRecent` target — an options bag, not a defaulted scalar, since
 *  `authoredActive(undefined)` would resurrect the default. */
function authoredActive(
  opts: { restoreTarget?: RestoreTarget } = { restoreTarget: EXACT_TARGET },
): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 4242 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      themeName: "rose",
      intent: "fix the auth race",
      // The two remembered facts + the derived restore target — the fold writes
      // these onto the authored record live; here we seed them directly.
      lastActivityAt: 123,
      lastAgentCommand: "opencode --model sonnet",
      restoreTarget: opts.restoreTarget,
    },
    snapshot: snapshotActive(),
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

/** The OBSERVATION half — the five snapshot fields a memoryless producer emits,
 *  with a RESOLVED live `pr` (so the wake-time reset back to `pending` is
 *  meaningful, and the sleep carry-over of the restore-relevant `pr` is visible). */
function snapshotActive(): TerminalSnapshot {
  return {
    cwd: "/work/repo",
    git: null,
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
  installSnapshot(ID, entry.snapshot);
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
  it("keeps the SAME id, rides the resume inputs on the authored arm, keeps the snapshot (incl. pr), releases the handle", () => {
    seedActive();
    expect(endpoint.sleep(ID)).toBe(true);

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
    expect(endpoint.sleep(ID)).toBe(false);
  });

  it("is a no-op on an already-sleeping id (idempotent)", () => {
    seedActive();
    expect(endpoint.sleep(ID)).toBe(true);
    expect(endpoint.sleep(ID)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });
});

describe("snapshotSession — a slept terminal serializes through the sleeping arm", () => {
  it("emits state=sleeping + sleptAt, strips agent/foreground, keeps the pr snapshot + lastAgentCommand + restoreTarget", () => {
    seedActive();
    endpoint.sleep(ID);

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
    expect(() => SavedTerminalSchema.parse(saved)).not.toThrow();
    const raw = saved as Record<string, unknown>;
    expect(raw.agent).toBeUndefined();
    expect(raw.foreground).toBeUndefined();
    expect(saved.pr?.kind).toBe("ok");
  });
});

describe("wake — resets the snapshot, keeps the authored memory", () => {
  it("re-seeds the snapshot to defaults, rides the resume inputs through on the authored record, and resumes the exact conversation", async () => {
    seedActive();
    expect(endpoint.sleep(ID)).toBe(true);

    // Wake registers the active sync-shadow synchronously (the spawn tail fails on
    // a later microtask — no kaval); assert the store at that sync point.
    endpoint.wake(ID);
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
    const entry = authoredActive({ restoreTarget: { kind: "none" } });
    registerTerminal(ID, entry);
    installSnapshot(ID, entry.snapshot);
    expect(endpoint.sleep(ID)).toBe(true);

    endpoint.wake(ID);
    expect(resumeFormFor(getTerminal(ID)?.meta.restoreTarget)).toBeNull();

    await new Promise((r) => setTimeout(r, 0));
  });

  it("resumes most-recent on a `legacyMostRecent` target (migrated pre-1.29 record)", async () => {
    // A pre-1.29 record that remembered a launch command but never captured the
    // session id migrates to a NAMED `legacyMostRecent` target — so the old
    // most-recent behavior is preserved for already-saved sessions, distinctly from
    // a quit-to-shell `none`.
    const entry = authoredActive({
      restoreTarget: {
        kind: "legacyMostRecent",
        command: "opencode --model sonnet",
      },
    });
    registerTerminal(ID, entry);
    installSnapshot(ID, entry.snapshot);
    expect(endpoint.sleep(ID)).toBe(true);

    endpoint.wake(ID);
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
    expect(endpoint.seedSleeping(sleepingRecord())).toBe(true);

    // Wake returns synchronously after registering the active sync-shadow; the
    // spawn tail fails on a later microtask. The shadow IS active right after.
    endpoint.wake(WAKE_ID);
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
    expect(endpoint.seedSleeping(sleepingRecord())).toBe(true);
    // The seed itself doesn't publish the wire; start from a clean slate.
    upserts.length = 0;

    endpoint.wake(PUB_ID);
    expect(getTerminal(PUB_ID)?.meta.state).toBe("active");
    expect(upserts).toContainEqual({ id: PUB_ID, state: "active" });
  });
});

describe("discardSleeping — removes only a sleeping record (both halves)", () => {
  it("removes a sleeping record and its snapshot", () => {
    seedActive();
    endpoint.sleep(ID);
    expect(endpoint.discardSleeping(ID)).toBe(true);
    expect(getTerminal(ID)).toBeUndefined();
    expect(snapshotFor(ID)).toBeUndefined();
  });

  it("is a no-op on an active id (active terminals must be killed, not discarded)", () => {
    seedActive();
    expect(endpoint.discardSleeping(ID)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("active");
  });
});

describe("seedSleeping — boot seed with per-record tolerance", () => {
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
    expect(endpoint.seedSleeping(validRecord())).toBe(true);
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
    expect(endpoint.seedSleeping(malformed as never)).toBe(false);
    expect(getTerminal(SEED_ID)).toBeUndefined();
    expect(snapshotFor(SEED_ID)).toBeUndefined();
  });

  it("DROPS a record with a non-uuid id", () => {
    const bad = { ...validRecord(), id: "not-a-uuid" };
    expect(endpoint.seedSleeping(bad as never)).toBe(false);
  });

  it("is idempotent — re-seeding a present id is a no-op", () => {
    expect(endpoint.seedSleeping(validRecord())).toBe(true);
    expect(endpoint.seedSleeping(validRecord())).toBe(false);
    expect(getTerminal(SEED_ID)?.meta.state).toBe("sleeping");
  });
});
