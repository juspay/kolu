/**
 * `padiFailureOf` — the `serveHostMap` `failureOf` classifier pulled out of the
 * composition root so its contract is a tested pure function (not buried in
 * `index.ts`). It is the seam where a padi arm's arm-local
 * {@link PadiEntryFailedDetail} plus the transport DOWN state become the map's
 * schema-valid {@link PadiEntryFailure} — and, crucially, where a LOCAL arm's
 * terminal give-up (whose `entryFailedDetail()` is ALWAYS null) is floored to
 * `link-failed` instead of yielding `null` into `serveHostMap`'s fail-loud
 * `UnclassifiedHostFailureError` (the F1 regression).
 */

import type { DownSessionState } from "@kolu/surface-remote";
import { describe, expect, it } from "vitest";
import { padiFailureOf } from "./padiSession.ts";

/** A minimal terminal-`failed` DOWN state (the give-up arm: `cause` is the
 *  `"remote"` literal by `SessionState`'s own type). */
const failed = (error: string): DownSessionState => ({
  phase: "failed",
  error,
  cause: "remote",
  log: [],
  sinceMs: 0,
});

/** A minimal transient `disconnected` DOWN state (still retrying). */
const disconnected = (
  error: string,
  cause: "network" | "remote" = "network",
): DownSessionState => ({
  phase: "disconnected",
  error,
  cause,
  log: [],
  sinceMs: 0,
});

describe("padiFailureOf — detail + transport state → published PadiEntryFailure", () => {
  it("pairs a finer arm-local detail with the transport reason", () => {
    expect(
      padiFailureOf({ cause: "unconverged" }, failed("drain never took")),
    ).toEqual({ cause: "unconverged", reason: "drain never took" });
  });

  it("carries the typed skew pair through the contract-skew arm", () => {
    expect(
      padiFailureOf(
        { cause: "contract-skew-refused", running: "9.0", expected: "9.1" },
        disconnected("binder older than running padi", "remote"),
      ),
    ).toEqual({
      cause: "contract-skew-refused",
      running: "9.0",
      expected: "9.1",
      reason: "binder older than running padi",
    });
  });

  it("keeps a transient disconnected with no detail WARMING (single-meaning null)", () => {
    expect(padiFailureOf(null, disconnected("link blip"))).toBeNull();
  });

  // F1: the LOCAL arm's `entryFailedDetail()` is ALWAYS null, but it can still reach a
  // terminal `failed` (repeated bounded give-ups: a spawn-error / wedged handshake that
  // never respawns). A null detail on a terminal give-up must NOT ride into the map's
  // `UnclassifiedHostFailureError` seam — it IS a link failure by the schema's own
  // definition, so it publishes `link-failed` off the transport reason.
  it("floors a terminal give-up with no detail to link-failed (the LOCAL arm)", () => {
    expect(
      padiFailureOf(null, failed("gave up after 8 consecutive failures")),
    ).toEqual({
      cause: "link-failed",
      reason: "gave up after 8 consecutive failures",
    });
  });
});
