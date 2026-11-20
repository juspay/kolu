import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AuthoredActiveTerminal,
  AuthoredParkedSchema,
  type AuthoredParkedTerminal,
  AuthoredSleepingSchema,
  type AuthoredSleepingTerminal,
  composeTerminalMetadata,
  DEFAULT_NEW_TERMINAL_POLICY,
  LOCAL_LOCATION,
  PADI_SURFACE_VERSION,
  type PadiIdentity,
  PadiParkedTerminalSchema,
  type PadiStatus,
  PadiStatusSchema,
  PersistedSnapshotSchema,
  type SavedActiveTerminal,
  type SavedSession,
  type TerminalPlacement,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { inMemoryStore } from "@kolu/surface/server";
import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Exit, Schema } from "effect";
import { availableThemes, getThemeByName, themeMode } from "terminal-themes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import { newTerminalPolicyStore, shufflePeerBgs } from "./newTerminalTheme.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import { fakeEndpoint, stubLog, testDiagnostics } from "./servePadi.testlib.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";
import { setPadiSessionStore } from "./session/confStores.ts";
import { getSavedSession, setSavedSession } from "./session/session.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  type ParkedTerminalProcess,
  registerTerminal,
  type SleepingTerminalProcess,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { cleanupTerminalScratch } from "./terminalScratch.ts";
import { setActiveTerminalId } from "./terminals.ts";
import { MAX_UPLOAD_BYTES } from "@kolu/padi-client/upload";

setDaemonProcessId("servepadi-test-server");

const ACTIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLEEPING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PARKED_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const activeMeta: AuthoredActiveTerminal = {
  state: "active",
  location: LOCAL_LOCATION,
  lastActivityAt: 42,
  promptedAt: null,
  themeName: "rose",
  intent: "fix the auth race",
};

const activeSnapshot: TerminalSnapshot = {
  cwd: "/work/repo",
  git: { kind: "none" },
  pr: { kind: "pending" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

const sleepingMeta: AuthoredSleepingTerminal = Schema.decodeUnknownSync(
  AuthoredSleepingSchema,
)({
  state: "sleeping",
  location: LOCAL_LOCATION,
  lastActivityAt: 7,
  sleptAt: 111,
});

const sleepingSnapshot: TerminalSnapshot = {
  cwd: "/work/repo",
  git: { kind: "none" },
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

const parkedMeta: AuthoredParkedTerminal = Schema.decodeUnknownSync(
  AuthoredParkedSchema,
)({
  state: "parked",
  parkedAt: 999,
  location: LOCAL_LOCATION,
  lastActivityAt: 55,
  themeName: "nord",
});

const parkedSnapshot: TerminalSnapshot = {
  cwd: "/work/parked",
  git: { kind: "none" },
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

function terminalsBacking(): {
  readOne: (key: string) => unknown;
  readAll: () => Map<string, unknown>;
} {
  const deps = buildPadiSurfaceDeps({
    endpoint: fakeEndpoint,
    log: stubLog,
    diagnostics: testDiagnostics,
    startedAt: 0,
    commit: "",
    lifetime: { kind: "forever" },
    stateRoot: "/tmp/padi-test-state-root",
  });
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

const parkedProjection = () =>
  Schema.decodeUnknownSync(PadiParkedTerminalSchema)({
    ...Schema.decodeUnknownSync(PersistedSnapshotSchema)(parkedSnapshot),
    ...parkedMeta,
  });

describe("padi's own `identity` cell — the per-host hello twin (W4 host-scoping)", () => {
  function identityBacking(opts: {
    startedAt: number;
    commit: string;
  }): PadiIdentity {
    const deps = buildPadiSurfaceDeps({
      endpoint: fakeEndpoint,
      log: stubLog,
      diagnostics: testDiagnostics,
      startedAt: opts.startedAt,
      commit: opts.commit,
      lifetime: { kind: "forever" },
      stateRoot: "/tmp/padi-test-state-root",
    });
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
  function statusBacking(): PadiStatus {
    const deps = buildPadiSurfaceDeps({
      endpoint: fakeEndpoint,
      log: stubLog,
      diagnostics: testDiagnostics,
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
    expect([...all.keys()]).toEqual([ACTIVE_ID, SLEEPING_ID, PARKED_ID]);
  });

  it("readOne is undefined for an absent id (no entry to compose)", () => {
    const { readOne } = terminalsBacking();
    expect(readOne("nope")).toBeUndefined();
  });
});

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
    diagnostics: testDiagnostics,
    startedAt: 0,
    commit: "",
    lifetime: { kind: "forever" },
    stateRoot: "/tmp/padi-test-state-root",
  });
  const w = deps.procedures?.scratch?.write;
  if (!w) throw new Error("padi deps must serve scratch.write");
  return w as unknown as ScratchWriteFn;
}

async function runHandler(effect: unknown): Promise<unknown> {
  return await Effect.runPromise(effect as Effect.Effect<unknown, unknown>);
}

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

  it("rejects a SLEEPING id with TerminalNotActive (it EXISTS — it just has no live PTY to write under)", async () => {
    seed();
    const write = scratchWrite();
    await expect(
      failureTag(() =>
        write({
          input: { terminalId: SLEEPING_ID, name: "notes.md", data: "AAAA" },
        }),
      ),
    ).resolves.toBe("TerminalNotActive");
  });

  it("rejects a PARKED id with TerminalNotActive (a reboot placeholder can't take an upload)", async () => {
    seed();
    const write = scratchWrite();
    await expect(
      failureTag(() =>
        write({
          input: { terminalId: PARKED_ID, name: "notes.md", data: "AAAA" },
        }),
      ),
    ).resolves.toBe("TerminalNotActive");
  });
});

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
    ).resolves.toBe("TerminalNotActive");
  });

  it("enforces the size cap on the ACCUMULATED total, not the chunk", async () => {
    seed();
    const write = scratchWrite();
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
    expect(existsSync(first.path)).toBe(false);
  });
});

