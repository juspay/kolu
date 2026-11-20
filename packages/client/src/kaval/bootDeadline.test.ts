import { beforeEach, describe, expect, it } from "vitest";
import type { BootTag, CeilingClass, StalledLeg } from "./canvasModeResolver";
import {
  bootDeadlineExceeded,
  CAMPAIGN_CEILING_MS,
  CEILING_MS,
  LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS,
  pruneBootAnchors,
  recordBootFrame,
  resetBootAnchors,
  resetBootDeadline,
} from "./bootDeadline";

const LOCAL_MS = LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS;
const boot = (leg: StalledLeg, ceiling: CeilingClass): BootTag => ({
  accrual: "accrue",
  boot: {
    leg,
    ceiling,
    phase: undefined,
    log: [],
    logAbsence: undefined,
    quiet: undefined,
  },
});
const cleared: BootTag = { accrual: "clear" };
const retained: BootTag = { accrual: "retain" };

const watchedExceeded = (hostEnc: string, nowMs: number) =>
  bootDeadlineExceeded(hostEnc, nowMs, true);
const blindExceeded = (hostEnc: string, nowMs: number) =>
  bootDeadlineExceeded(hostEnc, nowMs, false);

beforeEach(() => resetBootAnchors());

describe("bootDeadline — ceiling table (R4, all finite)", () => {
  it("every class has a finite, positive ceiling", () => {
    for (const ms of Object.values(CEILING_MS)) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
    expect(CEILING_MS.local).toBe(30_000);
    expect(CEILING_MS["remote-provisioning"]).toBe(600_000);
    expect(CEILING_MS["remote-handshake"]).toBe(120_000);
  });
});

describe("bootDeadline — accrue / read (C1)", () => {
  it("a host with no anchor is never exceeded (a brief overlay under the ceiling holds neutral)", () => {
    expect(watchedExceeded("local", 10_000_000)).toBe(false);
  });

  it("accrues from the first boot frame and fires once past the class ceiling", () => {
    recordBootFrame("local", boot("membership", "local"), 0);
    expect(watchedExceeded("local", LOCAL_MS - 1)).toBe(false);
    expect(watchedExceeded("local", LOCAL_MS + 1)).toBe(true);
  });

  it("an escaped frame (raw tag still accrue, mode down/boot-stalled) keeps accruing — stays escaped", () => {
    recordBootFrame("local", boot("daemon", "local"), 0);
    recordBootFrame("local", boot("daemon", "local"), LOCAL_MS + 1);
    recordBootFrame("local", boot("membership", "local"), LOCAL_MS + 2);
    expect(watchedExceeded("local", LOCAL_MS + 3)).toBe(true);
  });
});

describe("bootDeadline — clear vs retain (C2)", () => {
  it("CLEARS on a `clear` tag (settled workspace/empty/down/host-failed) — late delivery un-wedges", () => {
    recordBootFrame("local", boot("session", "local"), 0);
    expect(watchedExceeded("local", LOCAL_MS + 1)).toBe(true);
    recordBootFrame("local", cleared, LOCAL_MS + 2);
    expect(watchedExceeded("local", 10_000_000)).toBe(false);
  });

  it("RETAINS on a `retain` tag (records / !channelLive / restart-warming) — no flap dodge", () => {
    recordBootFrame("local", boot("session", "local"), 0);
    recordBootFrame("local", retained, 5_000);
    recordBootFrame("local", retained, 6_000);
    expect(watchedExceeded("local", LOCAL_MS + 1)).toBe(true);
  });
});

describe("bootDeadline — ceiling-class transition re-anchors (R4 accrual per class)", () => {
  it("a long remote build does NOT instantly trip the shorter handshake cell", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0);
    expect(watchedExceeded("zest", 590_000)).toBe(false);
    recordBootFrame("zest", boot("daemon", "remote-handshake"), 590_000);
    expect(
      watchedExceeded("zest", 590_000 + CEILING_MS["remote-handshake"] - 1),
    ).toBe(false);
    expect(
      watchedExceeded("zest", 590_000 + CEILING_MS["remote-handshake"] + 1),
    ).toBe(true);
  });
});

describe("bootDeadline — campaign backstop (#1908 R8a, class-blind, client-monotonic)", () => {
  it("the campaign ceiling is finite and comfortably above the per-class table", () => {
    expect(Number.isFinite(CAMPAIGN_CEILING_MS)).toBe(true);
    for (const ms of Object.values(CEILING_MS)) {
      expect(CAMPAIGN_CEILING_MS).toBeGreaterThan(ms);
    }
    expect(CAMPAIGN_CEILING_MS).toBeGreaterThan(600_000);
  });

  it("a flapping phase that re-zeros the class anchor FOREVER still escapes once the MONOTONIC campaign clock passes the backstop — and the escape is the CAMPAIGN, not the class", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0);
    recordBootFrame("zest", boot("provisioning", "remote-handshake"), 100_000);
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-provisioning"),
      CAMPAIGN_CEILING_MS - 2,
    );
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS - 1)).toBe(false);
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(true);
  });

  it("the campaign anchor is HELD across class flips — not re-zeroed — even when the current class cell says fine", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0);
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-handshake"),
      1_700_000,
    );
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(true);
  });

  it("resetBootDeadline (the deliberate user Retry) clears BOTH cells, so a SAME-class retry dismisses the card at once — and a still-wedged retry escapes again after a fresh window (codex F1)", () => {
    recordBootFrame("zest", boot("provisioning", "remote-handshake"), 0);
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(true);
    resetBootDeadline("zest");
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS + 2)).toBe(false);
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-handshake"),
      CAMPAIGN_CEILING_MS + 2,
    );
    expect(
      watchedExceeded(
        "zest",
        CAMPAIGN_CEILING_MS + 2 + CAMPAIGN_CEILING_MS + 1,
      ),
    ).toBe(true);
  });

  it("a `clear` (settle) releases the campaign anchor — a provision that connects never trips it", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0);
    recordBootFrame("zest", cleared, 400_000);
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(false);
  });

  it("a `retain` frame (a CONNECTED-arm overlay — the connector campaign is over) clears the campaign anchor, so a later fresh warming campaign can't inherit the stale start (codex F7)", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0);
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-handshake"),
      CAMPAIGN_CEILING_MS - 100,
    );
    recordBootFrame("zest", retained, CAMPAIGN_CEILING_MS - 50);
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(false);
  });

  it("a non-`provisioning` boot leg after a provisioning one clears the campaign anchor (the connector campaign ended)", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0);
    recordBootFrame(
      "zest",
      boot("session", "remote-handshake"),
      CAMPAIGN_CEILING_MS - 100,
    );
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(false);
  });

  it("pruning a departed host drops its campaign anchor too", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0);
    pruneBootAnchors(["local"]);
    expect(watchedExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(false);
  });
});

