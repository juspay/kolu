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

describe("firstFrameOfCollectionItem", () => {
  it("a PRESENT key reads its value (item get wins the race)", async () => {
    const frame = await firstFrameOfCollectionItem<number>(
      (sig) => Promise.resolve(holdOpen([42], sig)), // get yields the value, holds open
      (sig) => Promise.resolve(holdOpen([["k"]], sig)), // keys says present
      "k",
      NEVER_EMPTY,
      undefined,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({
      present: true,
      value: 42,
    });
  });

  it("an ABSENT key resolves not-present (keys omits it) instead of hanging", async () => {
    const frame = await firstFrameOfCollectionItem<number>(
      (sig) => Promise.resolve(holdOpen<number>([], sig)), // get holds open, never yields
      (sig) => Promise.resolve(holdOpen([[]], sig)), // keys snapshot omits the key
      "k",
      NEVER_EMPTY,
      undefined,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({ present: false });
  });

  it("a DELETE RACE (present, then removed) resolves not-present on the removal frame", async () => {
    const frame = await firstFrameOfCollectionItem<number>(
      (sig) => Promise.resolve(holdOpen<number>([], sig)), // item get for the removed key holds open
      // keys reports the key present, THEN a later frame omits it (the removal).
      (sig) => Promise.resolve(holdOpen([["k"], []], sig)),
      "k",
      NEVER_EMPTY,
      undefined,
    );
    expect(frame).toEqual<CollectionItemFrame<number>>({ present: false });
  });

  it("a PRESENT item whose get opens EMPTY throws (a dropped link, never a silent absent)", async () => {
    await expect(
      firstFrameOfCollectionItem<number>(
        () => Promise.resolve(ending<number>([])), // get ends empty = link drop
        (sig) => Promise.resolve(holdOpen([["k"]], sig)), // keys says present forever
        "k",
        "boom: item opened empty",
        undefined,
      ),
    ).rejects.toThrow("boom: item opened empty");
  });

  it("a null item source throws the empty message (link/protocol failure, not absent)", async () => {
    await expect(
      firstFrameOfCollectionItem<number>(
        () => Promise.resolve(null),
        (sig) => Promise.resolve(holdOpen([["k"]], sig)),
        "k",
        "boom: no source",
        undefined,
      ),
    ).rejects.toThrow("boom: no source");
  });
});
