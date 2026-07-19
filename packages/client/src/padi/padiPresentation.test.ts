import { describe, expect, it } from "vitest";
import { DAEMON_UNKNOWN_DOT, toneDot } from "../kaval/daemonPresentation";
import {
  PADI_LINK_PRESENTATION,
  type PadiPresence,
  padiBoundHostSegment,
  padiLinkAttr,
  padiPresencePresentation,
  toPadiPresence,
} from "./padiPresentation";

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

describe("toPadiPresence — P4: connected ⇒ identity present, by construction", () => {
  it("a genuinely connected, identified padi over a live transport reads `connected` with its identity", () => {
    expect(
      toPadiPresence(
        "connected",
        true,
        {
          commit: "deadbeef",
          surfaceVersion: "1.1",
          lifetime: { kind: "forever" },
        },
        null,
      ),
    ).toEqual({
      kind: "connected",
      identity: {
        buildCommit: "deadbeef",
        surfaceVersion: "1.1",
        convergence: null,
        lifetime: { kind: "forever" },
      },
    });
  });

  it("RED→GREEN repro (the reported bug): `padiLink === 'connected'` with the identity cell PENDING (not yet arrived) NEVER reads `connected` — it folds to `warming`, never a synthesized dash beside a claimed-live padi", () => {
    // The reproduced bug's shape exactly: the socket + running-daemons list (host-scoped,
    // already alive) correctly showed padi as live, while the status/build-commit read
    // straight off `padiLink`/the old raw `boundPadi.*` with `??`/ternary fallbacks —
    // "connected" beside a synthesized "—". `toPadiPresence` makes that combination
    // unrepresentable: there is no `{ kind: "connected", identity: undefined }`. `undefined`
    // here is the identity CELL not having yielded its first frame yet — a distinct state
    // from "padi declared no commit" (see the next test).
    const presence = toPadiPresence("connected", true, undefined, null);
    expect(presence.kind).toBe("warming");
    expect(presence).not.toMatchObject({ kind: "connected" });
  });

  it("a DECLARED no-commit (dev/off-nix build) reads `connected` with a null build commit — sourced from the wire's declared null, NEVER conflated with the cell-pending case above", () => {
    // The identity cell HAS arrived (padi is the writer, and it declared `commit: null`
    // for its own dev/off-nix build) — this is legitimately `connected`, distinct in TYPE
    // (a present object with a null field) from the pending case (`identity === undefined`).
    const presence = toPadiPresence(
      "connected",
      true,
      { commit: null, surfaceVersion: "1.1", lifetime: { kind: "forever" } },
      null,
    );
    expect(presence).toEqual({
      kind: "connected",
      identity: {
        buildCommit: null,
        surfaceVersion: "1.1",
        convergence: null,
        lifetime: { kind: "forever" },
      },
    });
  });

  it("RED→GREEN repro: the drain/reconnect class — a dead transport never reads `connected`, even with identity already known", () => {
    // The reproduced live bug: an AbortError drain burst kills the ws; the retained
    // (stale) `connected` link + last-known build commit must not be shown as confirmed.
    expect(
      toPadiPresence(
        "connected",
        false,
        {
          commit: "deadbeef",
          surfaceVersion: "1.1",
          lifetime: { kind: "forever" },
        },
        null,
      ),
    ).toEqual({ kind: "unknown" });
    // Reconnect (transport live again, facts unchanged) — identity is confirmed again.
    expect(
      toPadiPresence(
        "connected",
        true,
        {
          commit: "deadbeef",
          surfaceVersion: "1.1",
          lifetime: { kind: "forever" },
        },
        null,
      ),
    ).toMatchObject({ kind: "connected" });
  });

  it("pre-first-value (link undefined) ⇒ unknown; `connecting` ⇒ warming; `degraded` ⇒ down — each its own honest kind, never `connected`", () => {
    // No link value yet ⇒ `unknown` (grey), same as a dead channel — not `warming`.
    expect(toPadiPresence(undefined, true, undefined, null)).toEqual({
      kind: "unknown",
    });
    expect(toPadiPresence("connecting", true, undefined, null)).toEqual({
      kind: "warming",
    });
    expect(
      toPadiPresence(
        "degraded",
        true,
        {
          commit: "deadbeef",
          surfaceVersion: "1.1",
          lifetime: { kind: "forever" },
        },
        null,
      ),
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
      convergence: null,
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
    const dead = toPadiPresence(
      "connected",
      false,
      { commit: "c", surfaceVersion: "1.1" },
      null,
    );
    expect(dead).toEqual({ kind: "unknown" });
    expect(padiPresencePresentation(dead).dot).toBe(DAEMON_UNKNOWN_DOT);
    expect(padiPresencePresentation(dead).label).toBe("unknown");
  });

  it("padiLinkAttr: the rail mark's data-padi-link — connected/unknown name themselves, warming reads 'connecting', down reads 'degraded'", () => {
    expect(padiLinkAttr(connected)).toBe("connected");
    expect(padiLinkAttr({ kind: "unknown" })).toBe("unknown");
    expect(padiLinkAttr({ kind: "down" })).toBe("degraded");
    // A live-but-pre-identity `connected` link folds to `warming` → reads "connecting"
    // (aligned with the dialog), never a premature "connected".
    expect(
      padiLinkAttr(toPadiPresence("connected", true, undefined, null)),
    ).toBe("connecting");
    expect(padiLinkAttr({ kind: "warming" })).toBe("connecting");
  });
});
