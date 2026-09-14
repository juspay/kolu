/** Pins the connect overlay's pure phase → narration mapping (W6): the provisioning
 *  headlines, WHICH phases time themselves (the coming-up ones, never the reconnect
 *  backoff), and which phases are narratable here (the coming-up ones plus the backoff; a
 *  standing refusal or terminal give-up is the host-down card's). */

import { describe, expect, it } from "vitest";
import { connectCanvasCopy, isConnectPhase } from "./connectCanvasCopy";

describe("connectCanvasCopy", () => {
  // The table is titles plus ONE per-phase knob, `showsElapsed`; the tail renders off the
  // frame's own data (pinned in `connectCanvasView.test.ts`), so a `probing` frame's log is
  // never hidden by a flag.
  it("probing is the calm OPENING title — 'Connecting to <host>…'", () => {
    expect(connectCanvasCopy("probing", "zest").title).toContain(
      "Connecting to zest",
    );
  });

  it("provisioning names the owned cold operation", () => {
    const c = connectCanvasCopy("provisioning", "zest");
    expect(c.title).toContain("Provisioning kolu on zest");
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
    // state machine (real provisioning still narrates its distinct copy).
    const gap = connectCanvasCopy(undefined, "zest");
    expect(gap.title).toBe(connectCanvasCopy("probing", "zest").title);
    expect(gap.title).toContain("Connecting to zest");
  });

  it("the reconnect backoff says kolu is going round again, never a bare 'Connecting…'", () => {
    expect(connectCanvasCopy("disconnected", "zest").title).toBe(
      "Reconnecting to zest…",
    );
  });

  it("only a coming-up phase times itself — the backoff and the gap carry no connect duration", () => {
    for (const phase of ["probing", "provisioning", "connecting"] as const) {
      expect(connectCanvasCopy(phase, "zest").showsElapsed).toBe(true);
    }
    expect(connectCanvasCopy("disconnected", "zest").showsElapsed).toBe(false);
    expect(connectCanvasCopy(undefined, "zest").showsElapsed).toBe(false);
  });

  it("interpolates the real host name into every phase", () => {
    for (const phase of ["provisioning", "connecting"] as const) {
      expect(connectCanvasCopy(phase, "alice@bob.example").title).toContain(
        "alice@bob.example",
      );
    }
  });
});

describe("isConnectPhase", () => {
  it("admits ONLY the narratable up phases", () => {
    expect(isConnectPhase("probing")).toBe(true);
    expect(isConnectPhase("provisioning")).toBe(true);
    expect(isConnectPhase("connecting")).toBe(true);
  });

  it("rejects `connected` and the down phases — the host-down card owns failure, and a connected host needs no overlay", () => {
    expect(isConnectPhase("connected")).toBe(false);
    expect(isConnectPhase("disconnected")).toBe(false);
    expect(isConnectPhase("failed")).toBe(false);
  });
});
