/**
 * PIN — the NARROW-LOUD boundary for the #1719 residual is NARROW: it survives the
 * TWO shapes the one residual wears (the raw stdio close AND the re-serve relay's
 * wrapped `SURFACE_RELAY_TRANSPORT_LOST` re-throw of it) and NOTHING else, and it is
 * LOUD (marked log).
 *
 * This is the honest carve-out in kolu-server's fatal `unhandledRejection` policy:
 * a re-served terminal stream's oRPC-upstream intermediate-promise float (which kolu
 * cannot own — see `reserveFloatBoundary.ts`) must not crash the server, but a
 * rejection of ANY other shape still must. RED-then-GREEN: without the boundary either
 * shape is fatal (index.ts `process.exit(1)`); with it, only those two survive, loud.
 */

import {
  deadTransportError,
  shouldNotRetryORPCError,
  SURFACE_RELAY_TRANSPORT_LOST,
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

  it("SURVIVES the relay-transport-lost float (SR5's wrapped re-throw) — loud, marked", () => {
    const { log, lines } = captureLog();
    const caught: unknown[] = [];
    // The re-serve relay catches the stdio close mid-stream and re-throws it wrapped
    // as `RelayTransportLostError` — an `ORPCError` with this retryable code. Post-#1822
    // the abandoned residual floats carrying THIS shape.
    const float = new ORPCError(SURFACE_RELAY_TRANSPORT_LOST, {
      message:
        'relayFailThroughStream: "terminalAttach" lost its upstream link mid-stream',
    });

    const survived = surviveReserveTransportFloat(float, log, (r) =>
      caught.push(r),
    );

    expect(survived).toBe(true); // the caller does NOT crash
    expect(caught).toEqual([float]); // observer fired
    expect(lines).toHaveLength(1); // LOUD: one marked line
    expect(lines[0]?.obj.marker).toBe(RESERVE_TRANSPORT_FLOAT_MARKER);
  });

  it("LIVE-PATH invariant: relay-lost is RETRYABLE (reconnect) — the boundary swallows ONLY the abandoned copy", () => {
    // The coordinator's banked invariant (ruling-flk-relay): the boundary must catch
    // ONLY the ABANDONED float, NEVER intercept SURFACE_RELAY_TRANSPORT_LOST on the
    // LIVE consumer path — where it is the RETRYABLE signal STREAM_RETRY re-subscribes
    // on (constraint 6 / reconnect). If this ever weakens, the boundary is eating
    // reconnect. Asserted at the CODE level: the SAME relay-lost code the boundary
    // survives-when-abandoned is classified RETRYABLE by the shared live-path retry
    // policy — so a live consumer re-subscribes on it, it is never swallowed there. The
    // boundary only ever sees the ABANDONED copy (via `unhandledRejection`, which fires
    // for orphaned rejections only); a live consumer handles the error first.
    const relayLost = new ORPCError(SURFACE_RELAY_TRANSPORT_LOST, {
      message: "middle-hop transport death — the live path must re-subscribe",
    });
    // LIVE path: STREAM_RETRY's `shouldRetry` returns TRUE → the consumer reconnects.
    // (`shouldNotRetryORPCError` is oRPC's `Value<>` union in the type system; it is
    // defined as a plain function, so cast to a callable to exercise the policy.)
    const shouldRetry = shouldNotRetryORPCError as (o: {
      error: unknown;
    }) => boolean;
    expect(shouldRetry({ error: relayLost })).toBe(true);
    // ABANDONED path: the boundary survives the same code (complementary, not conflicting).
    const { log } = captureLog();
    expect(surviveReserveTransportFloat(relayLost, log)).toBe(true);
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
