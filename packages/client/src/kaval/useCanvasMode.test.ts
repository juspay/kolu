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
  // The map's OWN transport liveness — the very value `floorOnLiveness` is handed, and
  // the one fact that separates "the floor dropped the live word" from "no frame yet"
  // when `connInfo` is undefined. Live by default: every pin below is about the boot
  // deadline, not about a dead link.
  mapLive: true,
}));

vi.mock("../wire", () => ({
  activeHost: () => LOCAL_HOST,
  connectionInfo: () => h.connInfo,
  hostKeys: () => h.members,
  padiMap: { live: () => h.mapLive },
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
  h.mapLive = true;
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
  it("a warming-remote campaign whose FLAPPING phase re-zeros the class anchor forever still reaches the NON-terminal connector card once the client-MONOTONIC campaign clock passes the backstop", () => {
    h.entryKind = "warming";
    h.local = false;
    // One frame at monotonic time `t` with connect `phase` — the phase flaps provisioning↔connecting
    // each frame so the class cell re-anchors every tick (remote-provisioning↔remote-handshake)
    // and NEVER reaches its own ceiling. Every frame is the connector-owned `provisioning` leg,
    // so the campaign cell is armed once at t=0 and HELD.
    const flap = (t: number, phase: "provisioning" | "connecting") => {
      h.connInfo = { phase };
      return frameAt(t);
    };
    expect(flap(0, "provisioning")).toEqual({
      kind: "warming",
      daemonState: undefined,
    });
    for (let t = 100_000; t < CAMPAIGN_CEILING_MS; t += 100_000) {
      const phase = (t / 100_000) % 2 === 0 ? "provisioning" : "connecting";
      // The class cell keeps re-zeroing on each flap and the campaign is still under ceiling →
      // it holds the neutral warming surface the whole way, never escaping via the class cell.
      expect(flap(t, phase).kind).toBe("warming");
    }
    // Past the client-monotonic campaign backstop → the non-terminal connector card (Retry
    // connection), never the reload lie. The class cell was freshly re-anchored ~100s ago.
    expect(flap(CAMPAIGN_CEILING_MS + 100_000, "provisioning")).toEqual({
      kind: "boot-stalled",
      recovery: {
        via: "connector",
        phase: "provisioning",
        log: [],
        logAbsence: undefined,
      },
    });
  });
});

describe("canvasMode — the tail's absence carries a REASON, decided where the fact lives", () => {
  // The card used to derive "kolu's link to this browser went quiet" from a bare
  // `log === undefined`. Two different situations produce a missing connection frame —
  // the map's liveness floor DROPPED the live word, or no frame has landed yet — and only
  // one of them is a link problem. This is the seam that can tell them apart, because it
  // is the one place that holds both the cell read and `padiMap.live()` (the very value
  // `floorOnLiveness` is handed). Everything downstream carries the verdict; nothing
  // downstream re-derives it.
  const stalledConnectorFrame = () => {
    h.entryKind = "warming";
    h.local = false;
    // No connection frame at all — the case under test. The leg is the connector-owned
    // `provisioning` (warming + remote), under the `remote-handshake` ceiling.
    h.connInfo = undefined;
    frameAt(0); // arm the anchor
    return frameAt(CEILING_MS["remote-handshake"] + 1_000);
  };

  it("a DEAD link makes the missing tail a link problem", () => {
    h.mapLive = false;
    expect(stalledConnectorFrame()).toMatchObject({
      kind: "boot-stalled",
      recovery: { via: "connector", log: [], logAbsence: "link-down" },
    });
  });

  it("a LIVE link with no frame yet claims NOTHING about the link", () => {
    h.mapLive = true;
    expect(stalledConnectorFrame()).toMatchObject({
      kind: "boot-stalled",
      recovery: { via: "connector", log: [], logAbsence: undefined },
    });
  });
});
