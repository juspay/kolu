import type { DaemonState } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  DAEMON_STATE_PRESENTATION,
  DAEMON_UNKNOWN_DOT,
  kavalDot,
  toneDot,
} from "./daemonPresentation";

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
    for (const state of Object.keys(DAEMON_STATE_PRESENTATION) as DaemonState[]) {
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
