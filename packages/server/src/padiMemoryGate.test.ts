/**
 * The app pin (LIVE-FIX): `readPadiMemoryOnce` (index.ts) gates its deferred mirror read
 * on `padiMemoryReadable(padiSession.currentState())`, returning `null` (→ honest
 * `absent`) for every phase but `connected`.
 *
 * The FRAMEWORK pin (surface-remote `currentState.test.ts`) proves `currentState()`
 * returns the honest phase even while `currentClient()` stays non-null through a backoff.
 * This pins the app half: the gate reads `phase === "connected"` ONLY — so it CANNOT
 * regress to the retired `currentClient() !== null`, which leaked truthy through connecting
 * and whole backoff windows.
 */
import type { SessionState } from "@kolu/surface-remote";
import { describe, expect, it } from "vitest";
import { padiMemoryReadable } from "./padiMemoryGate.ts";

/** A minimal valid `SessionState` for each phase (only `.phase` is read). */
const at = (phase: SessionState["phase"]): SessionState => {
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

describe("padiMemoryReadable — the memory-rail liveness policy (LIVE-FIX)", () => {
  it("is true ONLY when connected", () => {
    expect(padiMemoryReadable(at("connected"))).toBe(true);
  });

  it("is false for every up-but-not-connected and down phase (the honest absent)", () => {
    for (const phase of ["connecting", "disconnected", "failed"] as const) {
      expect(padiMemoryReadable(at(phase))).toBe(false);
    }
  });
});
