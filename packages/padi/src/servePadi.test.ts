/**
 * Differential gate for W1.R1 — the served `terminals` collection MUST be
 * byte-identical to the client reader-join it replaced.
 *
 * Before R1 the client joined two halves at read time — the now-retired
 * `kolu.authored` record (deleted at W1.R7) and `terminalWorkspace.snapshots`,
 * folded by `composeTerminalMetadata`. R1 deleted that client join and moved the
 * compose SERVER-side: padi's `terminals` collection reads the registry and folds
 * the two halves that share the one entry. This test pins that the served backing
 * (`readAll` / `readOne`) produces EXACTLY the record the deleted client join would
 * have — for BOTH arms (an active entry with meta+snapshot, a sleeping entry whose
 * compose runs the restore-relevant zod projection). If they ever diverge, a tile
 * renders different bytes than it did pre-migration.
 */

import { inMemoryStore } from "@kolu/surface/server";
import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import { fakeEndpoint, stubLog } from "./servePadi.testlib.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";
import { setPadiSessionStore } from "./session/confStores.ts";
import { getSavedSession, setSavedSession } from "./session/session.ts";
import {
  PADI_SURFACE_VERSION,
  type PadiIdentity,
  PadiParkedTerminalSchema,
} from "./surface.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  type ParkedTerminalProcess,
  registerTerminal,
  type SleepingTerminalProcess,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { MAX_UPLOAD_BYTES } from "./upload.ts";
import {
  type AuthoredActiveTerminal,
  AuthoredParkedSchema,
  type AuthoredParkedTerminal,
  AuthoredSleepingSchema,
  type AuthoredSleepingTerminal,
  composeTerminalMetadata,
  LOCAL_LOCATION,
  PersistedSnapshotSchema,
  type SavedActiveTerminal,
  type SavedSession,
} from "./vocab.ts";

// The parked-forfeit path drives `cleanupTerminalScratch`, which reads the
// per-instance scratch root; boot injects the server id before any of this runs.
setDaemonProcessId("servepadi-test-server");

const ACTIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLEEPING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PARKED_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const activeMeta: AuthoredActiveTerminal = {
  state: "active",
  location: LOCAL_LOCATION,
  lastActivityAt: 42,
  themeName: "rose",
  intent: "fix the auth race",
};

