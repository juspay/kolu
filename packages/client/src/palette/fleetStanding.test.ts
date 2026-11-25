/**
 * ONE TERMINAL'S STANDING, ACROSS A REAL COLLECTION STREAM.
 *
 * A Conductor screen is gated on `fleetTerminalStanding` (`LivePane.tsx`,
 * `TerminalPeek.tsx`, through `peek/lookable.ts`), and a `loading` answer in
 * the middle of a live terminal's life is what a held gate exists to survive.
 * This pins the other half: that the index does not PRODUCE one. The rule
 * (`terminalStandingFrom`) is driven here over the framework's own
 * snapshot-then-deltas store — the same `useCollectionDeltas` the per-host
 * root folds its `terminals` collection with — plus a `roster` cell and a
 * host-entry state beside it, through the moves that rewrite the store:
 *
 *   - a KEY-SET CHANGE: another terminal arrives, and one leaves;
 *   - a DELTA TO AN EXISTING KEY: the watched terminal's own record moves;
 *   - a CONNECTION PUBLISH that decides nothing: the entry's state moves while
 *     it stays connected (a phase, a log tail, an elapsed count).
 *
 * The assertion is on the whole SEQUENCE a reader saw, not on the value after
 * each move: while the roster holds the key, no `loading` may appear between
 * two `here`s. A single frame of it is a torn-down screen.
 *
 * The store, the source and the `settle` are the framework's own
 * (`@kolu/surface/solid/testlib`), not a copy of them: a timing fix there is a
 * timing fix here.
 */

import type { PadiRoster, PadiTerminal } from "@kolu/padi-client/surface";
import { collection } from "@kolu/surface";
import type { CollectionDeltasMsg } from "@kolu/surface/define";
import { driveDeltas, settle } from "@kolu/surface/solid/testlib";
import { Schema } from "effect";
import { createEffect, createMemo, createSignal, flush } from "solid-js";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  type FleetTerminalStanding,
  terminalStandingFrom,
} from "./fleetTerminals";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const OTHER = "22222222-2222-4222-8222-222222222222" as TerminalId;

/** The collection the per-host root folds. Only `name` is read at runtime; the
 *  schemas type the frames at the call site. */
const terminalRows = collection({
  name: "terminals",
  keySchema: Schema.String,
  schema: Schema.Any,
});

type Frame = CollectionDeltasMsg<string, PadiTerminal>;

/** The host entry's state, as this test needs to read it: a `kind` the standing
 *  branches on, and a `tick` standing in for everything that moves inside a
 *  connected entry's state without changing the answer — phase, log tail,
 *  elapsed. */
type EntryState = { kind: "connected" | "warming" | "offline"; tick: number };

const active = (at: string): PadiTerminal =>
  ({
    state: "active",
    title: at,
    foreground: null,
    agent: null,
  }) as unknown as PadiTerminal;

const established = (...ids: TerminalId[]): PadiRoster => ({
  kind: "established",
  at: 0,
  ids,
});

type Drive = {
  push: (frame: Frame) => void;
  setRoster: (roster: PadiRoster | undefined) => void;
  /** Publish a new host-entry state, as the padi map does. */
  setEntry: (state: EntryState) => void;
  /** Every standing the reader saw, in order, repeats of a kind collapsed. */
  readonly seen: string[];
  /** The standing objects the reader saw, uncollapsed — identity included. */
  readonly answers: FleetTerminalStanding[];
};

/** Watch ONE terminal through the real store, with the roster and the entry
 *  state read the way the per-host root reads them. */
