import type { DaemonState } from "@kolu/padi/surface";
import type { ConnectionState } from "@kolu/surface-nix-host/connection";
import { describe, expect, it } from "vitest";
import {
  connectionToPadiLink,
  DAEMON_STATE_PRESENTATION,
  DAEMON_UNKNOWN_DOT,
  kavalDot,
  liveDownState,
  liveDownStateWithPadiLink,
  liveWarming,
  liveWarmingWithPadiLink,
  serverDot,
  toneDot,
} from "./daemonPresentation";

describe("connectionToPadiLink — the ACTIVE binding's connection state → the PadiLink display (W4)", () => {
  it("collapses the five connection phases onto the three padiLink states", () => {
    // The per-host `connection` cell that replaced the retired single-host
    // `kolu.padiLink` cell — the client twin of the deleted server-side mapper.
    expect(connectionToPadiLink("connected")).toBe("connected");
    expect(connectionToPadiLink("connecting")).toBe("connecting");
    expect(connectionToPadiLink("copying")).toBe("connecting");
    expect(connectionToPadiLink("disconnected")).toBe("degraded");
    expect(connectionToPadiLink("failed")).toBe("degraded");
  });

  it("is total over every ConnectionState (a new phase is a compile error, exhaustive here)", () => {
    const ALL: ConnectionState[] = [
      "copying",
      "connecting",
      "connected",
      "disconnected",
      "failed",
    ];
    for (const state of ALL) {
      expect(["connecting", "connected", "degraded"]).toContain(
        connectionToPadiLink(state),
      );
    }
  });
});

describe("kavalDot — the kaval dot's tone is FLOORED on transport liveness (#1568 green-dot class)", () => {
  it("paints the daemon-state tone only when the transport is LIVE", () => {
    // A connected daemon over a live link → its 'ok' tone; a transient state → warming.
    expect(kavalDot("connected", true)).toBe(toneDot.ok);
    expect(kavalDot("connected", true)).not.toBe(DAEMON_UNKNOWN_DOT);
    expect(kavalDot("restarting", true)).toBe(toneDot.warming);
    expect(kavalDot("dead", true)).toBe(toneDot.down);
  });

  it("FLOORS to the unknown grey when the transport is NOT live — never bg-ok over a dead/half-open channel", () => {
    // The bug Reviewer 2 confirmed: a dead ws leaves the retained 'connected' state
    // stale, but the dot painted bg-ok off it — a definite 'running' the dead channel
    // can't confirm. Floored: grey (unknown), for EVERY state — a known state can
    // only REFINE the tone WITHIN a live link, never claim a verdict over a dead one.
    for (const state of Object.keys(
      DAEMON_STATE_PRESENTATION,
    ) as DaemonState[]) {
      expect(kavalDot(state, false)).toBe(DAEMON_UNKNOWN_DOT);
    }
    // Specifically: a connected daemon over a dead link is NOT painted 'running'.
    expect(kavalDot("connected", false)).not.toBe(toneDot.ok);
  });

  it("is the unknown grey for a pre-first-yield state, live or not", () => {
    expect(kavalDot(undefined, true)).toBe(DAEMON_UNKNOWN_DOT);
    expect(kavalDot(undefined, false)).toBe(DAEMON_UNKNOWN_DOT);
  });

  it("the unknown grey is distinct from the `down` (dead-daemon) tone — unknown ≠ dead", () => {
    // A dead LINK reads 'unknown' (grey), a dead DAEMON over a live link reads
    // 'down' (red): the two failures must not collapse into one verdict.
    expect(DAEMON_UNKNOWN_DOT).not.toBe(toneDot.down);
    expect(kavalDot("dead", true)).not.toBe(DAEMON_UNKNOWN_DOT);
  });
});

describe("serverDot — the server-connection dot's green FLOORED on the watchdog fact", () => {
  // The round-4 sibling of kavalDot: the srv/mobile connection dot read the
  // half-open-blind open/close lifecycle (wsDot), so a silent half-open the watchdog
  // already caught (live=false) still read status="open" → green. serverDot floors it.

  it("paints green (ok) only when LIVE; a half-open (open but not-live) reads reconnecting, never green", () => {
    expect(serverDot("open", true)).toBe(toneDot.ok); // genuinely connected
    // The half-open: lifecycle still "open" but the watchdog flipped live false →
    // NOT a definite green; show the reconnecting (warming) tone instead.
    expect(serverDot("open", false)).toBe(toneDot.warming);
    expect(serverDot("open", false)).not.toBe(toneDot.ok);
  });

  it("a genuine closed/connecting keeps its own honest tone — the floor only withholds the open→green claim", () => {
    // A real close IS known-down (red), not floored to "unknown"; the floor targets
    // only the lifecycle's optimistic open→green over a watchdog-detected half-open.
    expect(serverDot("closed", false)).toBe(toneDot.down);
    expect(serverDot("connecting", false)).toBe(toneDot.warming);
    expect(serverDot("connecting", true)).toBe(toneDot.warming);
  });
});

