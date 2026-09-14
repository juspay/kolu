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

import { LOCAL_LOCATION, TerminalNotFound } from "@kolu/padi-client/surface";
import type { TerminalId, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ActiveTerminalProcess,
  registerTerminal,
  requireMutableTerminal,
  requireTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;

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
  it("REJECTS a mutation targeting a PARKED record (the declared TerminalNotFound)", () => {
    seedParked();
    const err = caught(() => requireMutableTerminal(ID));
    expect(err).toBeInstanceOf(TerminalNotFound);
    expect((err as TerminalNotFound)._tag).toBe("TerminalNotFound");
    expect((err as TerminalNotFound).id).toBe(ID);
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

  it("REJECTS an absent id (the declared TerminalNotFound)", () => {
    const err = caught(() => requireMutableTerminal(ID));
    expect(err).toBeInstanceOf(TerminalNotFound);
    expect((err as TerminalNotFound)._tag).toBe("TerminalNotFound");
    expect((err as TerminalNotFound).id).toBe(ID);
  });
});
