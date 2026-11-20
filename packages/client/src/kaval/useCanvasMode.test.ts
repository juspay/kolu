import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  now: 0,
  entryKind: "not-a-member" as "not-a-member" | "connected" | "warming",
  members: [] as { kind: "local" }[],
  local: true,
  connInfo: undefined as
    | {
        phase?: string;
        sinceMs?: number;
        log?: { source: "local" | "remote"; line: string }[];
      }
    | undefined,
  mapLive: true,
}));

vi.mock("../wire", () => ({
  activeHost: () => LOCAL_HOST,
  connectionInfo: () => (h.mapLive ? h.connInfo : undefined),
  hostKeys: () => h.members,
  padiMap: { live: () => h.mapLive },
}));
vi.mock("../time/clock", () => ({
  getMonotonicNow: () => () => h.now,
}));
vi.mock("./useDaemonStatus", () => ({
  activeEntryState: () =>
    h.mapLive || h.entryKind === "not-a-member"
      ? { kind: h.entryKind }
      : { kind: "unobservable", published: h.entryKind },
  daemonStatusPending: () => true,
  isActiveHostLocal: () => h.local,
  daemonChannelLive: () => true,
  daemonWarming: () => false,
  downState: () => undefined,
  localDaemonStatus: () => undefined,
}));

const { canvasMode } = await import("./useCanvasMode");
const { resetBootAnchors, CEILING_MS, CAMPAIGN_CEILING_MS } = await import(
  "./bootDeadline"
);
const { resetConnectTails } = await import("./connectTailClock");

const deps = {
  isLoading: () => true,
  terminalCount: () => 0,
  recordsAwaited: () => 0,
};
const frameAt = (t: number) => {
  h.now = t;
  return canvasMode(deps);
};

beforeEach(() => {
  resetBootAnchors();
  resetConnectTails();
  h.now = 0;
  h.entryKind = "not-a-member";
  h.members = [];
  h.local = true;
  h.connInfo = undefined;
  h.mapLive = true;
});

describe("canvasMode — Hole A membership stall escapes past the deadline (codex-debate F1)", () => {
  it("holds `connecting` under the ceiling, then reaches boot-stalled(membership) once past it — the per-tick prune must NOT reset the anchor", () => {
    expect(frameAt(0)).toEqual({ kind: "connecting" });
    expect(frameAt(5_000)).toEqual({ kind: "connecting" });
    expect(frameAt(20_000)).toEqual({ kind: "connecting" });
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
      expect(flap(t, phase).kind).toBe("warming");
    }
    expect(flap(CAMPAIGN_CEILING_MS + 100_000, "provisioning")).toEqual({
      kind: "boot-stalled",
      recovery: {
        via: "connector",
        phase: "provisioning",
        log: [],
        logAbsence: undefined,
        quiet: undefined,
      },
    });
  });
});

describe("canvasMode — the tail's absence carries a REASON, decided where the fact lives", () => {
  const stalledConnectorFrame = (dropLinkAfterEarning = false) => {
    h.entryKind = "warming";
    h.local = false;
    h.connInfo = undefined;
    frameAt(0);
    frameAt(CEILING_MS["remote-handshake"] + 1_000);
    if (dropLinkAfterEarning) h.mapLive = false;
    return frameAt(CEILING_MS["remote-handshake"] + 2_000);
  };

  it("a DEAD link makes the missing tail a link problem", () => {
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

describe("canvasMode — the stalled card is told how long the campaign has been silent", () => {
  it("the tail's last line and the time since it arrived ride the recovery, from the first frame that showed it", () => {
    h.entryKind = "warming";
    h.local = false;
    const copying = { source: "local" as const, line: "copying path 'x'…" };
    h.connInfo = {
      phase: "provisioning",
      log: [{ source: "local" as const, line: "pulling…" }],
    };
    frameAt(0);
    h.connInfo = {
      phase: "provisioning",
      log: [{ source: "local", line: "pulling…" }, copying],
    };
    frameAt(60_000);
    const past = CEILING_MS["remote-provisioning"] + 1_000;
    frameAt(past - 1_000);
    expect(frameAt(past)).toMatchObject({
      kind: "boot-stalled",
      recovery: {
        via: "connector",
        quiet: { lastLine: copying.line, silentMs: past - 60_000 },
      },
    });
  });
});

describe("the observability floor (#2129) — a lost server is not a failed boot", () => {
  const localWarming = () => {
    h.entryKind = "warming";
    h.local = true;
    h.members = [{ kind: "local" }];
  };
  const outage = () => {
    localWarming();
    h.mapLive = false;
  };

  it("a LOCAL entry floored to `unobservable` by the liveness floor never certifies the daemon dead", () => {
    outage();
    expect(frameAt(0)).toEqual({ kind: "connecting" });
    expect(frameAt(CEILING_MS.local + 60_000)).toEqual({ kind: "connecting" });
  });

  it("re-arms a FULL fresh window on reconnect rather than firing on the first live frame", () => {
    outage();
    frameAt(0);
    frameAt(CEILING_MS.local * 5);
    h.mapLive = true;
    expect(frameAt(CEILING_MS.local * 5 + 1)).toEqual({ kind: "connecting" });
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
    localWarming();
    frameAt(0);
    frameAt(1_000);
    h.mapLive = false;
    expect(frameAt(CEILING_MS.local * 20)).toEqual({ kind: "connecting" });
    h.mapLive = true;
    expect(frameAt(CEILING_MS.local * 20 + 1)).toEqual({ kind: "connecting" });
    expect(frameAt(CEILING_MS.local * 21 + 2)).toEqual({
      kind: "down",
      down: { state: "dead" },
    });
  });

  it("an earned verdict keeps the card it EARNED, even as the demotion rewrites the leg under it", () => {
    h.entryKind = "connected";
    h.local = true;
    h.members = [{ kind: "local" }];
    frameAt(0);
    const earned = frameAt(CEILING_MS.local + 1);
    expect(earned).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "session" },
    });
    h.mapLive = false;
    expect(frameAt(CEILING_MS.local + 2)).toEqual(earned);
  });

  it("an EARNED verdict still survives the link dropping under it — sampled, not recomputed", () => {
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

  it("an EARNED remote verdict survives a blip the outage itself would have re-classified", () => {
    h.entryKind = "warming";
    h.local = false;
    h.connInfo = { phase: "provisioning" };
    frameAt(0);
    expect(frameAt(CEILING_MS["remote-provisioning"] + 1_000)).toMatchObject({
      kind: "boot-stalled",
      recovery: { via: "connector" },
    });
    h.mapLive = false;
    expect(frameAt(CEILING_MS["remote-provisioning"] + 2_000)).toMatchObject({
      kind: "boot-stalled",
      recovery: { via: "connector" },
    });
    h.mapLive = true;
    expect(frameAt(CEILING_MS["remote-provisioning"] + 3_000)).toMatchObject({
      kind: "boot-stalled",
      recovery: { via: "connector" },
    });
  });
});
