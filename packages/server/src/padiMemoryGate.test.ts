/**
 * The app pin (LIVE-FIX): `readPadiMemoryOnce` (index.ts) gates its deferred mirror read
 * on `padiMemoryReadable(padiSession)`, returning `null` (→ honest `absent`) unless the
 * session is BOTH not-destroyed AND `connected`.
 *
 * The FRAMEWORK pin (surface-remote `currentState.test.ts`) proves `currentState()`
 * returns the honest phase even while `currentClient()` stays non-null through a backoff.
 * This pins the app policy — the WHOLE gate, both halves:
 *  - the PHASE half reads `phase === "connected"` ONLY, so it CANNOT regress to the retired
 *    `currentClient() !== null`, which leaked truthy through connecting and whole backoff
 *    windows;
 *  - the DESTROYED half folds a torn-down session to NOT readable even when its stale frame
 *    still reads `connected` (the frame carries no "destroyed" phase), so the named leaf
 *    covers the whole decision and no caller must AND in `!isDestroyed()` by hand.
 */
import type { SessionState, SshProv } from "@kolu/surface-remote";
import { match } from "ts-pattern";
import { describe, expect, it } from "vitest";
import { padiMemoryReadable } from "./padiMemoryGate.ts";

/** A minimal valid `SessionState` for any phase. Typed at the REMOTE arm `SshProv`
 *  (`SessionState<SshProv>` — a closed 7-phase union), which is assignable to the gate's
 *  `SessionState<string>` param, so the fixture also covers the provisioning phases
 *  (`probing`/`copying`/`building`) a `PadiSession<SshProv>` passes in. `.exhaustive()` over
 *  the closed union means a new phase forces this fixture to compile-fail until handled. */
const at = (phase: SessionState<SshProv>["phase"]): SessionState<SshProv> =>
  match<typeof phase, SessionState<SshProv>>(phase)
    .with("connected", (p) => ({ phase: p, clockOffset: null, log: [], sinceMs: 0 }))
    .with("disconnected", (p) => ({
      phase: p,
      error: "link down",
      cause: "network",
      log: [],
      sinceMs: 0,
    }))
    .with("failed", (p) => ({
      phase: p,
      error: "gave up",
      cause: "remote",
      log: [],
      sinceMs: 0,
    }))
    // The up-but-not-connected arms (local `connecting` + the remote provisioning phases)
    // share one shape — collapsed with a multi-pattern `.with`.
    .with("connecting", "probing", "copying", "building", (p) => ({
      phase: p,
      log: [],
      sinceMs: 0,
    }))
    .exhaustive();

/** A two-line fake session carrying just the two accessors the leaf reads. */
const session = (opts: {
  destroyed: boolean;
  phase: SessionState<SshProv>["phase"];
}) => ({
  isDestroyed: () => opts.destroyed,
  currentState: () => at(opts.phase),
});

describe("padiMemoryReadable — the memory-rail liveness policy (LIVE-FIX)", () => {
  it("is true ONLY when a live (not-destroyed) session is connected", () => {
    expect(
      padiMemoryReadable(session({ destroyed: false, phase: "connected" })),
    ).toBe(true);
  });

  it("is false for every up-but-not-connected and down phase, local AND remote (the honest absent)", () => {
    // Local up-but-not-connected + down, plus the remote arm's provisioning phases the
    // `SessionState<string>`-typed gate must also fold to absent.
    for (const phase of [
      "connecting",
      "probing",
      "copying",
      "building",
      "disconnected",
      "failed",
    ] as const) {
      expect(padiMemoryReadable(session({ destroyed: false, phase }))).toBe(
        false,
      );
    }
  });

  it("is false for a DESTROYED session even with a stale `connected` frame", () => {
    expect(
      padiMemoryReadable(session({ destroyed: true, phase: "connected" })),
    ).toBe(false);
  });
});