describe("bootDeadline — host switches (R7) + no cross-host credit", () => {
  it("wedged→healthy: a healthy host with no anchor never false-fires off another host's wedge", () => {
    recordBootFrame("zest", boot("session", "remote-handshake"), 0);
    expect(watchedExceeded("zest", 10_000_000)).toBe(true);
    expect(watchedExceeded("local", 10_000_000)).toBe(false);
  });

  it("healthy→revisited-wedged: switching back does NOT earn fresh grace (same-class frame keeps the anchor)", () => {
    recordBootFrame("zest", boot("session", "remote-handshake"), 0);
    recordBootFrame("zest", boot("session", "remote-handshake"), 50_000);
    expect(watchedExceeded("zest", CEILING_MS["remote-handshake"] + 1)).toBe(
      true,
    );
  });
});

describe("bootDeadline — membership prune (fresh grace on re-add)", () => {
  it("prunes an anchor when its host leaves membership; a genuine re-add starts fresh", () => {
    recordBootFrame("zest", boot("session", "remote-handshake"), 0);
    expect(watchedExceeded("zest", 10_000_000)).toBe(true);
    pruneBootAnchors(["local"]);
    expect(watchedExceeded("zest", 10_000_000)).toBe(false);
    recordBootFrame("zest", boot("session", "remote-handshake"), 1_000_000);
    expect(
      watchedExceeded("zest", 1_000_000 + CEILING_MS["remote-handshake"] - 1),
    ).toBe(false);
  });

  it("removal-race: a host that is never the active host is never recorded, so it never spuriously times out", () => {
    expect(watchedExceeded("remote:never-active", 10_000_000)).toBe(false);
  });
});

describe("bootDeadline — the observability floor on the CLOCK (#2129)", () => {
  it("a ceiling crossed entirely while blind is never reached", () => {
    recordBootFrame("local", boot("daemon", "local"), 0);
    expect(watchedExceeded("local", 1_000)).toBe(false);
    expect(blindExceeded("local", LOCAL_MS * 100)).toBe(false);
  });

  it("a verdict EARNED while watching survives going blind (the AFP C6 exemption)", () => {
    recordBootFrame("local", boot("daemon", "local"), 0);
    expect(watchedExceeded("local", LOCAL_MS + 1)).toBe(true);
    expect(blindExceeded("local", LOCAL_MS + 2)).toBe(true);
  });

  it("the sample tracks the LATEST watched answer, including one walked back to false", () => {
    recordBootFrame("zest", boot("provisioning", "remote-handshake"), 0);
    expect(watchedExceeded("zest", CEILING_MS["remote-handshake"] + 1)).toBe(
      true,
    );
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-provisioning"),
      CEILING_MS["remote-handshake"] + 1,
    );
    expect(watchedExceeded("zest", CEILING_MS["remote-handshake"] + 2)).toBe(
      false,
    );
    expect(blindExceeded("zest", 10_000_000)).toBe(false);
  });

  it("a settled episode leaves no verdict for a later blind frame to resurrect", () => {
    recordBootFrame("local", boot("daemon", "local"), 0);
    expect(watchedExceeded("local", LOCAL_MS + 1)).toBe(true);
    recordBootFrame("local", cleared, LOCAL_MS + 2);
    expect(blindExceeded("local", LOCAL_MS + 3)).toBe(false);
  });

  it("a deliberate Retry drops the held verdict too, so the card cannot come straight back", () => {
    recordBootFrame("zest", boot("provisioning", "remote-handshake"), 0);
    expect(watchedExceeded("zest", CEILING_MS["remote-handshake"] + 1)).toBe(
      true,
    );
    resetBootDeadline("zest");
    expect(blindExceeded("zest", CEILING_MS["remote-handshake"] + 2)).toBe(
      false,
    );
  });

  it("prune takes the held verdict with the anchors, so a re-add inherits nothing", () => {
    recordBootFrame("zest", boot("session", "remote-handshake"), 0);
    expect(watchedExceeded("zest", 10_000_000)).toBe(true);
    pruneBootAnchors(["local"]);
    expect(blindExceeded("zest", 10_000_000)).toBe(false);
  });
});
