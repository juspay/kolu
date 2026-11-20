import {
  LOCAL_LOCATION,
  TerminalNotActive,
  TerminalNotFound,
} from "@kolu/padi-client/surface";
import type { TerminalId, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ActiveTerminalProcess,
  registerTerminal,
  requireActiveTerminal,
  requireMutableTerminal,
  requireTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;

const snapshot = (): TerminalSnapshot => ({
  cwd: "/w",
  git: { kind: "none" },
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
});

function seedActive(): void {
  registerTerminal(ID, {
    info: { id: ID, pid: 1 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      promptedAt: null,
    },
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
      promptedAt: null,
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
      promptedAt: null,
      parkedAt: 1,
    },
    snapshot: snapshot(),
  });
}

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

describe("requireActiveTerminal — absent is not the same as asleep", () => {
  it("REJECTS an ABSENT id with TerminalNotFound", () => {
    const err = caught(() => requireActiveTerminal(ID));
    expect(err).toBeInstanceOf(TerminalNotFound);
    expect((err as TerminalNotFound)._tag).toBe("TerminalNotFound");
    expect((err as TerminalNotFound).id).toBe(ID);
  });

  it("REJECTS a SLEEPING id with TerminalNotActive, carrying its state", () => {
    seedSleeping();
    const err = caught(() => requireActiveTerminal(ID));
    expect(err).toBeInstanceOf(TerminalNotActive);
    expect((err as TerminalNotActive)._tag).toBe("TerminalNotActive");
    expect((err as TerminalNotActive).id).toBe(ID);
    expect((err as TerminalNotActive).state).toBe("sleeping");
    expect((err as TerminalNotActive).message).toContain("is asleep");
  });

  it("REJECTS a PARKED id with TerminalNotActive, carrying its state", () => {
    seedParked();
    const err = caught(() => requireActiveTerminal(ID));
    expect(err).toBeInstanceOf(TerminalNotActive);
    expect((err as TerminalNotActive).state).toBe("parked");
    expect((err as TerminalNotActive).id).toBe(ID);
  });

  it("ACCEPTS a live ACTIVE record", () => {
    seedActive();
    expect(requireActiveTerminal(ID).meta.state).toBe("active");
  });
});
