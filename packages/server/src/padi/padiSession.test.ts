/**
 * `padiFailureOf` — the `serveHostMap` `failureOf` classifier pulled out of the
 * composition root so its contract is a tested pure function (not buried in
 * `index.ts`). It is the seam where a padi arm's arm-local
 * {@link PadiEntryFailedDetail} plus the transport DOWN state become the map's
 * schema-valid {@link PadiEntryFailure} — and, crucially, where a LOCAL arm's
 * terminal give-up (whose `entryFailedDetail()` is ALWAYS null) is classified as
 * `local-start-failed` instead of yielding `null` into `serveHostMap`'s fail-loud
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

// `provisions`: false = the LOCAL endpoint arm (no nix-copy), true = a provisioning
// ssh arm. It's the runtime twin of the session's `Prov` and the discriminant
// `padiFailureOf` uses to name a no-detail terminal give-up.
const LOCAL = false;
const REMOTE = true;

describe("padiFailureOf — detail + transport state → published PadiEntryFailure", () => {
  it("pairs a finer arm-local detail with the transport reason", () => {
    expect(
      padiFailureOf(
        REMOTE,
        { cause: "unconverged" },
        failed("drain never took"),
      ),
    ).toEqual({ cause: "unconverged", reason: "drain never took" });
  });

  it("carries the typed skew pair through the contract-skew arm", () => {
    expect(
      padiFailureOf(
        REMOTE,
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
    expect(padiFailureOf(LOCAL, null, disconnected("link blip"))).toBeNull();
    expect(padiFailureOf(REMOTE, null, disconnected("link blip"))).toBeNull();
  });

  // F1: the LOCAL arm's `entryFailedDetail()` is ALWAYS null, but it can still reach a
  // terminal `failed` (repeated bounded give-ups: a spawn-error / wedged handshake that
  // never respawns). A null detail on a terminal give-up must NOT ride into the map's
  // `UnclassifiedHostFailureError` seam. Classified off the ARM (`provisions`): a
  // non-provisioning give-up is `local-start-failed` (a distinct producer: the padi
  // couldn't start on this machine), never collapsed into the remote `link-failed`.
  it("classifies a LOCAL (non-provisioning) terminal give-up with no detail as local-start-failed", () => {
    expect(
      padiFailureOf(
        LOCAL,
        null,
        failed("gave up after 8 consecutive failures"),
      ),
    ).toEqual({
      cause: "local-start-failed",
      reason: "gave up after 8 consecutive failures",
    });
  });

  // The remote arm normally rides the detail branch (its convergence sets a `link-failed`
  // detail). This pins the fallback: if a remote path ever reaches a terminal give-up
  // WITHOUT that detail, it still classifies correctly off the arm — `link-failed`, never
  // mislabeled `local-start-failed`.
  it("classifies a REMOTE (provisioning) terminal give-up with no detail as link-failed", () => {
    expect(
      padiFailureOf(REMOTE, null, failed("ssh gave up after 5 dials")),
    ).toEqual({
      cause: "link-failed",
      reason: "ssh gave up after 5 dials",
    });
  });
});
