/**
 * W12 — the structural discriminant that decides whether a resolved-null agent
 * observation is an authoritative END (clear the resume target) or an UNOBSERVABLE
 * foreground (keep it). The 2026-07-12 prod incident: an unclean kaval death dropped
 * the foreground to `undefined` and the sensor emitted authoritative `null`, whose
 * fold clobbered every terminal's `restoreTarget` to `none` — so restore respawned
 * bare shells. The fix gives ignorance its own spelling; these pin it both ways.
 */

import { describe, expect, it } from "vitest";
import { agentAbsence } from "./sensors.ts";

describe("agentAbsence — two facts behind one resolved null", () => {
  it("UNOBSERVABLE when the foreground process group is unknown (foregroundPid undefined)", () => {
    // The kaval-death shape: the pty-host tap can no longer report a foreground pid.
    // We do not KNOW the agent ended — we only lost sight of it. Keep the value.
    expect(agentAbsence(undefined)).toBe("unobservable");
  });

  it("ENDED when a DEFINED foreground resolved to no agent (the shell after a genuine quit)", () => {
    // A real, observed foreground process group that is not this agent — an
    // authoritative end. The resume target must clear so restore wakes a bare shell.
    expect(agentAbsence(4321)).toBe("ended");
    expect(agentAbsence(1)).toBe("ended");
  });
});
