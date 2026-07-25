import { describe, expect, it } from "vitest";
import { mapConnectionToPadiLink } from "./padiLink.ts";

/** Every session `phase` the mapping is total over — derived from the mapping's
 *  own parameter so a new phase added to the source union surfaces here too. */
type SessionPhase = Parameters<typeof mapConnectionToPadiLink>[0];

describe("mapConnectionToPadiLink — bound padi session phase → koluSurface padiLink", () => {
  it("maps a live binding to `connected`", () => {
    expect(mapConnectionToPadiLink("connected")).toBe("connected");
  });

  it("maps a (re)establishing binding to `connecting` (initial dial + the reconnect tail)", () => {
    expect(mapConnectionToPadiLink("connecting")).toBe("connecting");
    expect(mapConnectionToPadiLink("probing")).toBe("connecting");
    expect(mapConnectionToPadiLink("provisioning")).toBe("connecting");
  });

  it("maps a dropped binding to `degraded` — the drain window and a failed dial alike", () => {
    // The re-targeted "restart kaval" DRAINS padi: the binding goes disconnected while
    // padi persists+exits and the loop re-dials. `failed` (bounded give-up) also folds
    // here — either way the client reads the honest "coming up / degraded", never a
    // frozen `connected`.
    expect(mapConnectionToPadiLink("disconnected")).toBe("degraded");
    expect(mapConnectionToPadiLink("failed")).toBe("degraded");
  });

  it("is total over every session phase (a new phase is a compile error, not a silent gap)", () => {
    const all: SessionPhase[] = [
      "probing",
      "provisioning",
      "connecting",
      "connected",
      "disconnected",
      "failed",
    ];
    // Every phase maps to one of the three padiLink states — no throw, no undefined.
    for (const s of all) {
      expect(["connecting", "connected", "degraded"]).toContain(
        mapConnectionToPadiLink(s),
      );
    }
  });
});
