/**
 * ONE WORK'S READING — its lines keep their objects while nothing in them
 * moves, so the faces drawn from them are not rebuilt: a member that did not
 * move keeps its line; one whose terminal's record moved gets a new line and
 * the others keep theirs; a work with no members (a finished one) has none.
 */

import type { TerminalId } from "kolu-common/surface";
import type { WorkMember } from "kolu-work";
import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import type { WorkMemberRow } from "./workReadings";

const P = "11111111-1111-4111-8111-111111111111" as TerminalId;
const I = "22222222-2222-4222-8222-222222222222" as TerminalId;

const [records, setRecords] = createSignal<
  ReadonlyMap<string, FleetTerminalStanding>
>(new Map());

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: (host: string, id: string) =>
    records().get(`${host}/${id}`) ?? { kind: "gone" },
}));

import { readWorkFacts } from "./workFacts";

const here = (state: string): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    agent: null,
    foreground: { name: state },
    pr: { kind: "absent" },
  } as never,
});

const member = (role: WorkMember["role"]): WorkMember => ({
  work: "w",
  role,
  joinedAt: "2026-01-01T00:00:00Z",
  worktree: { kind: "unread" },
});

const PLANNER = member("planner");
const IMPLEMENTOR = member("implementor");

const rowsOf = (): WorkMemberRow[] => [
  { terminal: `local/${P}`, member: PLANNER },
  { terminal: `local/${I}`, member: IMPLEMENTOR },
];

describe("one work's reading", () => {
  it("keeps every line when nothing in them moved, and the list too", () => {
    setRecords(
      new Map([
        [`local/${P}`, here("a")],
        [`local/${I}`, here("b")],
      ]),
    );
    const [rows, setRows] = createSignal(rowsOf());
    const { facts, dispose } = createRoot((disposeRoot) => ({
      facts: readWorkFacts(rows),
      dispose: disposeRoot,
    }));
    flush();
    const before = facts.members();
    // The members map handed over again, with the same members in it.
    setRows(rowsOf());
    flush();
    expect(facts.members()).toBe(before);
    dispose();
  });

  it("gives a new line to the member whose record moved, and keeps the other", () => {
    const planner = here("a");
    setRecords(
      new Map([
        [`local/${P}`, planner],
        [`local/${I}`, here("b")],
      ]),
    );
    const { facts, dispose } = createRoot((disposeRoot) => ({
      facts: readWorkFacts(() => rowsOf()),
      dispose: disposeRoot,
    }));
    flush();
    const [p, i] = facts.members();
    setRecords(
      new Map([
        [`local/${P}`, planner],
        [`local/${I}`, here("c")],
      ]),
    );
    flush();
    const [p2, i2] = facts.members();
    expect(p2).toBe(p);
    expect(i2).not.toBe(i);
    expect(i2?.standing).toEqual(here("c"));
    dispose();
  });

  it("has no lines for a work with no members", () => {
    createRoot((dispose) => {
      const facts = readWorkFacts(() => []);
      expect(facts.members()).toEqual([]);
      expect(facts.livePr()).toBeNull();
      dispose();
    });
  });
});
