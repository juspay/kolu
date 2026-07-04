import type { PadiLink } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { DAEMON_UNKNOWN_DOT, toneDot } from "../kaval/daemonPresentation";
import {
  PADI_LINK_PRESENTATION,
  padiBoundHostSegment,
  padiDot,
} from "./padiPresentation";

describe("padiDot — the padi dot's tone is FLOORED on transport liveness (the padiLink sibling of kavalDot)", () => {
  it("paints the padiLink tone only when the transport is LIVE", () => {
    // A connected link over a live transport → its 'ok' tone; a transient link →
    // warming; a dropped link → down.
    expect(padiDot("connected", true)).toBe(toneDot.ok);
    expect(padiDot("connected", true)).not.toBe(DAEMON_UNKNOWN_DOT);
    expect(padiDot("connecting", true)).toBe(toneDot.warming);
    expect(padiDot("degraded", true)).toBe(toneDot.down);
  });

  it("FLOORS to the unknown grey when the transport is NOT live — never bg-ok over a dead/half-open channel", () => {
    // A dead ws leaves the retained padiLink stale; painting bg-ok off it would be a
    // definite 'connected' the dead channel can't confirm. Floored: grey (unknown),
    // for EVERY link state.
    for (const link of Object.keys(PADI_LINK_PRESENTATION) as PadiLink[]) {
      expect(padiDot(link, false)).toBe(DAEMON_UNKNOWN_DOT);
    }
    expect(padiDot("connected", false)).not.toBe(toneDot.ok);
  });

  it("is the unknown grey for a pre-first-yield link, live or not", () => {
    expect(padiDot(undefined, true)).toBe(DAEMON_UNKNOWN_DOT);
    expect(padiDot(undefined, false)).toBe(DAEMON_UNKNOWN_DOT);
  });

  it("a degraded padi is the down (red) tone, never a fake green", () => {
    // The honest signal: a dropped padi shows an unhealthy pip, not a green light.
    expect(padiDot("degraded", true)).toBe(toneDot.down);
    expect(padiDot("degraded", true)).not.toBe(toneDot.ok);
  });
});

describe("padiBoundHostSegment — the Padi chip names WHERE padi is, and reads as remote", () => {
  it("renders the ssh host segment when bound to a REMOTE host", () => {
    // daemonScanBoundHost() non-null → the chip gains `ssh · <host>`, so the rail
    // reads e.g. `Padi · ssh · sincereintent · contract v1.1`.
    expect(padiBoundHostSegment("sincereintent")).toBe("ssh · sincereintent");
  });

  it("renders NO host segment when LOCAL — the local chip stays byte-identical", () => {
    // daemonScanBoundHost() null (local binding / pre-first-enumeration) → no host
    // noise, exactly today's `Padi · contract v<x.y>`.
    expect(padiBoundHostSegment(null)).toBeNull();
  });
});
