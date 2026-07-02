/**
 * Differential gate for W1.R1 — the served `terminals` collection MUST be
 * byte-identical to the client reader-join it replaced.
 *
 * Before R1 the client joined two halves at read time —
 * `composeTerminalMetadata(app.collections.authored[id],
 * workspace.collections.snapshots[id])`. R1 deleted that client join and moved the
 * compose SERVER-side: padi's `terminals` collection reads the registry and folds
 * the two halves that share the one entry. This test pins that the served backing
 * (`readAll` / `readOne`) produces EXACTLY the record the deleted client join would
 * have — for BOTH arms (an active entry with meta+snapshot, a sleeping entry whose
 * compose runs the restore-relevant zod projection). If they ever diverge, a tile
 * renders different bytes than it did pre-migration.
 */

import {
  AuthoredSleepingSchema,
  type AuthoredActiveTerminal,
  type AuthoredSleepingTerminal,
  composeTerminalMetadata,
  LOCAL_LOCATION,
  type TerminalSnapshot,
} from "kolu-common/surface";
import type { TerminalEndpoint } from "kolu-common/terminalEndpoint";
import type { Logger } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { buildPadiSurfaceDeps } from "./servePadi.ts";
import {
  type ActiveTerminalProcess,
  registerTerminal,
  type SleepingTerminalProcess,
  unregisterTerminal,
} from "./terminal-registry.ts";

const ACTIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLEEPING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

  it("readAll produces the composed record for every entry, in registry order", () => {
    seed();
    const { readAll } = terminalsBacking();

    const all = readAll();
    expect(all.size).toBe(2);
    expect(all.get(ACTIVE_ID)).toEqual(
      composeTerminalMetadata(activeMeta, activeSnapshot),
    );
    expect(all.get(SLEEPING_ID)).toEqual(
      composeTerminalMetadata(sleepingMeta, sleepingSnapshot),
    );
    // Insertion order is the client's display ordering — active first.
    expect([...all.keys()]).toEqual([ACTIVE_ID, SLEEPING_ID]);
  });

  it("readOne is undefined for an absent id (no entry to compose)", () => {
    const { readOne } = terminalsBacking();
    expect(readOne("nope")).toBeUndefined();
  });
});
