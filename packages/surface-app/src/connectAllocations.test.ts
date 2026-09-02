/**
 * The connect seams' allocation tracker — ONE list, and the exits that read it.
 *
 * The module's whole claim is that "what a connect seam allocated, and how it
 * gives it back" has one home, and that its exits differ in exactly one way:
 * what each does with a release that ITSELF throws. So that is what this file
 * pins — three exits over one list, in reverse allocation order.
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

  it("two exits in flight at once share ONE walk", async () => {
    // The window that made this necessary: a `dispose()` landing while
    // `connectSurfaces`' `redial` is inside its `supersede()` used to start a
    // SECOND concurrent walk over the same array — every resource disposed
    // twice, interleaved, and every failure reported twice by two different
    // exits. Per-resource idempotence was never what made that safe.
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("first", resource(log, "first"));
    allocations.track("second", resource(log, "second"));

    await Promise.all([allocations.release(), allocations.supersede()]);
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

  it("`supersede` LOGS a failed release and RESOLVES — the caller has a live replacement to hand back", async () => {
    // The third exit, and the reason it lives here rather than as a try/catch at
    // `redial`'s call site: the log-vs-raise decision is this module's one
    // question, and the failing resource is named in the LINE rather than one
    // `AggregateError` deeper.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("watchdog", resource(log, "watchdog", new Error("nope")));
    allocations.track("client a", resource(log, "client a"));

    await expect(allocations.supersede()).resolves.toBeUndefined();
    expect(log).toEqual(["client a", "watchdog"]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toMatch(
      /releasing the watchdog FAILED/,
    );
  });

  it("`supersede` says nothing when every release succeeded", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const allocations = trackConnectAllocations("seam");
    allocations.track("client a", resource([], "client a"));
    await allocations.supersede();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("trackConnectAllocations — one verdict per teardown", () => {
  it("a `release` after a `supersede` does not re-raise what supersede already logged", async () => {
    // The shape that made this necessary: `redial` takes the `supersede` exit
    // (log and continue, because it has a live replacement to hand back), and the
    // caller may then `dispose()` the stale accessor it still holds — which the
    // superseded connection's own readout/health gating invites it to hold. Both
    // exits share one memoized walk, so `release` re-applied its own reject
    // policy to failures `supersede` had already answered for, throwing out of a
    // call the caller has every reason to believe is a no-op.
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("wire", resource(log, "wire", new Error("nope")));

    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((msg: unknown) => {
        errors.push(String(msg));
      });
    await allocations.supersede();
    spy.mockRestore();
    expect(errors.join(" ")).toMatch(/releasing the wire FAILED/);

    // The verdict is spent. A later `dispose()` is the no-op it claims to be.
    await expect(allocations.release()).resolves.toBeUndefined();
  });

  it("the FIRST exit still owns the verdict when it is `release`", async () => {
    const log: string[] = [];
    const allocations = trackConnectAllocations("seam");
    allocations.track("wire", resource(log, "wire", new Error("nope")));
    await expect(allocations.release()).rejects.toThrow(
      /1 resource\(s\) failed to release/,
    );
  });
});
