/**
 * `requireMutableTerminal` — the record-level "PARKED is IMMUTABLE" invariant
 * (split-restore FIX 3).
 *
 * A PARKED record is a restore-card placeholder standing in for a saved active
 * terminal until `session.restore` consumes it (the parked→active flip). A client
 * chrome mutation — `chrome.setParent` / `setSubPanel` / `setCanvasLayout` /
 * `setTheme` / `setIntent` / `setRightPanel`, all routed through
 * `requireMutableTerminal` in `servePadi.ts` — targeting one is a STALE write from
 * a supervised restart's drain window (the client's list-driven reconcile promoting
 * a split's sub the drain just removed). It MUST reject: silently un-parenting the
 * parked sub would make the split restore as an orphaned top-level. This closes the
 * hole at the RECORD level — timing-independent, not a restart-in-flight gate.
 *
 * The ACTIVE and SLEEPING arms stay MUTABLE (a chrome edit on a dormant tile is
 * valid); the read/query guard `requireTerminal` keeps ACCEPTING parked.
 */

import type { TerminalId, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ActiveTerminalProcess,
  registerTerminal,
  rejectNestedParent,
  requireMutableTerminal,
  requireTerminal,
  rootAncestorId,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { LOCAL_LOCATION } from "./vocab.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
const ROOT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;
const MID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as TerminalId;
const LEAF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as TerminalId;

const snapshot = (): TerminalSnapshot => ({
  cwd: "/w",
  git: null,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
});

function seedActive(): void {
  registerTerminal(ID, {
    info: { id: ID, pid: 1 },
    meta: { state: "active", location: LOCAL_LOCATION, lastActivityAt: 1 },
    snapshot: snapshot(),
    handle: {} as ActiveTerminalProcess["handle"],
  });
}

function seedSleeping(): void {
  registerTerminal(ID, {
    info: { id: ID, pid: 1 },
    meta: {
      state: "sleeping",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      sleptAt: 1,
    },
    snapshot: snapshot(),
  });
}

function seedParked(): void {
  registerTerminal(ID, {
    info: { id: ID, pid: 1 },
    meta: {
      state: "parked",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      parkedAt: 1,
    },
    snapshot: snapshot(),
  });
}

/** Run `fn` and return whatever it threw (or `undefined` if it didn't). */
function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

afterEach(() => {
  for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
});

describe("requireMutableTerminal — parked records are immutable", () => {
  it("REJECTS a mutation targeting a PARKED record (typed NOT_FOUND)", () => {
    seedParked();
    const err = caught(() => requireMutableTerminal(ID));
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
    // ...yet the read/query guard STILL accepts it — the restore card reads it.
    expect(requireTerminal(ID).meta.state).toBe("parked");
  });

  it("ALLOWS a mutation on a live ACTIVE record", () => {
    seedActive();
    expect(requireMutableTerminal(ID).meta.state).toBe("active");
  });

  it("ALLOWS a mutation on a SLEEPING record (chrome edit on a dormant tile is valid)", () => {
    seedSleeping();
    expect(requireMutableTerminal(ID).meta.state).toBe("sleeping");
  });

  it("REJECTS an absent id (typed NOT_FOUND)", () => {
    const err = caught(() => requireMutableTerminal(ID));
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });
});

describe("rejectNestedParent / rootAncestorId (#2059)", () => {
  function seed(id: TerminalId, parentId?: string): void {
    registerTerminal(id, {
      info: { id, pid: 1 },
      meta: {
        state: "active",
        location: LOCAL_LOCATION,
        lastActivityAt: 1,
        ...(parentId !== undefined ? { parentId } : {}),
      },
      snapshot: snapshot(),
      handle: {} as ActiveTerminalProcess["handle"],
    });
  }

  it("no-ops for a top-level parent (and for an unknown id)", () => {
    seed(ROOT);
    expect(caught(() => rejectNestedParent(ROOT))).toBeUndefined();
    expect(caught(() => rejectNestedParent("nope"))).toBeUndefined();
  });

  it("throws BAD_REQUEST naming the root when parent is itself a split", () => {
    seed(ROOT);
    seed(MID, ROOT);
    seed(LEAF, MID);

    const err = caught(() => rejectNestedParent(LEAF));
    expect(err).toBeInstanceOf(ORPCError);
    const orpc = err as ORPCError<string, unknown>;
    expect(orpc.code).toBe("BAD_REQUEST");
    expect(orpc.message).toContain(LEAF);
    expect(orpc.message).toContain(ROOT);
  });

  it("rootAncestorId walks a multi-level chain to the top-level tile", () => {
    seed(ROOT);
    seed(MID, ROOT);
    seed(LEAF, MID);
    expect(rootAncestorId(LEAF)).toBe(ROOT);
    expect(rootAncestorId(MID)).toBe(ROOT);
    expect(rootAncestorId(ROOT)).toBe(ROOT);
  });
});