async function watchStanding(
  body: (drive: Drive) => Promise<void>,
): Promise<Drive> {
  const seen: string[] = [];
  const answers: FleetTerminalStanding[] = [];
  // The host's `roster` cell and the entry's state: plain signals here, read in
  // the SAME compute as the collection, which is how the per-host root reads
  // them. `ownedWrite`: the test body that drives them runs inside the harness's
  // root, so every write it makes is, by construction, a write in an owned
  // scope.
  const [rosterAt, writeRoster] = createSignal<PadiRoster | undefined>(
    undefined,
    { ownedWrite: true },
  );
  const [entryAt, writeEntry] = createSignal<EntryState>(
    { kind: "connected", tick: 0 },
    { ownedWrite: true },
  );
  let drive: Drive | undefined;
  await driveDeltas<string, PadiTerminal>(terminalRows, async (harness) => {
    const setRoster = (next: PadiRoster | undefined) => {
      writeRoster(() => next);
      flush();
    };
    const setEntry = (next: EntryState) => {
      writeEntry(() => next);
      flush();
    };
    harness.observe(() => {
      // `connected` is a memo, exactly as the per-host root derives it: a state
      // publish that does not change the kind is not a change here.
      const connected = createMemo(() => entryAt().kind === "connected");
      createEffect(
        () =>
          terminalStandingFrom({
            id: ID,
            connected: connected(),
            warming: () => entryAt().kind === "warming",
            census: () => rosterAt(),
            record: () =>
              harness.view.byKey(ID)?.() as PadiTerminal | undefined,
          }),
        (standing: FleetTerminalStanding) => {
          answers.push(standing);
          if (seen[seen.length - 1] !== standing.kind) seen.push(standing.kind);
        },
      );
    });
    drive = {
      push: harness.push,
      setRoster,
      setEntry,
      seen,
      answers,
    };
    await body(drive);
  });
  return drive as Drive;
}

describe("a held terminal's standing, across the moves that rewrite the store", () => {
  it("never answers loading between two heres, through a key-set change and a delta to its own key", async () => {
    const { seen } = await watchStanding(async ({ push, setRoster }) => {
      setRoster(established(ID));
      push({
        kind: "snapshot",
        entries: [[ID, active("one")]],
      });
      await settle();

      // A KEY-SET CHANGE: another terminal arrives, and the roster grows with
      // it. The watched key's record did not move.
      setRoster(established(ID, OTHER));
      push({ kind: "delta", upserts: [[OTHER, active("two")]], removes: [] });
      await settle();

      // THE OTHER ONE LEAVES — the key set shrinks under the watched key.
      setRoster(established(ID));
      push({ kind: "delta", upserts: [], removes: [OTHER] });
      await settle();

      // A DELTA TO THE EXISTING KEY: this terminal's own record moves. The
      // store rewrites the entry in place; a reader must see `here` throughout.
      push({ kind: "delta", upserts: [[ID, active("moved")]], removes: [] });
      await settle();

      // A RECONNECT SNAPSHOT, the whole set again — the retry fence's shape.
      push({
        kind: "snapshot",
        entries: [[ID, active("moved")]],
      });
      await settle();
    });

    expect(seen).toEqual(["loading", "here"]);
  });

  it("says gone, not loading, once the roster answers that the key has left", async () => {
    const { seen } = await watchStanding(async ({ push, setRoster }) => {
      setRoster(established(ID));
      push({ kind: "snapshot", entries: [[ID, active("one")]] });
      await settle();

      // THE ROSTER FOLDS FIRST, then the record leaves: an answer, in both
      // orders, and never a silence.
      setRoster(established());
      push({ kind: "delta", upserts: [], removes: [ID] });
      await settle();
    });

    expect(seen).toEqual(["loading", "here", "gone"]);
  });

  it("does not re-answer when the connected entry publishes something the standing does not decide on", async () => {
    const { answers } = await watchStanding(
      async ({ push, setRoster, setEntry }) => {
        setRoster(established(ID));
        push({ kind: "snapshot", entries: [[ID, active("one")]] });
        await settle();

        // A CONNECTED ENTRY PUBLISHES: phase, log tail, elapsed. It stays
        // connected, so the standing's answer cannot move — and `warming` is
        // the branch this entry is NOT on, so it is not a dependency of it.
        for (let tick = 1; tick <= 3; tick += 1) {
          setEntry({ kind: "connected", tick });
          await settle();
        }
      },
    );

    const here = answers.filter((a) => a.kind === "here");
    expect(here).toHaveLength(1);
    // The one object, still: a gate above this reads `meta` by identity.
    expect(answers[answers.length - 1]).toBe(here[0]);
  });
});