describe("padi session cell backing is non-recursive + normalizes (review #2)", () => {
  const oneTerminal: SavedSession = {
    terminals: [
      {
        id: "s1",
        state: "active",
        cwd: "/x",
        git: { kind: "none" },
        pr: { kind: "absent" },
        location: LOCAL_LOCATION,
        lastActivityAt: 0,
        promptedAt: null,
      },
    ],
    activeTerminalId: "s1",
    savedAt: 1,
  };

  function sessionBacking(): { get: () => SavedSession | null } {
    const deps = buildPadiSurfaceDeps({
      endpoint: fakeEndpoint,
      log: stubLog,
      diagnostics: testDiagnostics,
      startedAt: 0,
      commit: "",
      lifetime: { kind: "forever" },
      stateRoot: "/tmp/padi-test-state-root",
    });
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
    setPadiSessionStore(inMemoryStore<SavedSession | null>(oneTerminal));
    expect(sessionBacking().get()).toEqual({
      ...oneTerminal,
      resumableIds: [],
    });

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

describe("padi restore forfeit — create preserves, session.forfeit discards (K)", () => {
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
    git: { kind: "none" },
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
    lastActivityAt: 1,
    promptedAt: null,
    restoreTarget: { kind: "none" },
  });
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
      diagnostics: testDiagnostics,
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

    expect(getTerminal(PARKED_ID)?.meta.state).toBe("parked");
    expect(getSavedSession()?.terminals.length).toBe(2);
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

    expect(getTerminal(PARKED_ID)).toBeUndefined();
    expect(getSavedSession()).toBeNull();
  });
});

describe("padi new-terminal theme — lifecycle.create resolves the pushed policy", () => {
  const PEER_THEME = "Nordfox";

  function serve() {
    const deps = buildPadiSurfaceDeps({
      endpoint: fakeEndpoint,
      log: stubLog,
      diagnostics: testDiagnostics,
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

  function seedActive(id: string, themeName: string | undefined): string {
    registerTerminal(id, {
      info: { id, pid: 1 },
      meta: { ...activeMeta, themeName },
      snapshot: activeSnapshot,
      handle: {} as ActiveTerminalProcess["handle"],
    });
    return id;
  }

  let born: Array<{ id: string; themeName?: string }> = [];

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

  async function createdTheme(
    create: ReturnType<typeof serve>,
    input: { themeName?: string; placement?: TerminalPlacement } = {},
  ): Promise<string | undefined> {
    const seeded = new Set([...terminalEntries()].map(([id]) => id));
    born = [];
    await runHandler(
      create({ input: { placement: TOPLEVEL_PLACEMENT, ...input } }),
    );
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
