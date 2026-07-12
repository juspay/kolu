import type { PadiLink } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { DAEMON_UNKNOWN_DOT, toneDot } from "../kaval/daemonPresentation";
import {
  PADI_LINK_PRESENTATION,
  padiBoundHostSegment,
  padiDot,
  toPadiPresence,
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
    ).toEqual({ kind: "warming" });
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

  it("pre-first-value (link undefined), `connecting`, and `degraded` each read their own honest kind — never `connected`", () => {
    expect(toPadiPresence(undefined, true, undefined, null)).toEqual({
      kind: "warming",
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
