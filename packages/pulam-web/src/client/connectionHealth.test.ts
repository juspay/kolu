/**
 * `effectiveHealth` — the transport-vs-mirror precedence matrix.
 *
 * pulam-web has TWO independently-failing links: the browser↔backend ws
 * (transport `status`) and the backend↔remote mirror (the `connection` cell).
 * `effectiveHealth` folds both into ONE resolved health that the header dot AND
 * the body gate read, so they can't disagree about whether a host is up. The
 * precedence is load-bearing: "transport trouble shadows the mirror" (a dead ws
 * makes the mirror cell stale), and a transport-shadowed `failed` must carry
 * `source: "transport"` so the FailedCard + a Reconnect-that-can't-run never
 * paint over a dashboard-socket drop. This file pins that matrix — a regression
 * in the precedence or `source` tagging would reintroduce the stale/empty UI the
 * cell exists to prevent, and the cell-value test alone wouldn't catch it.
 */

import type { ConnectionInfo } from "@kolu/surface-nix-host/connection";
import { describe, expect, it } from "vitest";
import { effectiveHealth } from "./connectionHealth.ts";

const info = (over: Partial<ConnectionInfo> = {}): ConnectionInfo => ({
  state: "connected",
  lastError: null,
  failureCause: null,
  progressLines: [],
  ...over,
});

describe("effectiveHealth — transport × mirror matrix", () => {
  it("transport DOWN shadows the mirror — failed/transport even if the mirror reads connected", () => {
    const h = effectiveHealth("down", info({ state: "connected" }));
    expect(h.state).toBe("failed");
    expect(h.source).toBe("transport");
    // Not the mirror's "Remote connection failed" — the dashboard-socket message.
    expect(h.message).toMatch(/dashboard/i);
  });

  it("transport RECONNECTING shadows the mirror — disconnected/transport, pending", () => {
    const h = effectiveHealth("reconnecting", info({ state: "connected" }));
    expect(h.state).toBe("disconnected");
    expect(h.source).toBe("transport");
    expect(h.pending).toBe(true);
  });

  it("transport LIVE → the mirror is the real signal (source: mirror)", () => {
    for (const state of ["connected", "connecting", "copying"] as const) {
      const h = effectiveHealth("live", info({ state }));
      expect(h.state).toBe(state);
      expect(h.source).toBe("mirror");
    }
  });

  it("transport CONNECTING (pipe coming up) still lets the mirror decide", () => {
    const h = effectiveHealth("connecting", info({ state: "connected" }));
    expect(h.state).toBe("connected");
    expect(h.source).toBe("mirror");
  });

  it("a REAL mirror failure (transport live) is source: mirror — the FailedCard case", () => {
    // This is the ONLY combination that should paint the error card + a live
    // Reconnect button: the pipe is up, the host itself gave up.
    const h = effectiveHealth(
      "live",
      info({ state: "failed", lastError: "exited with code 1" }),
    );
    expect(h.state).toBe("failed");
    expect(h.source).toBe("mirror");
  });

  it("a transport-down host whose STALE mirror cell still reads failed stays source: transport", () => {
    // The trap the `source` tag closes: both resolve to `state: "failed"`, but
    // only the mirror one may show the error card + Reconnect.
    const h = effectiveHealth("down", info({ state: "failed" }));
    expect(h.state).toBe("failed");
    expect(h.source).toBe("transport");
  });
});
