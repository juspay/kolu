/** Pins the connect overlay's pure phase → narration mapping (W6): the copying/building
 *  headlines, WHICH phases show a live tail + elapsed (the provisioning ones, never the
 *  brief handshake), and that only the up-but-not-yet-connected phases are narratable
 *  here (a down phase is the host-down card's, never a second failure surface). */

import { describe, expect, it } from "vitest";
import { connectCanvasCopy, isConnectPhase } from "./connectCanvasCopy";

describe("connectCanvasCopy", () => {
  // The table is PURE titles — no per-phase show/hide knob; the tail + elapsed render off the
  // frame's own data (pinned in `connectCanvasView.test.ts`), so a `probing` frame's log is
  // never hidden by a flag.
  it("probing is the calm OPENING title — 'Connecting to <host>…'", () => {
    expect(connectCanvasCopy("probing", "zest").title).toContain(
      "Connecting to zest",
    );
  });

  it("copying names the provision", () => {
    const c = connectCanvasCopy("copying", "zest");
    expect(c.title).toContain("Provisioning kolu onto zest");
    expect(c.title).toContain("first connect ships the recipe");
  });

  it("building names the compile — 'this can take a few minutes'", () => {
    const c = connectCanvasCopy("building", "zest");
    expect(c.title).toContain("Building on zest");
    expect(c.title).toContain("few minutes");
  });

  it("connecting is the brief handshake title", () => {
    expect(connectCanvasCopy("connecting", "zest").title).toContain(
      "Connecting to zest",
    );
  });

  it("the GAP (undefined phase) is byte-identical to probing — kills the connect-copy flicker", () => {
    // The pre-frame/gap case: no connect phase known yet (subscription pending, C' floored a
    // stale cell, or a connected/down phase narrowed out). It returns the SAME copy as
    // probing, so a routing flap between the boot-gate `connecting` mode and the `warming`
    // overlay renders identical pixels — the flicker srid saw is gone, without hiding the
    // state machine (a real copying/building still narrates its distinct copy).
    const gap = connectCanvasCopy(undefined, "zest");
    expect(gap).toEqual(connectCanvasCopy("probing", "zest"));
    expect(gap.title).toContain("Connecting to zest");
  });

  it("interpolates the real host name into every phase", () => {
    for (const phase of ["copying", "building", "connecting"] as const) {
      expect(connectCanvasCopy(phase, "alice@bob.example").title).toContain(
        "alice@bob.example",
      );
    }
  });
});

describe("isConnectPhase", () => {
  it("admits ONLY the narratable up phases", () => {
    expect(isConnectPhase("probing")).toBe(true);
    expect(isConnectPhase("copying")).toBe(true);
    expect(isConnectPhase("building")).toBe(true);
    expect(isConnectPhase("connecting")).toBe(true);
  });

  it("rejects `connected` and the down phases — the host-down card owns failure, and a connected host needs no overlay", () => {
    expect(isConnectPhase("connected")).toBe(false);
    expect(isConnectPhase("disconnected")).toBe(false);
    expect(isConnectPhase("failed")).toBe(false);
  });
});
