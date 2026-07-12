/**
 * W12 — the structural discriminant that decides whether a resolved-null agent
 * observation is an authoritative END (clear the resume target) or an UNOBSERVABLE
 * terminal (keep it). The 2026-07-12 prod incident: an unclean kaval death failed the
 * pty-host taps and the sensor emitted authoritative `null` against a stale
 * foreground, whose fold clobbered every terminal's `restoreTarget` to `none` — so
 * restore respawned bare shells. The live kill-9 witness proved the reconcile saw a
 * DEFINED foregroundPid at that moment, so the discriminant is the ENDPOINT's own
 * observability (are the taps live?), NOT the foreground pid. These pin it both ways.
 */

import { describe, expect, it } from "vitest";
import { agentAbsence } from "./sensors.ts";

describe("agentAbsence — two facts behind one resolved null", () => {
  it("UNOBSERVABLE when the terminal's taps are down (an unclean kaval death)", () => {
    // The kaval-death shape: the pty-host connection dropped, so we can no longer
    // observe this terminal. A resolved-null is ignorance, not an observed end —
    // keep the last agent and its resume target.
    expect(agentAbsence(false)).toBe("unobservable");
  });

  it("ENDED when the taps are live and still resolved to no agent (a genuine quit)", () => {
    // The endpoint is observable and kolu genuinely saw the foreground move off this
    // agent — an authoritative end. The resume target must clear so restore wakes a
    // bare shell (never resurrecting a dead agent).
    expect(agentAbsence(true)).toBe("ended");
  });
});
