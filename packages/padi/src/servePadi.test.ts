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

import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { inMemoryStore } from "@kolu/surface/server";
import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Exit, Schema } from "effect";
import { availableThemes, getThemeByName, themeMode } from "terminal-themes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NEW_TERMINAL_POLICY } from "./newTerminalPolicy.ts";
import { newTerminalPolicyStore, shufflePeerBgs } from "./newTerminalTheme.ts";
import { setActiveTerminalId } from "./terminals.ts";
import { setPadiSessionStore } from "./session/confStores.ts";
import { setDaemonProcessId } from "./koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";
import { fakeEndpoint, stubLog } from "./servePadi.testlib.ts";
import { getSavedSession, setSavedSession } from "./session/session.ts";
import {
  PADI_SURFACE_VERSION,
  type PadiIdentity,
  PadiParkedTerminalSchema,
  type PadiStatus,
  PadiStatusSchema,
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
import { cleanupTerminalScratch } from "./terminalScratch.ts";
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
  type TerminalPlacement,
  TOPLEVEL_PLACEMENT,
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
const sleepingMeta: AuthoredSleepingTerminal = Schema.decodeUnknownSync(
  AuthoredSleepingSchema,
)({
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
const parkedMeta: AuthoredParkedTerminal = Schema.decodeUnknownSync(
  AuthoredParkedSchema,
)({
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
  Schema.decodeUnknownSync(PadiParkedTerminalSchema)({
    ...Schema.decodeUnknownSync(PersistedSnapshotSchema)(parkedSnapshot),
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

describe("padi's `status` cell — the expected-kaval axis, OFF-NIX (#17 audit)", () => {
  /** The `status` cell's in-memory backing, narrowed out of the deps shape. */
  function statusBacking(): PadiStatus {
    const deps = buildPadiSurfaceDeps({
      endpoint: fakeEndpoint,
      log: stubLog,
      startedAt: 0,
      commit: "",
      lifetime: { kind: "forever" },
      stateRoot: "/tmp/padi-test-state-root",
    });
    const store = (
      deps.cells?.status as { store?: { get: () => PadiStatus } } | undefined
    )?.store;
    if (!store) throw new Error("padi deps must back the status cell");
    return store.get();
  }

  // A vitest run has no `KAVAL_BUILD_ID` — nix bakes it and nothing else does —
  // so `currentPtyHostIdentity().staleKey` is `""` here, which is the ORDINARY
  // state of every from-source server, not an edge case. `expectedKaval` is
  // `Schema.optionalKey`, and this seeded value is what EVERY `status` subscribe
  // encodes, so the pre-fix `expectedKaval: … : undefined` seed broke the cell
  // for the whole from-source world. Falsify by restoring that ternary: the
  // encode below throws `Expected { readonly staleKey: string; … }, got undefined`.
  it("OMITS the key off-nix — the seeded value must ENCODE on the wire", () => {
    const status = statusBacking();
    expect(Object.hasOwn(status, "expectedKaval")).toBe(false);
    expect(
      JSON.stringify(Schema.encodeUnknownSync(PadiStatusSchema)(status)),
    ).toBe("{}");
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

/** The `scratch.write` handler, narrowed out of the all-optional deps shape.
 *  A procedure handler returns an `Effect` now (S2), so the gate's refusal is a
 *  typed FAILURE rather than a throw. */
type ScratchWriteFn = (args: {
  input: {
    terminalId: string;
    name: string;
    data: string;
    appendTo?: string;
  };
}) => Effect.Effect<{ path: string }, unknown>;

function scratchWrite(): ScratchWriteFn {
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
  return w as unknown as ScratchWriteFn;
}

/** Run a procedure handler to completion. A handler returns an `Effect` now
 *  (S2's ONE `ProcedureImpl` arm), so a test that merely CALLS one runs nothing —
 *  this is the run edge every handler-driving test in this file goes through. */
async function runHandler(effect: unknown): Promise<unknown> {
  return await Effect.runPromise(effect as Effect.Effect<unknown, unknown>);
}

/** Run the gate and pull the DECLARED failure's `_tag` — one assertion pins BOTH
 *  that the gate refused AND which typed error it refused with. The oRPC-era
 *  `err.code` string is gone with the codes: a consumer narrows on `_tag` now
 *  (PLAN D4), so that is what the pin reads. */
async function failureTag(
  run: () => Effect.Effect<unknown, unknown>,
): Promise<string> {
  const exit = await Effect.runPromiseExit(run());
  if (Exit.isSuccess(exit)) return "<did not fail>";
  const err = Cause.squash(exit.cause) as { _tag?: unknown };
  return typeof err?._tag === "string"
    ? err._tag
    : "<not a declared padi error>";
}

describe("padi scratch.write re-enforces the authoritative upload gate (F1)", () => {
  // A base64 string whose DECODED length exceeds the 50 MB cap (all-`A`, no
  // padding → decoded = floor(len*3/4)). It is rejected on size BEFORE any disk
  // write, so materializing the string is the whole cost.
  const oversize = "A".repeat(Math.ceil(((MAX_UPLOAD_BYTES + 4) * 4) / 3));

  it("rejects oversize data with ScratchWriteRejected (never reaches disk)", async () => {
    seed();
    const write = scratchWrite();
    await expect(
      failureTag(() =>
        write({
          input: { terminalId: ACTIVE_ID, name: "big.txt", data: oversize },
        }),
      ),
    ).resolves.toBe("ScratchWriteRejected");
  });

  it("rejects a disallowed extension with ScratchWriteRejected", async () => {
    seed();
    const write = scratchWrite();
    await expect(
      failureTag(() =>
        write({
          input: { terminalId: ACTIVE_ID, name: "malware.exe", data: "AAAA" },
        }),
      ),
    ).resolves.toBe("ScratchWriteRejected");
  });

  it("rejects an absent terminal id with TerminalNotFound (no orphan scratch file)", async () => {
    const write = scratchWrite();
    await expect(
      failureTag(() =>
        write({
          input: { terminalId: "nope", name: "notes.md", data: "AAAA" },
        }),
      ),
    ).resolves.toBe("TerminalNotFound");
  });

  it("rejects a SLEEPING id with TerminalNotFound (only an ACTIVE terminal can take an upload)", async () => {
    seed();
    const write = scratchWrite();
    await expect(
      failureTag(() =>
        write({
          input: { terminalId: SLEEPING_ID, name: "notes.md", data: "AAAA" },
        }),
      ),
    ).resolves.toBe("TerminalNotFound");
  });

  it("rejects a PARKED id with TerminalNotFound (a reboot placeholder can't take an upload)", async () => {
    seed();
    const write = scratchWrite();
    await expect(
      failureTag(() =>
        write({
          input: { terminalId: PARKED_ID, name: "notes.md", data: "AAAA" },
        }),
      ),
    ).resolves.toBe("TerminalNotFound");
  });
});

/**
 * The chunked upload's server half (juspay/kolu#2101 G9a/G9c).
 *
 * The gate that mattered before chunking was "is this ONE payload too big".
 * Once a file arrives in pieces, that question is worthless on its own: an
 * unlimited file is an unlimited number of individually-legal chunks. So the
 * cap has to be re-asked against the accumulated total, and these pin that it
 * is — plus that the client-supplied continuation path buys no authority.
 */
describe("padi scratch.write chunked continuation (G9a)", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");

  afterEach(() => {
    cleanupTerminalScratch(ACTIVE_ID);
  });

  it("appends chunks into one file and returns a stable path", async () => {
    seed();
    const write = scratchWrite();
    const first = (await runHandler(
      write({
        input: { terminalId: ACTIVE_ID, name: "n.md", data: b64("ab") },
      }),
    )) as { path: string };
    const second = (await runHandler(
      write({
        input: {
          terminalId: ACTIVE_ID,
          name: "n.md",
          data: b64("cd"),
          appendTo: first.path,
        },
      }),
    )) as { path: string };
    expect(second.path).toBe(first.path);
    expect(readFileSync(second.path, "utf8")).toBe("abcd");
  });

  it("refuses a continuation whose path escapes the terminal's scratch dir", async () => {
    seed();
    const write = scratchWrite();
    await expect(
      failureTag(() =>
        write({
          input: {
            terminalId: ACTIVE_ID,
            name: "n.md",
            data: b64("x"),
            appendTo: "/etc/passwd",
          },
        }),
      ),
    ).resolves.toBe("ScratchWriteRejected");
  });

  it("refuses a continuation to a file that was never created", async () => {
    seed();
    const write = scratchWrite();
    const anchor = (await runHandler(
      write({ input: { terminalId: ACTIVE_ID, name: "a.md", data: b64("x") } }),
    )) as { path: string };
    await expect(
      failureTag(() =>
        write({
          input: {
            terminalId: ACTIVE_ID,
            name: "a.md",
            data: b64("y"),
            appendTo: `${dirname(anchor.path)}/never-created.md`,
          },
        }),
      ),
    ).resolves.toBe("ScratchWriteRejected");
  });

  it("still needs an ACTIVE terminal for every chunk, not just the first", async () => {
    // A terminal that dies mid-upload must stop taking bytes. The liveness gate
    // runs before the append branch, so this holds for continuations too.
    seed();
    const write = scratchWrite();
    const first = (await runHandler(
      write({ input: { terminalId: ACTIVE_ID, name: "n.md", data: b64("a") } }),
    )) as { path: string };
    await expect(
      failureTag(() =>
        write({
          input: {
            terminalId: SLEEPING_ID,
            name: "n.md",
            data: b64("b"),
            appendTo: first.path,
          },
        }),
      ),
    ).resolves.toBe("TerminalNotFound");
  });

  it("enforces the size cap on the ACCUMULATED total, not the chunk", async () => {
    // THE property chunking could have quietly destroyed. Each chunk here is
    // individually legal; together they exceed MAX_UPLOAD_BYTES, and the gate
    // must refuse on the total. Without the post-append `rejectionFor` on the
    // real on-disk size, this passes silently and the 50 MB cap means nothing.
    seed();
    const write = scratchWrite();
    // Two-thirds of the cap each: legal alone, over the cap together.
    const half = "A".repeat(Math.ceil((((MAX_UPLOAD_BYTES * 2) / 3) * 4) / 3));
    const first = (await runHandler(
      write({ input: { terminalId: ACTIVE_ID, name: "big.txt", data: half } }),
    )) as { path: string };
    await expect(
      failureTag(() =>
        write({
          input: {
            terminalId: ACTIVE_ID,
            name: "big.txt",
            data: half,
            appendTo: first.path,
          },
        }),
      ),
    ).resolves.toBe("ScratchWriteRejected");
    // And the over-cap file is REMOVED rather than left truncated on disk,
    // where an agent could read a partial upload as a whole one.
    expect(existsSync(first.path)).toBe(false);
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
      | ((a: { input: { placement: TerminalPlacement } }) => unknown)
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

  it("(v) a plain create does NOT forfeit — parked entries + saved blob both survive, restore stays offered", async () => {
    setSavedSession(savedBlob());
    seedParked();
    expect(getTerminal(PARKED_ID)?.meta.state).toBe("parked");

    const { create } = serve();
    await runHandler(create({ input: { placement: TOPLEVEL_PLACEMENT } }));

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

  it("(vii) session.forfeit discards the parked entries AND clears the saved session, atomically", async () => {
    setSavedSession(savedBlob());
    seedParked();

    const { forfeit } = serve();
    await runHandler(forfeit({ input: {} }));

    // Both the parked entries and the blob are gone, together — one user act.
    expect(getTerminal(PARKED_ID)).toBeUndefined();
    expect(getSavedSession()).toBeNull();
  });
});

// ── lifecycle.create resolves the new-terminal theme from the pushed policy ──
//
// The #2045 fix: theme policy used to be request decoration the BROWSER applied,
// so an MCP-created terminal skipped it entirely. It now resolves here, against
// the `newTerminalPolicy` cell kolu-server pushes, so every face gets the same
// answer.
describe("padi new-terminal theme — lifecycle.create resolves the pushed policy", () => {
  const PEER_THEME = "Nordfox";

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
      | ((a: {
          input: { placement: TerminalPlacement; themeName?: string };
        }) => unknown)
      | undefined;
    if (!create) throw new Error("padi deps must serve lifecycle.create");
    return create;
  }

  /** Register an ACTIVE entry carrying `themeName`, and return its id. */
  function seedActive(id: string, themeName: string | undefined): string {
    registerTerminal(id, {
      info: { id, pid: 1 },
      meta: { ...activeMeta, themeName },
      snapshot: activeSnapshot,
      handle: {} as ActiveTerminalProcess["handle"],
    });
    return id;
  }

  /** Every terminal BIRTH publish this test's ctx saw, newest last. */
  let born: Array<{ id: string; themeName?: string }> = [];

  /** A padi ctx that records the `terminals` collection upserts — the birth
   *  publish `registerActiveAndSpawn` fires, which is the very frame the client
   *  renders a new tile from. Every other member no-ops. */
  function recordingCtx(): ReturnType<typeof noopPadiSurfaceCtxForTest> {
    const base = noopPadiSurfaceCtxForTest();
    return {
      ...base,
      collections: new Proxy({} as never, {
        get: (_t, name) =>
          name === "terminals"
            ? {
                upsert: (id: string, v: { themeName?: string }) => {
                  born.push({ id, themeName: v.themeName });
                },
                remove: () => {},
                readAll: () => new Map(),
                readOne: () => undefined,
              }
            : (base.collections as Record<string, unknown>)[name as string],
      }),
    } as ReturnType<typeof noopPadiSurfaceCtxForTest>;
  }

  /** The theme the create just stamped, read off the BIRTH publish.
   *
   *  NOT off a post-hoc registry read: a procedure handler is an `Effect` now, so
   *  awaiting it hands the create's async tail a turn — and with no kaval to spawn
   *  into, that tail unwinds its own registry entry (`unwindSpawnShadow`) before
   *  the await resolves. The publish is the honest observation point, and it is
   *  the one the feature exists to feed. */
  async function createdTheme(
    create: ReturnType<typeof serve>,
    input: { themeName?: string; placement?: TerminalPlacement } = {},
  ): Promise<string | undefined> {
    const seeded = new Set([...terminalEntries()].map(([id]) => id));
    born = [];
    // Placement is REQUIRED on the wire, so the helper's default is an explicit
    // top-level — the arm every theme case except the split one is about.
    await runHandler(
      create({ input: { placement: TOPLEVEL_PLACEMENT, ...input } }),
    );
    // Keyed by id, last write wins: a birth publishes TWICE by design (the
    // snapshot install, then the lifecycle-state publish), and both carry the
    // composed record — so the count that matters is distinct terminals.
    const fresh = [
      ...new Map(
        born.filter((b) => !seeded.has(b.id)).map((b) => [b.id, b] as const),
      ).values(),
    ];
    if (fresh.length !== 1)
      throw new Error(`create published ${fresh.length} births, expected 1`);
    return fresh[0]?.themeName;
  }

  beforeEach(() => {
    born = [];
    setPadiSurfaceCtx(recordingCtx());
  });
  afterEach(async () => {
    // The kaval-less fresh spawn's async tail rejects on a later microtask; let
    // it settle before draining the registry the create wrote into.
    await new Promise((r) => setTimeout(r, 0));
    for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
    setActiveTerminalId(null);
    newTerminalPolicyStore.set(DEFAULT_NEW_TERMINAL_POLICY);
    __resetPadiSurfaceCtxForTest();
  });

  it("inherit — copies the active terminal's theme", async () => {
    newTerminalPolicyStore.set({ kind: "inherit" });
    setActiveTerminalId(seedActive(ACTIVE_ID, PEER_THEME));
    await expect(createdTheme(serve())).resolves.toBe(PEER_THEME);
  });

  it("inherit with no active terminal — the metadata stays theme-less (the client's built-in default)", async () => {
    newTerminalPolicyStore.set({ kind: "inherit" });
    seedActive(ACTIVE_ID, PEER_THEME);
    await expect(createdTheme(serve())).resolves.toBeUndefined();
  });

  it("inherit with a STALE active marker (the terminal was killed) — theme-less, not a crash", async () => {
    // `killTerminal` does not clear the marker, so the id can outlive its entry.
    newTerminalPolicyStore.set({ kind: "inherit" });
    setActiveTerminalId(seedActive(ACTIVE_ID, PEER_THEME));
    unregisterTerminal(ACTIVE_ID);
    await expect(createdTheme(serve())).resolves.toBeUndefined();
  });

  it("shuffle — picks a real catalogue theme of the policy's family, distinct from the sole peer", async () => {
    newTerminalPolicyStore.set({ kind: "shuffle", mode: "dark" });
    seedActive(ACTIVE_ID, PEER_THEME);
    const picked = await createdTheme(serve());
    const named = availableThemes.find((t) => t.name === picked);
    if (!named) throw new Error(`picked theme not in the catalogue: ${picked}`);
    expect(themeMode(named)).toBe("dark");
    // The spread picker maximises distance from the peer set, so the peer's own
    // background (distance zero — the worst possible score) is never the answer.
    expect(picked).not.toBe(PEER_THEME);
  });

  it("an explicit themeName wins over BOTH policy kinds (session restore, worktree opens)", async () => {
    newTerminalPolicyStore.set({ kind: "inherit" });
    setActiveTerminalId(seedActive(ACTIVE_ID, PEER_THEME));
    await expect(
      createdTheme(serve(), { themeName: "Homebrew" }),
    ).resolves.toBe("Homebrew");
    newTerminalPolicyStore.set({ kind: "shuffle", mode: "dark" });
    await expect(
      createdTheme(serve(), { themeName: "Homebrew" }),
    ).resolves.toBe("Homebrew");
  });

  it("a SPLIT resolves no policy theme — it renders with its PARENT's, and stays out of the peer set", async () => {
    // A split pane draws inside its parent tile and is handed the parent's theme
    // (`TerminalContent.tsx`), so a shuffled tint for it would be invisible — and
    // would then steer later shuffles away from colours nobody can see.
    newTerminalPolicyStore.set({ kind: "shuffle", mode: "dark" });
    setActiveTerminalId(seedActive(ACTIVE_ID, PEER_THEME));
    await expect(
      createdTheme(serve(), {
        placement: { kind: "child-of", parentId: ACTIVE_ID },
      }),
    ).resolves.toBeUndefined();
    expect(shufflePeerBgs()).toEqual([
      getThemeByName(PEER_THEME).background as string,
    ]);
  });

  it("parked entries are NOT shuffle peers — their tints belong to a dead session, not a visible tile", () => {
    seedActive(ACTIVE_ID, PEER_THEME);
    registerTerminal(PARKED_ID, {
      info: { id: PARKED_ID, pid: 0 },
      meta: parkedMeta,
      snapshot: parkedSnapshot,
    } as ParkedTerminalProcess);
    expect(shufflePeerBgs()).toEqual([
      getThemeByName(PEER_THEME).background as string,
    ]);
  });
});
