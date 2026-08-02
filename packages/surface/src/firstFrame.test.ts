import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  type CollectionItemFrame,
  firstFrameOfCollectionItem,
  firstFrameOrThrow,
  firstFrameOrUndefined,
} from "./firstFrame";

/** A stream that yields `items` then HOLDS OPEN (never ends) — models a
 *  held-open surface `get`/`keys` subscription. The losing race arms are
 *  interrupted by `Effect.raceAll`, so nothing has to abort them by hand. */
function holdOpen<T>(items: T[]): Stream.Stream<T> {
  return Stream.concat(Stream.fromArray(items), Stream.never);
}

const NEVER_EMPTY = "item opened empty (should not happen in these tests)";
// Generous default so a "present" racer always wins before the deadline in the
// keys-bearing tests; the keys-LESS tests pass a short deadline explicitly.
const LONG_DEADLINE = 60_000;

const read = <T>(
  ...args: Parameters<typeof firstFrameOfCollectionItem<T>>
): Promise<CollectionItemFrame<T>> =>
  Effect.runPromise(firstFrameOfCollectionItem<T>(...args));

describe("firstFrameOfCollectionItem", () => {
  it("a PRESENT key reads its value (item get wins the race)", async () => {
    const frame = await read<number>(
      holdOpen([42]),
      holdOpen([["k"]]),
      "k",
      NEVER_EMPTY,
      LONG_DEADLINE,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: true,
      value: 42,
    });
  });

  it("bounds a key that STAYS a member while its item stream says nothing", async () => {
    // The gap the two bounds left between them. Membership answers "is this key
    // gone?" and the deadline answers "have we waited long enough?" — and they
    // were wired as EITHER/OR, so a collection with a `keys` verb had no
    // deadline at all. A key that remains a member while its record stream goes
    // quiet (the mirror stalls, the producer wedges) then matches neither bound
    // and the read never resolves.
    //
    // That is the hang this function exists to make unspellable, reached by the
    // one door left open. Callers put this read inside a poll cell, where a
    // read that never resolves holds the in-flight latch and stops the cell
    // recomputing for the life of the process.
    const began = Date.now();
    const frame = await read<number>(
      // The item stream opens and then says nothing, ever.
      holdOpen<number>([]),
      // …while `keys` keeps insisting the key is a member.
      holdOpen([["k"]]),
      "k",
      NEVER_EMPTY,
      150,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: false,
      reason: "deadline",
    });
    // And it is the DEADLINE that ended it, not the test runner.
    expect(Date.now() - began).toBeLessThan(5_000);
  }, 10_000);

  it("an ABSENT key resolves not-present (keys omits it) instead of hanging", async () => {
    const frame = await read<number>(
      holdOpen<number>([]),
      holdOpen([[]]),
      "k",
      NEVER_EMPTY,
      LONG_DEADLINE,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: false,
      reason: "absent",
    });
  });

  it("a DELETE RACE (present, then removed) resolves not-present on the removal frame", async () => {
    const frame = await read<number>(
      holdOpen<number>([]),
      holdOpen([["k"], []]),
      "k",
      NEVER_EMPTY,
      LONG_DEADLINE,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: false,
      reason: "absent",
    });
  });

  it("a PRESENT item whose get opens EMPTY fails (a dropped link, never a silent absent)", async () => {
    await expect(
      read<number>(
        Stream.empty,
        holdOpen([["k"]]),
        "k",
        "boom: item opened empty",
        LONG_DEADLINE,
      ),
    ).rejects.toThrow("boom: item opened empty");
  });

  it("an item stream that FAILS surfaces the failure instead of racing on to the deadline", async () => {
    // `Effect.raceAll` ignores a failing arm and waits for a success, so a
    // genuinely broken read expressed as a failure would lose to the deadline
    // and be reported as a benign "not present". The failure rides the race as a
    // VALUE and is re-raised after it — caught-error-must-not-collapse-to-empty.
    await expect(
      read<number>(
        Stream.fail(new Error("boom: link dropped")),
        holdOpen([["k"]]),
        "k",
        NEVER_EMPTY,
        LONG_DEADLINE,
      ),
    ).rejects.toThrow("boom: link dropped");
  });

  // Keys-LESS collection (no `keys` verb → keys === null): there is no
  // membership signal, so an absent key is bounded by a DEADLINE instead of
  // hanging (#1687 audit — the silent fall-back to `firstFrameOrThrow(get)` that
  // reintroduced the hang is gone).
  it("keys-less + PRESENT key wins before the deadline", async () => {
    const frame = await read<number>(
      holdOpen([7]), // get yields immediately
      null, // no keys verb
      "k",
      NEVER_EMPTY,
      1_000,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: true,
      value: 7,
    });
  });

  it("keys-less + ABSENT key resolves not-present via the DEADLINE, never hangs", async () => {
    const start = Date.now();
    const frame = await read<number>(
      holdOpen<number>([]), // get holds open forever
      null, // no keys verb → deadline is the only bound
      "k",
      NEVER_EMPTY,
      40, // short deadline for the test
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: false,
      reason: "deadline",
    });
    // It actually waited for (roughly) the deadline, not longer — bounded.
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});

describe("firstFrameOrThrow / firstFrameOrUndefined take a Stream", () => {
  it("reads the snapshot frame and interrupts the rest", async () => {
    expect(await firstFrameOrThrow(holdOpen([1, 2, 3]), "empty")).toBe(1);
    expect(await firstFrameOrUndefined(holdOpen([1, 2, 3]))).toBe(1);
  });

  it("splits on the empty-stream POLICY — the only axis that varies", async () => {
    expect(await firstFrameOrUndefined(Stream.empty)).toBeUndefined();
    await expect(
      firstFrameOrThrow(Stream.empty, "boom: no snapshot"),
    ).rejects.toThrow("boom: no snapshot");
  });

  it("an aborted signal rejects the read rather than waiting out a wedged link", async () => {
    const ac = new AbortController();
    const pending = firstFrameOrThrow(Stream.never, "boom", ac.signal);
    ac.abort();
    await expect(pending).rejects.toThrow();
  });
});