describe("liveWarming / liveDownState — daemon-state claims FLOORED on transport liveness", () => {
  // The round-3 relocation: the canvas + the ⌘T lockout (refuseIfWarming) + the
  // command gate all read "is the daemon warming/down" through these source folds, so
  // flooring HERE floors every consumer at once — a stale "restarting…"/"dead" can't
  // reach the canvas ("Restarting kaval…") or the lockout ("Daemon is starting") over
  // a dead/half-open link.

  it("liveWarming is true ONLY over a live link", () => {
    expect(liveWarming("restarting", true)).toBe(true);
    expect(liveWarming("connecting", true)).toBe(true);
    // Dead link: a retained warming state is stale → not warming.
    expect(liveWarming("restarting", false)).toBe(false);
    expect(liveWarming("connecting", false)).toBe(false);
    // A non-warming or unknown state is not warming regardless.
    expect(liveWarming("connected", true)).toBe(false);
    expect(liveWarming(undefined, true)).toBe(false);
  });

  it("liveDownState is the down sub-state ONLY over a live link, else undefined (unknown ≠ down)", () => {
    expect(liveDownState("dead", true)).toBe("dead");
    expect(liveDownState("degraded", true)).toBe("degraded");
    // Dead link: a retained down state is stale → unknown, NOT a definite "down"
    // (so DegradedCanvas never paints over a link we can't see through).
    expect(liveDownState("dead", false)).toBeUndefined();
    expect(liveDownState("degraded", false)).toBeUndefined();
    // A non-down or unknown state is not down regardless.
    expect(liveDownState("connected", true)).toBeUndefined();
    expect(liveDownState(undefined, true)).toBeUndefined();
  });
});

describe("the padi-link leg — the SECOND floor on the re-served kaval daemonStatus (#1034)", () => {
  // The kaval daemonStatus rides padi's RE-SERVED surface, so its true liveness is BOTH
  // legs: the browser↔kolu-server ws AND kolu-server's binding to padi (`padiLink`). The
  // re-targeted "restart kaval" DRAINS padi, dropping the binding for the whole drain
  // window — during which the re-serve value-fold HOLDS the last kaval status STALE. The
  // fold treats a not-`connected` padi link as the honest "coming up" (warming true) AND
  // suppresses the stale "kaval is down" claim, so the canvas shows the neutral warming
  // surface over the whole drain window instead of a frozen re-served `degraded`.

  it("liveWarmingWithPadiLink: warming whenever the padi link is not `connected` (over a live transport)", () => {
    // A (re)connecting or dropped binding is itself 'coming up', regardless of the
    // (frozen) re-served kaval state.
    expect(liveWarmingWithPadiLink("connecting", "connected", true)).toBe(true);
    expect(liveWarmingWithPadiLink("degraded", "connected", true)).toBe(true);
    // Even a stale re-served `degraded` kaval status reads WARMING (not down) while the
    // padi link is down — this is the whole-drain-window honesty the fix delivers.
    expect(liveWarmingWithPadiLink("degraded", "degraded", true)).toBe(true);
    // Pre-first-yield padiLink (undefined) is treated as not-connected → warming.
    expect(liveWarmingWithPadiLink(undefined, "connected", true)).toBe(true);
  });

  it("liveWarmingWithPadiLink: falls through to the kaval-state warming logic when the padi link is `connected`", () => {
    // padi bound → the kaval state alone decides, exactly as `liveWarming` did.
    expect(liveWarmingWithPadiLink("connected", "restarting", true)).toBe(true);
    expect(liveWarmingWithPadiLink("connected", "connecting", true)).toBe(true);
    expect(liveWarmingWithPadiLink("connected", "connected", true)).toBe(false);
    expect(liveWarmingWithPadiLink("connected", "dead", true)).toBe(false);
    expect(liveWarmingWithPadiLink("connected", undefined, true)).toBe(false);
  });

  it("liveWarmingWithPadiLink: FLOORS to false over a dead browser transport — no warming off a stale padiLink", () => {
    // The browser↔server leg dead: the whole readout is stale, so even a not-connected
    // padi link claims no warming — mirroring `liveWarming`'s transport floor exactly.
    expect(liveWarmingWithPadiLink("connecting", "connected", false)).toBe(
      false,
    );
    expect(liveWarmingWithPadiLink("degraded", "degraded", false)).toBe(false);
    expect(liveWarmingWithPadiLink("connected", "restarting", false)).toBe(
      false,
    );
  });

  it("liveDownStateWithPadiLink: suppresses a stale kaval down claim while the padi link is not `connected`", () => {
    // This is what lets the WARMING arm win the canvas precedence over a padi drop:
    // without it a frozen re-served `degraded` would light DegradedCanvas (which beats
    // warming). Unknown ≠ down.
    expect(
      liveDownStateWithPadiLink("connecting", "degraded", true),
    ).toBeUndefined();
    expect(liveDownStateWithPadiLink("degraded", "dead", true)).toBeUndefined();
    expect(
      liveDownStateWithPadiLink(undefined, "degraded", true),
    ).toBeUndefined();
  });

  it("liveDownStateWithPadiLink: defers to the kaval down logic when the padi link is `connected` (a genuine kaval death over a live binding still surfaces)", () => {
    expect(liveDownStateWithPadiLink("connected", "dead", true)).toBe("dead");
    expect(liveDownStateWithPadiLink("connected", "degraded", true)).toBe(
      "degraded",
    );
    expect(
      liveDownStateWithPadiLink("connected", "connected", true),
    ).toBeUndefined();
    // Still floored on the browser transport leg too (both legs must be live).
    expect(
      liveDownStateWithPadiLink("connected", "dead", false),
    ).toBeUndefined();
  });
});
