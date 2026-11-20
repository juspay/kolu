import { describe, expect, it } from "vitest";
import { DAEMON_UNKNOWN_DOT, toneDot } from "../kaval/daemonPresentation";
import {
  PADI_LINK_PRESENTATION,
  type PadiPresence,
  padiBoundHostSegment,
  padiPresencePresentation,
  presenceLink,
  toPadiPresence,
} from "./padiPresentation";

describe("padiBoundHostSegment — the Padi chip names WHERE padi is, and reads as remote", () => {
  it("renders the ssh host segment when bound to a REMOTE host", () => {
    expect(padiBoundHostSegment("sincereintent")).toBe("ssh · sincereintent");
  });

  it("renders NO host segment when LOCAL — the local chip stays byte-identical", () => {
    expect(padiBoundHostSegment(null)).toBeNull();
  });
});

describe("toPadiPresence — P4: connected ⇒ identity present, by construction", () => {
  it("a genuinely connected, identified padi over a live transport reads `connected` with its identity", () => {
    expect(
      toPadiPresence("connected", true, {
        commit: "deadbeef",
        surfaceVersion: "1.1",
        lifetime: { kind: "forever" },
      }),
    ).toEqual({
      kind: "connected",
      identity: {
        buildCommit: "deadbeef",
        surfaceVersion: "1.1",
        lifetime: { kind: "forever" },
      },
    });
  });

  it("RED→GREEN repro (the reported bug): `padiLink === 'connected'` with the identity cell PENDING (not yet arrived) NEVER reads `connected` — it folds to `warming`, never a synthesized dash beside a claimed-live padi", () => {
    const presence = toPadiPresence("connected", true, undefined);
    expect(presence.kind).toBe("warming");
    expect(presence).not.toMatchObject({ kind: "connected" });
  });

  it("a DECLARED no-commit (dev/off-nix build) reads `connected` with a null build commit — sourced from the wire's declared null, NEVER conflated with the cell-pending case above", () => {
    const presence = toPadiPresence("connected", true, {
      commit: null,
      surfaceVersion: "1.1",
      lifetime: { kind: "forever" },
    });
    expect(presence).toEqual({
      kind: "connected",
      identity: {
        buildCommit: null,
        surfaceVersion: "1.1",
        lifetime: { kind: "forever" },
      },
    });
  });

  it("RED→GREEN repro: the drain/reconnect class — a dead transport never reads `connected`, even with identity already known", () => {
    expect(
      toPadiPresence("connected", false, {
        commit: "deadbeef",
        surfaceVersion: "1.1",
        lifetime: { kind: "forever" },
      }),
    ).toEqual({ kind: "unknown" });
    expect(
      toPadiPresence("connected", true, {
        commit: "deadbeef",
        surfaceVersion: "1.1",
        lifetime: { kind: "forever" },
      }),
    ).toMatchObject({ kind: "connected" });
  });

  it("pre-first-value (link undefined) ⇒ unknown; `connecting` ⇒ warming; `degraded` ⇒ down — each its own honest kind, never `connected`", () => {
    expect(toPadiPresence(undefined, true, undefined)).toEqual({
      kind: "unknown",
    });
    expect(toPadiPresence("connecting", true, undefined)).toEqual({
      kind: "warming",
    });
    expect(
      toPadiPresence("degraded", true, {
        commit: "deadbeef",
        surfaceVersion: "1.1",
        lifetime: { kind: "forever" },
      }),
    ).toEqual({
      kind: "down",
    });
  });
});

describe("padiPresencePresentation — the dialog's dot + word + text tone, ONE match over presence (no raw link/live)", () => {
  const connected: PadiPresence = {
    kind: "connected",
    identity: {
      buildCommit: "c",
      surfaceVersion: "1.1",
      lifetime: undefined,
    },
  };

  it("dot: unknown is grey; connected/warming/down reuse the link tones", () => {
    expect(padiPresencePresentation({ kind: "unknown" }).dot).toBe(
      DAEMON_UNKNOWN_DOT,
    );
    expect(padiPresencePresentation(connected).dot).toBe(toneDot.ok);
    expect(padiPresencePresentation({ kind: "warming" }).dot).toBe(
      toneDot.warming,
    );
    expect(padiPresencePresentation({ kind: "down" }).dot).toBe(toneDot.down);
  });

  it("label + text tone: unknown reads 'unknown'/text-fg-3; the others read the PADI_LINK_PRESENTATION word/text-fg", () => {
    expect(padiPresencePresentation({ kind: "unknown" }).label).toBe("unknown");
    expect(padiPresencePresentation({ kind: "unknown" }).textClass).toBe(
      "text-fg-3",
    );
    expect(padiPresencePresentation(connected).label).toBe(
      PADI_LINK_PRESENTATION.connected.label,
    );
    expect(padiPresencePresentation(connected).textClass).toBe("text-fg");
    expect(padiPresencePresentation({ kind: "warming" }).label).toBe(
      PADI_LINK_PRESENTATION.connecting.label,
    );
    expect(padiPresencePresentation({ kind: "down" }).label).toBe(
      PADI_LINK_PRESENTATION.degraded.label,
    );
  });

  it("#1793: a not-live padi projects to grey 'unknown' — never green/connected off a stale link", () => {
    const dead = toPadiPresence("connected", false, {
      commit: "c",
      surfaceVersion: "1.1",
    });
    expect(dead).toEqual({ kind: "unknown" });
    expect(padiPresencePresentation(dead).dot).toBe(DAEMON_UNKNOWN_DOT);
    expect(padiPresencePresentation(dead).label).toBe("unknown");
  });

  it("presenceLink: the rail mark's data-padi-link — connected/unknown name themselves, warming reads 'connecting', down reads 'degraded'", () => {
    expect(presenceLink(connected)).toBe("connected");
    expect(presenceLink({ kind: "unknown" })).toBe("unknown");
    expect(presenceLink({ kind: "down" })).toBe("degraded");
    expect(presenceLink(toPadiPresence("connected", true, undefined))).toBe(
      "connecting",
    );
    expect(presenceLink({ kind: "warming" })).toBe("connecting");
  });
});
