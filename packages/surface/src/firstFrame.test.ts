import { describe, expect, it } from "vitest";
import {
  type CollectionItemFrame,
  firstFrameOfCollectionItem,
} from "./firstFrame";

/** An async iterable that yields `items` then HOLDS OPEN (awaits forever, or
 *  until its signal aborts) — models a held-open surface `get`/`keys` stream. */
function holdOpen<T>(items: T[], signal?: AbortSignal): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
      await new Promise<void>((resolve) => {
        if (signal)
          signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  };
}

/** An async iterable that yields `items` then ENDS (empty-completes). */
async function* ending<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

const NEVER_EMPTY = "item opened empty (should not happen in these tests)";
const NEVER_NULL = "item resolved no source (should not happen in these tests)";
// Generous default so a "present" racer always wins before the deadline in the
// keys-bearing tests; the keys-LESS tests pass a short deadline explicitly.
const LONG_DEADLINE = 60_000;

describe("firstFrameOfCollectionItem", () => {
  it("a PRESENT key reads its value (item get wins the race)", async () => {
    const frame = await firstFrameOfCollectionItem<number>(
      (sig) => Promise.resolve(holdOpen([42], sig)),
      (sig) => Promise.resolve(holdOpen([["k"]], sig)),
      "k",
      NEVER_EMPTY,
      NEVER_NULL,
      LONG_DEADLINE,
      undefined,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: true,
      value: 42,
    });
  });

  it("an ABSENT key resolves not-present (keys omits it) instead of hanging", async () => {
    const frame = await firstFrameOfCollectionItem<number>(
      (sig) => Promise.resolve(holdOpen<number>([], sig)),
      (sig) => Promise.resolve(holdOpen([[]], sig)),
      "k",
      NEVER_EMPTY,
      NEVER_NULL,
      LONG_DEADLINE,
      undefined,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: false,
      reason: "absent",
    });
  });

  it("a DELETE RACE (present, then removed) resolves not-present on the removal frame", async () => {
    const frame = await firstFrameOfCollectionItem<number>(
      (sig) => Promise.resolve(holdOpen<number>([], sig)),
      (sig) => Promise.resolve(holdOpen([["k"], []], sig)),
      "k",
      NEVER_EMPTY,
      NEVER_NULL,
      LONG_DEADLINE,
      undefined,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: false,
      reason: "absent",
    });
  });

  it("a PRESENT item whose get opens EMPTY throws (a dropped link, never a silent absent)", async () => {
    await expect(
      firstFrameOfCollectionItem<number>(
        () => Promise.resolve(ending<number>([])),
        (sig) => Promise.resolve(holdOpen([["k"]], sig)),
        "k",
        "boom: item opened empty",
        NEVER_NULL,
        LONG_DEADLINE,
        undefined,
      ),
    ).rejects.toThrow("boom: item opened empty");
  });

  it("a null item source throws the DISTINCT no-source message (not the empty message)", async () => {
    await expect(
      firstFrameOfCollectionItem<number>(
        () => Promise.resolve(null),
        (sig) => Promise.resolve(holdOpen([["k"]], sig)),
        "k",
        "boom: item opened empty",
        "boom: no source",
        LONG_DEADLINE,
        undefined,
      ),
    ).rejects.toThrow("boom: no source");
  });

  // Keys-LESS collection (no `keys` verb → openKeys === null): there is no
  // membership signal, so an absent key is bounded by a DEADLINE instead of
  // hanging (#1687 audit — the silent fall-back to `firstFrameOrThrow(get)` that
  // reintroduced the hang is gone).
  it("keys-less + PRESENT key wins before the deadline", async () => {
    const frame = await firstFrameOfCollectionItem<number>(
      (sig) => Promise.resolve(holdOpen([7], sig)), // get yields immediately
      null, // no keys verb
      "k",
      NEVER_EMPTY,
      NEVER_NULL,
      1_000,
      undefined,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: true,
      value: 7,
    });
  });

  it("keys-less + ABSENT key resolves not-present via the DEADLINE, never hangs", async () => {
    const start = Date.now();
    const frame = await firstFrameOfCollectionItem<number>(
      (sig) => Promise.resolve(holdOpen<number>([], sig)), // get holds open forever
      null, // no keys verb → deadline is the only bound
      "k",
      NEVER_EMPTY,
      NEVER_NULL,
      40, // short deadline for the test
      undefined,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: false,
      reason: "deadline",
    });
    // It actually waited for (roughly) the deadline, not longer — bounded.
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});
