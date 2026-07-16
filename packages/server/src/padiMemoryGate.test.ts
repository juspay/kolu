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
import type { SessionState } from "@kolu/surface-remote";
import { describe, expect, it } from "vitest";
import { padiMemoryReadable } from "./padiMemoryGate.ts";

/** A minimal valid `SessionState` for any phase (only `.phase` is read). Typed at the
 *  `SessionState<string>` phase top so it also covers the remote arm's provisioning phases
 *  (`probing`/`copying`/`building`) a `PadiSession<SshProv>` can pass into the gate — the
 *  provisioning phases are up-arms with the same shape as `connecting`. */
const at = (phase: SessionState<string>["phase"]): SessionState<string> => {
  switch (phase) {
    case "connected":
      return { phase, clockOffset: null, log: [], sinceMs: 0 };
    case "disconnected":
      return {
        phase,
        error: "link down",
        cause: "network",
        log: [],
        sinceMs: 0,
      };
    case "failed":
      return { phase, error: "gave up", cause: "remote", log: [], sinceMs: 0 };
    default:
      return { phase, log: [], sinceMs: 0 };
  }
};

/** A two-line fake session carrying just the two accessors the leaf reads. */
const session = (opts: {
  destroyed: boolean;
  phase: SessionState<string>["phase"];
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
