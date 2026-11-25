/**
 * ONE WORK'S READING — its lines keep their objects while nothing in them
 * moves, so the faces drawn from them are not rebuilt: a member that did not
 * move keeps its line; one whose terminal's record moved gets a new line and
 * the others keep theirs; a work with no members (a finished one) has none.
 *
 * The last case drives the REAL collection store underneath: a line is kept by
 * the IDENTITY of its terminal's record, and a record the store merged a frame
 * into keeps that identity — so the kept line must still read the new values,
 * or every face drawn from it is stale.
 */

import { collection } from "@kolu/surface";
import { driveDeltas, settle } from "@kolu/surface/solid/testlib";
import { Schema } from "effect";
import type { TerminalId } from "kolu-common/surface";
import type { WorkMember } from "kolu-work";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import type { MemberLine } from "./workFacts";
import type { WorkMemberRow } from "./workReadings";

const P = "11111111-1111-4111-8111-111111111111" as TerminalId;
const I = "22222222-2222-4222-8222-222222222222" as TerminalId;

const [records, setRecords] = createSignal<
  ReadonlyMap<string, FleetTerminalStanding>
>(new Map());

/** The store-backed answer, when a test has one: the seam `readWorkFacts` reads
 *  a terminal's standing through, answered from a real `deltas` collection view
 *  instead of a hand-written map. */
let fromStore:
  | ((host: string, id: string) => FleetTerminalStanding | undefined)
  | undefined;

// The seam is a module-level mock and the store-backed answer is preferred over
// the hand-written map, so it is cleared after the one test that installs it: a
// `view` from a disposed root would otherwise answer every later test's
// standing reads in file order.
afterEach(() => {
  fromStore = undefined;
});

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: (host: string, id: string) =>
    fromStore?.(host, id) ?? records().get(`${host}/${id}`) ?? { kind: "gone" },
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

/** The record shape this file's standings carry, as a collection entry: the
 *  fields `here("…")` spells, so a store-driven line and a hand-written one are
 *  the same reading. */
interface Row {
  readonly state: string;
  readonly agent: null;
  readonly foreground: { readonly name: string };
  readonly pr: { readonly kind: string };
}

const row = (state: string): Row => ({
  state: "active",
  agent: null,
  foreground: { name: state },
  pr: { kind: "absent" },
});

/** The collection the store-driven case drives. Only `name` is read at runtime;
 *  the schemas type the frames at the call site. */
const terminalRows = collection({
  name: "terminals",
  keySchema: Schema.String,
  schema: Schema.Any,
});

const member = (role: WorkMember["role"]): WorkMember => ({
  work: "w",
  role,
  joinedAt: "2026-01-01T00:00:00Z",
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
      dispose();
    });
  });

  it("keeps the line a merged frame did not re-identify — and that line reads the NEW values", async () => {
    // The real store, the real rule: `readWorkFacts` holds a line while its
    // terminal's record is the same object (`sameStanding`'s `a.meta === b.meta`),
    // and the collection store MERGES a frame into the record standing at that key
    // rather than replacing it — so the record IS the same object across a
    // value-only frame. That is only safe because the kept line's record is the
    // store's LIVE value: a face reading a field off it is woken by that field and
    // reads what the frame carried. A store that handed over frozen copies, or a
    // line that copied fields out at build time, would leave this face reading the
    // previous frame forever.
    await driveDeltas<string, Row>(
      terminalRows,
      async ({ view, push, observe }) => {
        push({
          kind: "snapshot",
          entries: [
            [P, row("a")],
            [I, row("b")],
          ],
        });
        await settle();
        fromStore = (_host, id) => {
          const record = view.byKey(id)?.();
          return record === undefined
            ? { kind: "gone" }
            : { kind: "here", meta: record as never };
        };

        let members: () => ReadonlyArray<MemberLine> = () => [];
        let runs = 0;
        let seen: string | undefined;
        observe(() => {
          members = readWorkFacts(() => rowsOf()).members;
          createEffect(
            () => {
              const line = members()[0];
              return line?.standing?.kind === "here"
                ? (line.standing.meta as unknown as Row).foreground.name
                : undefined;
            },
            (name) => {
              runs++;
              seen = name;
            },
          );
        });
        await settle();
        expect(runs).toBe(1);
        expect(seen).toBe("a");
        const before = members()[0];

        // A VALUE-ONLY delta on the planner's terminal: its foreground moved and
        // nothing else did, so the key set is untouched and the record keeps its
        // identity.
        push({ kind: "delta", upserts: [[P, row("c")]], removes: [] });
        await settle();
        expect(seen).toBe("c");
        expect(runs).toBe(2);
        // The line was KEPT — nothing drawn from the list was rebuilt — and it is
        // not stale: the two facts are the same fact.
        expect(members()[0]).toBe(before);
        expect(members()).toHaveLength(2);
      },
    );
  });
});
