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
  // THE ONE liveness knob: the map's OWN transport liveness — the very value
  // `floorOnLiveness` is handed. `canvasMode` reads it once and feeds BOTH consumers, so
  // one flag models the one physical fact: it separates "the floor dropped the live word"
  // from "no frame yet" when `connInfo` is undefined, AND it is the #2129 observability
  // floor's input. Live by default: every pin below is about a boot that genuinely
  // stalled, not about a browser that lost the server; the outage pins flip this one flag.
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
  /** Arm the connector campaign's anchor, CROSS its ceiling over a live link, then return a
   *  later frame — dropping the link in between when asked, so a test can lose the server only
   *  AFTER the verdict was earned. Crossing live is not decoration: under the #2129 floor it is
   *  the ONLY way a verdict is ever reached (`bootDeadlineExceeded` samples-and-holds on the same
   *  liveness), so a helper that crossed while blind would pin a frame production cannot make. */
  const stalledConnectorFrame = (dropLinkAfterEarning = false) => {
    h.entryKind = "warming";
    h.local = false;
    // No connection frame at all — the case under test. The leg is the connector-owned
    // `provisioning` (warming + remote), under the `remote-handshake` ceiling.
    h.connInfo = undefined;
    frameAt(0); // arm the anchor, link live
    frameAt(CEILING_MS["remote-handshake"] + 1_000); // EARN the verdict, link live
    if (dropLinkAfterEarning) h.mapLive = false;
    return frameAt(CEILING_MS["remote-handshake"] + 2_000);
  };

  it("a DEAD link makes the missing tail a link problem", () => {
    // The link drops only AFTER the ceiling was earned — the AFP C6 exemption, and the
    // only path to this frame now that one fact drives both the map floor and the boot
    // floor: while the link is down no NEW verdict can be reached, so a card showing
    // `link-down` is always one this browser earned while it could still see the server.
    expect(stalledConnectorFrame(true)).toMatchObject({
      kind: "boot-stalled",
      recovery: { via: "connector", log: [], logAbsence: "link-down" },
    });
  });

  it("a LIVE link with no frame yet claims NOTHING about the link", () => {
    expect(stalledConnectorFrame()).toMatchObject({
      kind: "boot-stalled",
      recovery: { via: "connector", log: [], logAbsence: undefined },
    });
  });
});

describe("the observability floor (#2129) — a lost server is not a failed boot", () => {
  // THE FIELD BUG, reproduced at the caller with the real resolver, the real anchor map,
  // and a moving clock — the only level at which the whole path is visible. The story
  // itself is told ONCE, in `canvasModeResolver.ts`'s module header.
  //
  // ONE flag models the outage, which is the point: the link fact is read once in
  // `canvasMode` and feeds both the map floor's `link-down` reason and the #2129
  // observability floor, so a test cannot model an outage the production code could
  // disagree about.
  /** A local host mid-boot with membership snapshotted — the arrangement every pin below
   *  shares, so the ONE fact that distinguishes them (`h.mapLive`) stands alone at each site
   *  instead of being buried in a repeated block. */
  const localWarming = () => {
    h.entryKind = "warming";
    h.local = true;
    h.members = [{ kind: "local" }];
  };
  /** …the same host, seen by a browser that has lost the server. */
  const outage = () => {
    localWarming();
    h.mapLive = false;
  };

  it("a LOCAL entry demoted to `warming` by the liveness floor never certifies the daemon dead", () => {
    outage();
    // The neutral boot surface (this harness pins `isLoading` true, so the warming arm's
    // residual gate holds `connecting` — the point is the SURFACE never changes).
    expect(frameAt(0)).toEqual({ kind: "connecting" });
    // Long past the LOCAL ceiling it is STILL that surface — we cannot see the server, so
    // we make no claim about its daemon. Before the floor this frame was the dead card.
    expect(frameAt(CEILING_MS.local + 60_000)).toEqual({ kind: "connecting" });
  });

  it("re-arms a FULL fresh window on reconnect rather than firing on the first live frame", () => {
    // Why the floor RELEASES the anchor instead of holding it: a held anchor would carry
    // the whole outage's elapsed across the reconnect, so the brief window where the socket
    // is back but the snapshot hasn't landed would read `exceeded` and flash the dead card
    // anyway — the same lie, just shorter.
    outage();
    frameAt(0);
    frameAt(CEILING_MS.local * 5);
    // The socket returns; the entry is still warming while the first snapshot lands.
    h.mapLive = true;
    expect(frameAt(CEILING_MS.local * 5 + 1)).toEqual({ kind: "connecting" });
    // A genuinely wedged daemon still escapes — but only after a full fresh ceiling
    // measured from the reconnect, never from the outage.
    expect(frameAt(CEILING_MS.local * 6 + 2)).toEqual({
      kind: "down",
      down: { state: "dead" },
    });
  });

  it("still escapes normally when the link is LIVE — the floor guards observability, not the deadline", () => {
    localWarming();
    frameAt(0);
    expect(frameAt(CEILING_MS.local + 1)).toEqual({
      kind: "down",
      down: { state: "dead" },
    });
  });

  it("a ceiling crossed entirely by a FROZEN tab is not a verdict — no frame ran to watch it", () => {
    // The floor's other half, and the case releasing the anchor per-frame CANNOT cover: a tab
    // frozen mid-boot runs NO frames, so there is no accrue frame to release anything. It wakes
    // with its socket already gone and an elapsed far past the ceiling — every millisecond of it
    // unwatched. Subtracting `now - anchor` here would certify a stall this browser never saw:
    // #2129's exact shape, reached through the clock instead of through a frame.
    localWarming();
    frameAt(0); // arm the anchor, link live, well under the ceiling
    frameAt(1_000);
    // …the tab freezes. The socket dies during the freeze; the next frame is the wake-up.
    h.mapLive = false;
    expect(frameAt(CEILING_MS.local * 20)).toEqual({ kind: "connecting" });
    // And the wake-up frame released the anchor, so the reconnect measures a FULL fresh window
    // rather than firing on the elapsed nobody watched.
    h.mapLive = true;
    expect(frameAt(CEILING_MS.local * 20 + 1)).toEqual({ kind: "connecting" });
    expect(frameAt(CEILING_MS.local * 21 + 2)).toEqual({
      kind: "down",
      down: { state: "dead" },
    });
  });

  it("an EARNED verdict still survives the link dropping under it — sampled, not recomputed", () => {
    // The AFP C6 exemption at the caller, where `exceeded` is real: cross the ceiling while the
    // link is live, then lose it. The held sample keeps the card — and its Restart button — on
    // screen, which is the whole reason the exemption exists.
    localWarming();
    frameAt(0);
    expect(frameAt(CEILING_MS.local + 1)).toEqual({
      kind: "down",
      down: { state: "dead" },
    });
    h.mapLive = false;
    expect(frameAt(CEILING_MS.local * 10)).toEqual({
      kind: "down",
      down: { state: "dead" },
    });
  });
});