const activeSnapshot: TerminalSnapshot = {
  cwd: "/work/repo",
  git: null,
  pr: { kind: "pending" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

// Parse through the authored-sleeping schema so the fixture is a VALID sleeping
// arm (the compose runs `SleepingTerminalSchema.parse`, which would throw on a
// malformed meta — pinning validity keeps the differential honest).
const sleepingMeta: AuthoredSleepingTerminal = AuthoredSleepingSchema.parse({
  state: "sleeping",
  location: LOCAL_LOCATION,
  lastActivityAt: 7,
  lastAgentCommand: "claude --model sonnet",
  sleptAt: 111,
});

const sleepingSnapshot: TerminalSnapshot = {
  cwd: "/work/repo",
  git: null,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

// Parse through the authored-parked schema so the fixture is a VALID parked arm —
// the boot reconcile builds this same authored base off a saved ACTIVE record.
const parkedMeta: AuthoredParkedTerminal = AuthoredParkedSchema.parse({
  state: "parked",
  parkedAt: 999,
  location: LOCAL_LOCATION,
  lastActivityAt: 55,
  lastAgentCommand: "claude --model opus",
  themeName: "nord",
});

const parkedSnapshot: TerminalSnapshot = {
  cwd: "/work/parked",
  git: null,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

function seed(): void {
  registerTerminal(ACTIVE_ID, {
    info: { id: ACTIVE_ID, pid: 1 },
    meta: activeMeta,
    snapshot: activeSnapshot,
    handle: {} as ActiveTerminalProcess["handle"],
  });
  registerTerminal(SLEEPING_ID, {
    info: { id: SLEEPING_ID, pid: 0 },
    meta: sleepingMeta,
    snapshot: sleepingSnapshot,
  } as SleepingTerminalProcess);
  registerTerminal(PARKED_ID, {
    info: { id: PARKED_ID, pid: 0 },
    meta: parkedMeta,
    snapshot: parkedSnapshot,
  } as ParkedTerminalProcess);
}

/** Build the deps and narrow the `terminals` collection reads out of the
 *  all-optional `ImplementSurfaceDeps` shape — a boot-required member, so a
 *  missing read is a genuine defect worth throwing on. */
function terminalsBacking(): {
  readOne: (key: string) => unknown;
  readAll: () => Map<string, unknown>;
} {
  const deps = buildPadiSurfaceDeps({
    endpoint: fakeEndpoint,
    log: stubLog,
    startedAt: 0,
    commit: "",
    lifetime: { kind: "forever" },
    stateRoot: "/tmp/padi-test-state-root",
  });
  // `terminals` is an AUTHORED collection (the `readAll`/`readOne` arm), not a
  // graph-owned `derived.collection`; narrow the dep union by the presence of the
  // `readOne` read seam (the derived arm omits it) before reading it.
  const t = deps.collections?.terminals;
  if (!t || !("readOne" in t) || !t.readOne || !t.readAll) {
    throw new Error("padi deps must serve the terminals collection reads");
  }
  return { readOne: t.readOne, readAll: t.readAll };
}

afterEach(() => {
  unregisterTerminal(ACTIVE_ID);
  unregisterTerminal(SLEEPING_ID);
  unregisterTerminal(PARKED_ID);
});

/** The served `parked` value — the explicit branch in `composePadiTerminal`
 *  (NOT `composeTerminalMetadata`, which only emits active|sleeping): the
 *  restore-relevant snapshot projection joined with the authored parked arm. */
const parkedProjection = () =>
  PadiParkedTerminalSchema.parse({
    ...PersistedSnapshotSchema.parse(parkedSnapshot),
    ...parkedMeta,
  });

describe("padi's own `identity` cell — the per-host hello twin (W4 host-scoping)", () => {
  /** The `identity` cell's in-memory backing, narrowed out of the deps shape. */
  function identityBacking(opts: {
    startedAt: number;
    commit: string;
  }): PadiIdentity {
    const deps = buildPadiSurfaceDeps({
      endpoint: fakeEndpoint,
      log: stubLog,
      startedAt: opts.startedAt,
      commit: opts.commit,
      lifetime: { kind: "forever" },
      stateRoot: "/tmp/padi-test-state-root",
    });
    // White-box read of the authored cell's backing store. The cell-dep slot is a
    // union whose poll arm carries no `store`, so narrow to the store-bearing shape.
    const store = (
      deps.cells?.identity as
        | { store?: { get: () => PadiIdentity } }
        | undefined
    )?.store;
    if (!store) throw new Error("padi deps must back the identity cell");
    return store.get();
  }

  it("reuses the caller's startedAt/commit VERBATIM — the same constants `hello` reads, never re-derived", () => {
    expect(
      identityBacking({ startedAt: 1_700_000_000_000, commit: "abc1234" }),
    ).toEqual({
      commit: "abc1234",
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
      lifetime: { kind: "forever" },
    });
  });

  it("maps an off-nix empty commit to a DECLARED `null` — never a blank string a render site must re-interpret", () => {
    expect(identityBacking({ startedAt: 42, commit: "" })).toEqual({
      commit: null,
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 42,
      lifetime: { kind: "forever" },
    });
  });
});

describe("padi terminals collection backing == the deleted client reader-join", () => {
  it("readOne produces exactly composeTerminalMetadata(meta, snapshot) for each arm", () => {
    seed();
    const { readOne } = terminalsBacking();

    expect(readOne(ACTIVE_ID)).toEqual(
      composeTerminalMetadata(activeMeta, activeSnapshot),
    );
    expect(readOne(SLEEPING_ID)).toEqual(
      composeTerminalMetadata(sleepingMeta, sleepingSnapshot),
    );
  });

  it("readOne composes the PARKED arm via the explicit branch (state=parked)", () => {
    seed();
    const { readOne } = terminalsBacking();

    const parked = readOne(PARKED_ID) as { state?: string };
    // The parked value is the restore-relevant snapshot projection + the authored
    // parked arm — `state: "parked"` with `parkedAt`, its `lastActivityAt`
    // preserved (RISK Q6), and NO live agent/foreground fields (dropped by the
    // persisted-snapshot projection).
    expect(parked).toEqual(parkedProjection());
    expect(parked.state).toBe("parked");
  });

  it("readAll produces the composed record for every entry, in registry order", () => {
    seed();
    const { readAll } = terminalsBacking();

    const all = readAll();
    expect(all.size).toBe(3);
    expect(all.get(ACTIVE_ID)).toEqual(
      composeTerminalMetadata(activeMeta, activeSnapshot),
    );
    expect(all.get(SLEEPING_ID)).toEqual(
      composeTerminalMetadata(sleepingMeta, sleepingSnapshot),
    );
    expect(all.get(PARKED_ID)).toEqual(parkedProjection());
    // Insertion order is the client's display ordering.
    expect([...all.keys()]).toEqual([ACTIVE_ID, SLEEPING_ID, PARKED_ID]);
  });

  it("readOne is undefined for an absent id (no entry to compose)", () => {
    const { readOne } = terminalsBacking();
    expect(readOne("nope")).toBeUndefined();
  });
});

/** The `scratch.write` handler, narrowed out of the all-optional deps shape. */
function scratchWrite(): (args: {
  input: { terminalId: string; name: string; data: string };
}) => { path: string } {
  const deps = buildPadiSurfaceDeps({
    endpoint: fakeEndpoint,
    log: stubLog,
    startedAt: 0,
    commit: "",
    lifetime: { kind: "forever" },
    stateRoot: "/tmp/padi-test-state-root",
  });
  const w = deps.procedures?.scratch?.write;
  if (!w) throw new Error("padi deps must serve scratch.write");
  return w as unknown as (args: {
    input: { terminalId: string; name: string; data: string };
  }) => { path: string };
}

/** Pull the thrown fault's oRPC code, or "" if it wasn't an ORPCError — lets a
 *  single assertion pin BOTH that the gate rejected AND the typed code. */
function thrownCode(fn: () => unknown): string {
  try {
    fn();
    return "<did not throw>";
  } catch (err) {
    return err instanceof ORPCError ? err.code : "<not an ORPCError>";
  }
}

describe("padi scratch.write re-enforces the authoritative upload gate (F1)", () => {
  // A base64 string whose DECODED length exceeds the 50 MB cap (all-`A`, no
  // padding → decoded = floor(len*3/4)). It is rejected on size BEFORE any disk
  // write, so materializing the string is the whole cost.
  const oversize = "A".repeat(Math.ceil(((MAX_UPLOAD_BYTES + 4) * 4) / 3));

  it("rejects oversize data with BAD_REQUEST (never reaches disk)", () => {
    seed();
    const write = scratchWrite();
    expect(
      thrownCode(() =>
        write({
          input: { terminalId: ACTIVE_ID, name: "big.txt", data: oversize },
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("rejects a disallowed extension with BAD_REQUEST", () => {
    seed();
    const write = scratchWrite();
    expect(
      thrownCode(() =>
        write({
          input: { terminalId: ACTIVE_ID, name: "malware.exe", data: "AAAA" },
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("rejects an absent terminal id with NOT_FOUND (no orphan scratch file)", () => {
    const write = scratchWrite();
    expect(
      thrownCode(() =>
        write({
          input: { terminalId: "nope", name: "notes.md", data: "AAAA" },
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("rejects a SLEEPING id with NOT_FOUND (only an ACTIVE terminal can take an upload)", () => {
    seed();
    const write = scratchWrite();
    expect(
      thrownCode(() =>
        write({
          input: { terminalId: SLEEPING_ID, name: "notes.md", data: "AAAA" },
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("rejects a PARKED id with NOT_FOUND (a reboot placeholder can't take an upload)", () => {
    seed();
    const write = scratchWrite();
    expect(
      thrownCode(() =>
        write({
          input: { terminalId: PARKED_ID, name: "notes.md", data: "AAAA" },
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

// ── The `session` cell backing — non-recursive + normalizing (C/D, review #2) ──
//
// Review #2's boot-recursion crash: the session cell's `get` must read the injected
// conf store DIRECTLY and normalize empty→null INLINE — it must NOT delegate to
// `getSavedSession`, which reads THIS same cell (mutual recursion → stack overflow
// at boot, when `parkSavedSession` first reads it).
describe("padi session cell backing is non-recursive + normalizes (review #2)", () => {
  const oneTerminal: SavedSession = {
    terminals: [
      {
        id: "s1",
        state: "active",
        cwd: "/x",
        git: null,
        pr: { kind: "absent" },
        location: LOCAL_LOCATION,
        lastActivityAt: 0,
      },
    ],
    activeTerminalId: "s1",
    savedAt: 1,
  };

  /** The `session` cell's backing store, narrowed out of the deps shape. */
  function sessionBacking(): { get: () => SavedSession | null } {
    const deps = buildPadiSurfaceDeps({
      endpoint: fakeEndpoint,
      log: stubLog,
      startedAt: 0,
      commit: "",
      lifetime: { kind: "forever" },
      stateRoot: "/tmp/padi-test-state-root",
    });
    // White-box read of the authored cell's backing store (see `identityBacking`).
    const s = (
      deps.cells?.session as
        | { store?: { get: () => SavedSession | null } }
        | undefined
    )?.store;
    if (!s) throw new Error("padi deps must back the session cell");
    return s;
  }

  afterEach(() => __resetPadiSurfaceCtxForTest());

  it("get() reads the injected store DIRECTLY (returns, no recursion) + normalizes empty→null", () => {
    // A non-empty session is returned with host-stamped resumableIds. That the
    // call RETURNS at all is the proof the backing is non-recursive — a
    // `getSavedSession`-delegating get would recurse into this same cell and
    // blow the stack.
    setPadiSessionStore(inMemoryStore<SavedSession | null>(oneTerminal));
    expect(sessionBacking().get()).toEqual({
      ...oneTerminal,
      resumableIds: [],
    });

    // An empty-terminals blob normalizes to null (legacy "nothing to restore").
    setPadiSessionStore(
      inMemoryStore<SavedSession | null>({
        terminals: [],
        activeTerminalId: null,
        savedAt: 2,
      }),
    );
    expect(sessionBacking().get()).toBeNull();
  });

  it("getSavedSession() reads the same backing through padi's ctx (one hop) + normalizes", () => {
    setPadiSessionStore(inMemoryStore<SavedSession | null>(oneTerminal));
    const backing = sessionBacking();
    // Wire padi's ctx `session` cell to the SAME backing, so getSavedSession →
    // `padiSurfaceCtx.cells.session.get()` → backing.get() (which reads the store,
    // never getSavedSession). One hop, no stack overflow.
    setPadiSurfaceCtx({
      cells: new Proxy({} as never, {
        get: (_t, n) =>
          n === "session"
            ? backing
            : { get: () => undefined, set: () => {}, patch: () => {} },
      }),
      collections: new Proxy({} as never, {
        get: () => ({
          upsert: () => {},
          remove: () => {},
          readAll: () => new Map(),
          readOne: () => undefined,
        }),
      }),
      events: new Proxy({} as never, { get: () => ({ publish: () => {} }) }),
    } as never);
    expect(getSavedSession()).toEqual({
      ...oneTerminal,
      resumableIds: [],
    });
  });
});

// ── create preserves the restore; session.forfeit is the explicit discard (K) ──
//
// The prior behaviour (a plain create FORFEITED the restore by discarding every
// parked entry) was the PATH-B data-loss bug: parked records are invisible to
// `snapshotSession`, so once a create dropped them, the next autosave shrank the
// saved blob (the restore source of truth) to whatever was live — and a close then
// nulled it. The new semantics: creating a terminal leaves the restore OFFERED (the
// parked entries + the saved session survive), and forfeit is the EXPLICIT
// `session.forfeit` act that drops the parked entries AND clears the blob together.
describe("padi restore forfeit — create preserves, session.forfeit discards (K)", () => {
  /** A padi ctx whose `session` cell is a real in-memory store, so
   *  `setSavedSession` / `getSavedSession` / `clearSavedSession` round-trip; every
   *  other member no-op. */
  function sessionBackedCtx(): ReturnType<typeof noopPadiSurfaceCtxForTest> {
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

  const savedActive = (id: string, cwd: string): SavedActiveTerminal => ({
    id,
    state: "active",
    cwd,
    git: null,
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
    lastActivityAt: 1,
    restoreTarget: { kind: "none" },
  });
  // The pre-reboot session the restore card offers — two ACTIVE records (one of
  // which PARKED_ID stands in for), on disk since parkSavedSession seeded parked.
  const savedBlob = (): SavedSession => ({
    terminals: [
      savedActive(PARKED_ID, "/work/parked"),
      savedActive(ACTIVE_ID, "/b"),
    ],
    activeTerminalId: null,
    savedAt: 1,
  });

  function serve() {
    const deps = buildPadiSurfaceDeps({
      endpoint: fakeEndpoint,
      log: stubLog,
      startedAt: 0,
      commit: "",
      lifetime: { kind: "forever" },
      stateRoot: "/tmp/padi-test-state-root",
    });
    const create = deps.procedures?.lifecycle?.create as
      | ((a: { input: Record<string, never> }) => unknown)
      | undefined;
    const forfeit = deps.procedures?.session?.forfeit as
      | ((a: { input: Record<string, never> }) => unknown)
      | undefined;
    if (!create || !forfeit)
      throw new Error(
        "padi deps must serve lifecycle.create + session.forfeit",
      );
    return { create, forfeit };
  }

  function seedParked(): void {
    registerTerminal(PARKED_ID, {
      info: { id: PARKED_ID, pid: 0 },
      meta: parkedMeta,
      snapshot: parkedSnapshot,
    } as ParkedTerminalProcess);
  }

  beforeEach(() => setPadiSurfaceCtx(sessionBackedCtx()));
  afterEach(async () => {
    // The kaval-less fresh spawn's async tail rejects on a later microtask (the
    // failed-spawn path); let it settle, then drain any entry the create left.
    await new Promise((r) => setTimeout(r, 0));
    for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
    __resetPadiSurfaceCtxForTest();
  });

  it("(v) a plain create does NOT forfeit — parked entries + saved blob both survive, restore stays offered", () => {
    setSavedSession(savedBlob());
    seedParked();
    expect(getTerminal(PARKED_ID)?.meta.state).toBe("parked");

    const { create } = serve();
    create({ input: {} });

    // The parked entry SURVIVES — creating a terminal is no longer a forfeit.
    expect(getTerminal(PARKED_ID)?.meta.state).toBe("parked");
    // The saved session (the restore source of truth) is untouched — all N held.
    expect(getSavedSession()?.terminals.length).toBe(2);
    // The freshly-created terminal is NOT a parked record.
    const freshParked = [...terminalEntries()].filter(
      ([, e]) => e.meta.state === "parked",
    );
    expect(freshParked.map(([id]) => id)).toEqual([PARKED_ID]);
  });

  it("(vii) session.forfeit discards the parked entries AND clears the saved session, atomically", () => {
    setSavedSession(savedBlob());
    seedParked();

    const { forfeit } = serve();
    forfeit({ input: {} });

    // Both the parked entries and the blob are gone, together — one user act.
    expect(getTerminal(PARKED_ID)).toBeUndefined();
    expect(getSavedSession()).toBeNull();
  });
});
