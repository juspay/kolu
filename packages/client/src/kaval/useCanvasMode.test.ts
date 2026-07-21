/** Caller-level pin for the #1763 boot deadline (codex-debate F1). The pure resolver and
 *  the pure anchor map are pinned separately; this exercises `canvasMode` — the ONE memo
 *  that reads the anchor, resolves, and folds the frame back — against a MOVING monotonic
 *  clock, which is the only place the tick-ordering bug lived: during the Hole A membership
 *  stall `hostKeys()` is empty, and pruning on empty deleted the active host's own anchor
 *  every tick and reset its elapsed, so the ceiling never fired. Real resolver + real
 *  `bootDeadline` map; only `../wire`, `./useDaemonStatus`, and the clock are stubbed. */

import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  now: 0,
  entryKind: "not-a-member" as "not-a-member" | "connected" | "warming",
  members: [] as { kind: "local" }[],
  local: true,
  connInfo: undefined as { phase?: string; sinceMs?: number } | undefined,
}));

vi.mock("../wire", () => ({
  activeHost: () => LOCAL_HOST,
  connectionInfo: () => h.connInfo,
  hostKeys: () => h.members,
}));
vi.mock("../time/clock", () => ({
  getMonotonicNow: () => () => h.now,
}));
vi.mock("./useDaemonStatus", () => ({
  activeEntryState: () => ({ kind: h.entryKind }),
  daemonStatusPending: () => true,
  isActiveHostLocal: () => h.local,
  // connected-arm-only accessors — unread on the not-a-member arm, benign stubs:
  daemonChannelLive: () => true,
  daemonWarming: () => false,
  downState: () => undefined,
  localDaemonStatus: () => undefined,
}));

const { canvasMode } = await import("./useCanvasMode");
const { resetBootAnchors, CEILING_MS, CAMPAIGN_CEILING_MS } = await import(
  "./bootDeadline"
);

const deps = {
  isLoading: () => true,
  terminalCount: () => 0,
  recordsAwaited: () => 0,
};
/** One canvas-mode frame at monotonic time `t` (a memo tick). */
const frameAt = (t: number) => {
  h.now = t;
  return canvasMode(deps);
};

beforeEach(() => {
  resetBootAnchors();
  h.now = 0;
  h.entryKind = "not-a-member";
  h.members = [];
  h.local = true;
  h.connInfo = undefined;
});

describe("canvasMode — Hole A membership stall escapes past the deadline (codex-debate F1)", () => {
  it("holds `connecting` under the ceiling, then reaches boot-stalled(membership) once past it — the per-tick prune must NOT reset the anchor", () => {
    // Boot: local active, membership never snapshots (hostKeys() empty). Under the local ceiling
    // it holds the neutral connecting surface…
    expect(frameAt(0)).toEqual({ kind: "connecting" });
    expect(frameAt(5_000)).toEqual({ kind: "connecting" });
    expect(frameAt(20_000)).toEqual({ kind: "connecting" });
    // …and once the SAME episode passes the 30s local ceiling it escapes — the anchor accrued
    // across every 1s tick instead of being reset to `now` by the empty-membership prune.
    const escaped = frameAt(CEILING_MS.local + 1_000);
    expect(escaped).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "membership" },
    });
  });

  it("many intermediate ticks (the real 1s cadence) still accrue — elapsed is monotonic, not reset per tick", () => {
    for (let t = 0; t <= 29_000; t += 1_000) {
      expect(frameAt(t).kind).toBe("connecting");
    }
    expect(frameAt(31_000).kind).toBe("boot-stalled");
  });
});

describe("canvasMode — #1908 R8a campaign backstop escapes a persistently-wedged warming host", () => {
  it("holds `warming` under the campaign ceiling, then reaches the NON-terminal connector card once the server sinceMs passes it — even though the monotonic clock is nowhere near the class cell", () => {
    h.entryKind = "warming";
    h.local = false;
    // A warming REMOTE build: under the campaign ceiling (and only 1s of monotonic time, so the
    // 600s remote-provisioning class cell is nowhere near firing) → still narrating warming.
    h.connInfo = { phase: "building", sinceMs: CAMPAIGN_CEILING_MS - 1 };
    expect(frameAt(1_000)).toEqual({ kind: "warming", daemonState: undefined });
    // The server's whole-campaign sinceMs crosses the backstop — the class-blind escape fires
    // and routes to the connector-owned card (Retry connection), never the reload lie.
    h.connInfo = { phase: "building", sinceMs: CAMPAIGN_CEILING_MS + 1 };
    expect(frameAt(2_000)).toEqual({
      kind: "boot-stalled",
      recovery: { via: "connector", phase: "building" },
    });
    // Sanity: the class cell really was idle — remote-provisioning is 600s, we are at 2s.
    expect(CEILING_MS["remote-provisioning"]).toBeGreaterThan(2_000);
  });
});
