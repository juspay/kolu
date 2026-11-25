/**
 * ONE TERMINAL'S STANDING, ACROSS A REAL COLLECTION STREAM.
 *
 * A Conductor screen is gated on `fleetTerminalStanding` (`LivePane.tsx`,
 * `TerminalPeek.tsx`, through `peek/lookable.ts`), and a `loading` answer in
 * the middle of a live terminal's life is what a held gate exists to survive.
 * This pins the other half: that the index does not PRODUCE one. The rule
 * (`terminalStandingFrom`) is driven here over the framework's own
 * snapshot-then-deltas store — the same `useCollectionDeltas` the per-host
 * root folds its `terminals` collection with — plus a `roster` cell beside
 * it, through the two moves that rewrite the store:
 *
 *   - a KEY-SET CHANGE: another terminal arrives, and one leaves;
 *   - a DELTA TO AN EXISTING KEY: the watched terminal's own record moves.
 *
 * The assertion is on the whole SEQUENCE a reader saw, not on the value after
 * each move: while the roster holds the key, no `loading` may appear between
 * two `here`s. A single frame of it is a torn-down screen.
 */

import type { PadiRoster, PadiTerminal } from "@kolu/padi-client/surface";
import { collection } from "@kolu/surface";
import type { CollectionDeltasMsg } from "@kolu/surface/define";
import { useCollectionDeltas } from "@kolu/surface/solid";
import { Effect, Queue, Schema, Stream } from "effect";
import {
  createEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  runWithOwner,
} from "solid-js";
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

/** Two macrotask turns — enough for one pushed frame to cross the stream fiber,
 *  land in the store, and for the effects that observe it to flush. Never
 *  fewer: the assertion is not relaxed to fit the timing, the wait is made
 *  longer (`packages/surface/src/solid/deltasHarness.testlib.ts`). */
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

type Frame = CollectionDeltasMsg<string, PadiTerminal>;

/** The hand-driven source `useCollectionDeltas` subscribes to, with frames
 *  pushed before the consumer's fiber is scheduled buffered and replayed. */
function controllableStream(): {
  source: Stream.Stream<Frame, unknown>;
  push: (frame: Frame) => void;
} {
  let sink: ((frame: Frame) => void) | null = null;
  const buffered: Frame[] = [];
  const push = (frame: Frame): void => {
    if (sink) sink(frame);
    else buffered.push(frame);
  };
  const source = Stream.callback<Frame, unknown>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        sink = (frame) => {
          Queue.offerUnsafe(queue, frame);
        };
        for (const frame of buffered.splice(0)) sink(frame);
      }),
      () =>
        Effect.sync(() => {
          sink = null;
        }),
    ),
  );
  return { source, push };
}

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

/** Every standing a reader of ONE terminal saw, in order, with repeats of the
 *  same kind collapsed — the sequence the gate above it would have walked. */
async function watchStanding(
  body: (drive: {
    push: (frame: Frame) => void;
    setRoster: (roster: PadiRoster | undefined) => void;
  }) => Promise<void>,
): Promise<string[]> {
  const seen: string[] = [];
  // The host's `roster` cell: a plain signal here, read in the SAME compute as
  // the collection, which is how the per-host root reads the two.
  // `ownedWrite`: the test body that drives it runs inside the root below, so
  // every write it makes is, by construction, a write in an owned scope.
  const [rosterAt, writeRoster] = createSignal<PadiRoster | undefined>(
    undefined,
    { ownedWrite: true },
  );
  await createRoot(async (dispose) => {
    const { source, push } = controllableStream();
    const view = useCollectionDeltas(terminalRows, { source });
    const owner = getOwner();
    const setRoster = (next: PadiRoster | undefined) => {
      writeRoster(() => next);
      flush();
    };
    runWithOwner(owner, () => {
      createEffect(
        () =>
          terminalStandingFrom({
            id: ID,
            connected: true,
            warming: false,
            census: rosterAt(),
            record: () => view.byKey(ID)?.() as PadiTerminal | undefined,
          }),
        (standing: FleetTerminalStanding) => {
          if (seen[seen.length - 1] !== standing.kind) seen.push(standing.kind);
        },
      );
    });
    try {
      await body({ push, setRoster });
    } finally {
      dispose();
    }
  });
  return seen;
}

describe("a held terminal's standing, across the moves that rewrite the store", () => {
  it("never answers loading between two heres, through a key-set change and a delta to its own key", async () => {
    const seen = await watchStanding(async ({ push, setRoster }) => {
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
    const seen = await watchStanding(async ({ push, setRoster }) => {
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
});
