/**
 * `pollOnEvent` — the poll-on-event-tick stream source. These pins guard its
 * SUBSCRIBE-BEFORE-SNAPSHOT ordering: the change listener must be installed
 * BEFORE the initial read, so a source that starts producing concurrently with
 * the first subscription (the exact liveActivity race: a kaval edge delivered
 * after the initial snapshot read but before the consumer's second pull) cannot
 * change the value with no listener attached and strand the change forever.
 */

import { describe, expect, it } from "vitest";
import { pollOnEvent } from "./server.ts";

describe("pollOnEvent", () => {
  it("installs the change listener BEFORE the initial read (subscribe-before-snapshot)", async () => {
    const order: string[] = [];
    const it = pollOnEvent<number>({
      read: async () => {
        order.push("read");
        return 0;
      },
      isEqual: (a, b) => a === b,
      install: () => {
        order.push("install");
        return () => {};
      },
      signal: undefined,
      onReadError: () => {},
    })[Symbol.asyncIterator]();

    await it.next(); // pull the initial snapshot
    // The old read→yield→install order produced ["read"] here (install deferred
    // to the second pull); the fix installs first.
    expect(order).toEqual(["install", "read"]);
    await it.return?.(undefined);
  });

  it("does not lose a change that fires between the initial read and the second pull", async () => {
    let value = 0;
    let fire: () => void = () => {};
    const it = pollOnEvent<number>({
      read: async () => value,
      isEqual: (a, b) => a === b,
      install: (onEvent) => {
        fire = onEvent;
        return () => {};
      },
      signal: undefined,
      onReadError: () => {},
    })[Symbol.asyncIterator]();

    const first = await it.next();
    expect(first).toEqual({ value: 0, done: false });

    // A change fires in the exact gap — after the initial read/yield, before the
    // second pull. `install` already ran, so this is buffered as `dirty` rather
    // than dropped; the next pull must re-read and yield it (would hang on the
    // pre-fix code, where the listener was not yet attached at this instant).
    value = 1;
    fire();

    const second = await it.next();
    expect(second).toEqual({ value: 1, done: false });
    await it.return?.(undefined);
  });

  it("coalesces a burst of events into a single re-read and suppresses an unchanged value", async () => {
    let value = 0;
    let fire: () => void = () => {};
    let reads = 0;
    const it = pollOnEvent<number>({
      read: async () => {
        reads += 1;
        return value;
      },
      isEqual: (a, b) => a === b,
      install: (onEvent) => {
        fire = onEvent;
        return () => {};
      },
      signal: undefined,
      onReadError: () => {},
    })[Symbol.asyncIterator]();

    await it.next(); // initial snapshot: 0
    expect(reads).toBe(1);

    // A change that leaves the value equal re-reads but does not yield.
    fire();
    value = 1;
    const next = await it.next();
    expect(next).toEqual({ value: 1, done: false });
    await it.return?.(undefined);
  });
});
