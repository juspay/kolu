/**
 * The wire's frame cap — juspay/kolu#2101 G9b/G9c(ii).
 *
 * These are the MEASUREMENT behind `frameLimit.ts`'s
 * `BETA-ASSUMPTION(beta.103)` marker. The marker claims two things about
 * Effect's ndjson serialization that only its behavior can settle: that
 * `maxBufferSize` is a real, honored option (not one we pass into the void),
 * and that busting it is a socket-closing 1009 rather than a per-call failure.
 * A bump re-stamps the marker, and re-stamping means re-running these.
 */

import { RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import {
  exceedsFrameLimit,
  FRAME_TOO_LARGE_CLOSE_CODE,
  isFrameTooLargeClose,
  RPC_MAX_FRAME_BYTES,
} from "./frameLimit";

/** Feed one oversized ndjson line into a parser built with `maxBufferSize` and
 *  report what came back out. */
function decodeOversized(maxBufferSize: number, chars: number): unknown {
  const parser = RpcSerialization.makeNdjson({ maxBufferSize }).makeUnsafe();
  // No trailing newline needed: the retained-buffer check fires on its own, and
  // that is the arm a slowly-arriving huge frame actually takes.
  return parser.decode(new TextEncoder().encode("x".repeat(chars)));
}

describe("maxBufferSize is a REAL option at this pin, not a no-op we pass", () => {
  it("throws MaxBufferSizeExceeded once a frame passes the configured cap", () => {
    // If Effect ever ignored the option, this would decode quietly (or fail on
    // the 16 MiB default instead) and every margin derived from our own
    // constant would be fiction.
    let caught: unknown;
    try {
      decodeOversized(1024, 4096);
    } catch (err) {
      caught = err;
    }
    expect((caught as { _tag?: string })?._tag).toBe("MaxBufferSizeExceeded");
    expect((caught as { maxBufferSize?: number })?.maxBufferSize).toBe(1024);
  });

  it("carries the incident's message verbatim, parameterised by OUR value", () => {
    // The production toast read "...exceeded the maximum size of 16777216".
    // That number is the cap in force, so this is how a future bump's changed
    // default would announce itself.
    let caught: unknown;
    try {
      decodeOversized(RPC_MAX_FRAME_BYTES, RPC_MAX_FRAME_BYTES + 1);
    } catch (err) {
      caught = err;
    }
    expect(String((caught as Error).message)).toBe(
      `RPC serialization buffer exceeded the maximum size of ${RPC_MAX_FRAME_BYTES}`,
    );
    expect(RPC_MAX_FRAME_BYTES).toBe(16777216);
  });

  it("accepts a frame EXACTLY at the cap — the check is strictly greater", () => {
    // The refusal predicate has to agree with Effect's on the boundary in both
    // directions: refusing at `>=` would drop frames the wire would carry.
    expect(() => decodeOversized(1024, 1024)).not.toThrow();
    expect(exceedsFrameLimit(RPC_MAX_FRAME_BYTES)).toBe(false);
    expect(exceedsFrameLimit(RPC_MAX_FRAME_BYTES + 1)).toBe(true);
  });
});

describe("1009 is classified distinctly and is NOT a terminal close", () => {
  it("names the frame-cap close code", () => {
    expect(FRAME_TOO_LARGE_CLOSE_CODE).toBe(1009);
    expect(isFrameTooLargeClose(1009)).toBe(true);
    expect(isFrameTooLargeClose(1000)).toBe(false);
    expect(isFrameTooLargeClose(4001)).toBe(false);
  });

  it("stays recoverable — a terminal close would strand the tab", () => {
    // G9c(ii): the server's close is unavoidable (it lives inside Effect's
    // decode path), so the contract we CAN hold is that the client treats 1009
    // as recoverable. `isTerminalClose` halts the retry schedule; if 1009 were
    // in that set, one oversized frame would leave the tab with no
    // subscriptions and no way back short of a reload. The app's vocabulary is
    // `isStaleProcessClose`, which answers false here — pinned in
    // surface-app's `connect.test.ts` alongside the other non-terminal codes.
    expect(isFrameTooLargeClose(1009)).toBe(true);
  });
});
