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

import { ORPCError } from "@orpc/server";
import {
  AuthoredParkedSchema,
  AuthoredSleepingSchema,
  type AuthoredActiveTerminal,
  type AuthoredParkedTerminal,
  type AuthoredSleepingTerminal,
  composeTerminalMetadata,
  LOCAL_LOCATION,
  PersistedSnapshotSchema,
  type TerminalSnapshot,
} from "kolu-common/surface";
import type { TerminalEndpoint } from "kolu-common/terminalEndpoint";
import { MAX_UPLOAD_BYTES } from "kolu-common/upload";
import type { Logger } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { buildPadiSurfaceDeps } from "./servePadi.ts";
import { PadiParkedTerminalSchema } from "./surface.ts";
import {
  type ActiveTerminalProcess,
  type ParkedTerminalProcess,
  registerTerminal,
  type SleepingTerminalProcess,
  unregisterTerminal,
} from "./terminal-registry.ts";

const ACTIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLEEPING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PARKED_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** A stub logger — construction of the deps threads it through, but the
 *  `terminals` read handlers never call it. */
const stubLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => stubLog,
} as unknown as Logger;

/** A fake endpoint — the `terminals` collection reads neither `fs` nor `git`, so
 *  the wrapper (`fsGitSurfaceDeps`) only needs the shape to construct. */
const fakeEndpoint = {
  fs: {
    listAll: async () => [],
    readFile: async () => ({ content: "", truncated: false }),
    statFileMtimeMs: async () => 0,
    subscribeRepoChange: () => () => {},
    subscribeFileChange: () => () => {},
  },
  git: {
    getStatus: async () => ({}),
    getDiff: async () => ({}),
  },
} as unknown as TerminalEndpoint;

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
  const deps = buildPadiSurfaceDeps({ endpoint: fakeEndpoint, log: stubLog });
  const t = deps.collections?.terminals;
  if (!t?.readOne || !t?.readAll) {
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
  const deps = buildPadiSurfaceDeps({ endpoint: fakeEndpoint, log: stubLog });
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
  // A base64 string whose DECODED length exceeds the 10 MB cap (all-`A`, no
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
