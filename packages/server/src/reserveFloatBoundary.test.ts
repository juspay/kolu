/**
 * PIN — the NARROW-LOUD boundary for the #1719 residual is NARROW: it survives the
 * ONE typed transport-closed float and NOTHING else, and it is LOUD (marked log).
 *
 * This is the honest carve-out in kolu-server's fatal `unhandledRejection` policy:
 * a re-served terminal stream's oRPC-upstream intermediate-promise float (which kolu
 * cannot own — see `reserveFloatBoundary.ts`) must not crash the server, but a
 * rejection of ANY other shape still must. RED-then-GREEN: without the boundary the
 * typed float is fatal (index.ts `process.exit(1)`); with it, only that one shape
 * survives, loud.
 */

import {
  deadTransportError,
  SURFACE_STDIO_TRANSPORT_CLOSED,
} from "@kolu/surface/client";
import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import {
  RESERVE_TRANSPORT_FLOAT_MARKER,
  surviveReserveTransportFloat,
} from "./reserveFloatBoundary.ts";

function captureLog() {
  const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  return {
    log: {
      error: (obj: Record<string, unknown>, msg: string) =>
        lines.push({ obj, msg }),
    },
    lines,
  };
}

describe("reserveFloatBoundary — narrow + loud", () => {
  it("SURVIVES the typed transport-closed float — loud, marked, onCaught fires", () => {
    const { log, lines } = captureLog();
    const caught: unknown[] = [];
    const float = deadTransportError(
      SURFACE_STDIO_TRANSPORT_CLOSED,
      "stdio transport closed (the peer process exited or its stream ended)",
    );

    const survived = surviveReserveTransportFloat(float, log, (r) =>
      caught.push(r),
    );

    expect(survived).toBe(true); // the caller does NOT crash
    expect(caught).toEqual([float]); // observer fired
    // LOUD: a marked ERROR line naming the float, greppable for enumeration.
    expect(lines).toHaveLength(1);
    expect(lines[0]?.obj.marker).toBe(RESERVE_TRANSPORT_FLOAT_MARKER);
    expect(lines[0]?.msg).toContain(RESERVE_TRANSPORT_FLOAT_MARKER);
    expect(lines[0]?.obj.err).toBe(float);
  });

  it("stays FATAL for a plain Error — never a blanket swallow", () => {
    const { log, lines } = captureLog();
    const survived = surviveReserveTransportFloat(
      new Error("some other background float"),
      log,
    );
    expect(survived).toBe(false); // the caller applies its fatal policy
    expect(lines).toHaveLength(0); // not logged as a survived float
  });

  it("stays FATAL for a DIFFERENT ORPCError code — the match is exact", () => {
    const { log, lines } = captureLog();
    const survived = surviveReserveTransportFloat(
      new ORPCError("SOME_OTHER_CODE", {
        message: "not the transport-closed shape",
      }),
      log,
    );
    expect(survived).toBe(false);
    expect(lines).toHaveLength(0);
  });

  it("stays FATAL for a non-Error rejection value", () => {
    const { log } = captureLog();
    expect(surviveReserveTransportFloat("just a string", log)).toBe(false);
    expect(surviveReserveTransportFloat(undefined, log)).toBe(false);
  });
});
