/**
 * The connect seams' allocation tracker — ONE list, and the exits that read it.
 *
 * The module's whole claim is that "what a connect seam allocated, and how it
 * gives it back" has one home, and that its exits differ in exactly one way:
 * what each does with a release that ITSELF throws. So that is what this file
 * pins — both exits over one list, in reverse allocation order.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { trackConnectAllocations } from "./connectAllocations";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A tracked resource that records its release, and can refuse it. */
function resource(
  log: string[],
  what: string,
  fail?: Error,
): { dispose: () => void } {
  return {
    dispose: () => {
      log.push(what);
      if (fail) throw fail;
    },
  };
}

describe("trackConnectAllocations", () => {
  it("releases in REVERSE allocation order, and releases each resource EXACTLY once", async () => {
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("first", resource(log, "first"));
    allocations.track("second", resource(log, "second"));

    await allocations.release();
    expect(log).toEqual(["second", "first"]);
    // Idempotent, and idempotent by the TRACKER's own rule rather than by every
    // resource independently being safe to dispose twice: the walk is memoized,
    // so a second exit gets the same walk and the same verdict.
    await allocations.release();
    expect(log).toEqual(["second", "first"]);
  });

  it("two releases in flight at once share ONE walk", async () => {
    // The window that made this necessary: two teardowns racing used to start a
    // SECOND concurrent walk over the same array — every resource disposed
    // twice, interleaved, and every failure reported twice. Per-resource
    // idempotence was never what made that safe.
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("first", resource(log, "first"));
    allocations.track("second", resource(log, "second"));

    await Promise.all([allocations.release(), allocations.release()]);
    expect(log).toEqual(["second", "first"]);
  });

  it("`release` REJECTS over a failed release — a `dispose()` that resolved would claim a teardown that did not happen", async () => {
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("watchdog", resource(log, "watchdog", new Error("nope")));
    allocations.track("client a", resource(log, "client a"));

    await expect(allocations.release()).rejects.toThrow(
      /1 resource\(s\) failed to release/,
    );
    // Every release was still ATTEMPTED: one failure must not strand the
    // resources behind it.
    expect(log).toEqual(["client a", "watchdog"]);
  });

  it("`unwind` LOGS a failed release and rethrows the CONSTRUCTION error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("watchdog", resource(log, "watchdog", new Error("nope")));

    const cause = new Error("the builder threw");
    await expect(allocations.unwind(cause)).rejects.toBe(cause);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toMatch(
      /releasing the watchdog FAILED/,
    );
  });
});

describe("trackConnectAllocations — one verdict per teardown", () => {
  it("a SECOND `release` does not re-raise what the first already answered for", async () => {
    // A page-lifetime connection may be disposed twice — an `onCleanup` and an
    // explicit teardown, say. Both calls share one memoized walk, so without a
    // spent verdict the second re-applied `release`'s own reject policy to
    // failures the first had already raised, throwing out of a call the caller
    // has every reason to believe is a no-op.
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("wire", resource(log, "wire", new Error("nope")));

    await expect(allocations.release()).rejects.toThrow(
      /1 resource\(s\) failed to release/,
    );
    expect(log).toEqual(["wire"]);

    // The verdict is spent. A later `dispose()` is the no-op it claims to be.
    await expect(allocations.release()).resolves.toBeUndefined();
  });
});
