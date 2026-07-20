/** Pins the per-host boot-deadline anchor (#1763) — the caller-side ceiling that
 *  replaced the deleted daemon-only one. Pure map functions taking an explicit
 *  monotonic `now`, so the accrual/clear/prune rules (C2), the ceiling-class table
 *  (R4), and the switch/late-delivery behaviours (R7) are pinned without a live
 *  clock or Solid owner. The removal-race property the deleted per-host-wire anchor
 *  used to pin ("no active host ⇒ no spurious timeout") is here too — it holds by
 *  construction because the anchor keys off `activeHost()`, which is never undefined. */

import { beforeEach, describe, expect, it } from "vitest";
import type { BootTag } from "./canvasModeResolver";
import {
  bootDeadlineExceeded,
  CEILING_MS,
  LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS,
  pruneBootAnchors,
  recordBootFrame,
  resetBootAnchors,
} from "./bootDeadline";

const LOCAL_MS = LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS;
const boot = (leg: string, ceiling: string): BootTag =>
  ({ accrual: "accrue", leg, ceiling }) as BootTag;
/** A settled surface (workspace/empty/down/host-failed) — releases the anchor. */
const cleared: BootTag = { accrual: "clear" };
/** A non-boot overlay the deadline must ignore — holds the anchor without accruing. */
const retained: BootTag = { accrual: "retain" };

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
    expect(bootDeadlineExceeded("local", 10_000_000)).toBe(false);
  });

  it("accrues from the first boot frame and fires once past the class ceiling", () => {
    recordBootFrame("local", boot("membership", "local"), 0);
    expect(bootDeadlineExceeded("local", LOCAL_MS - 1)).toBe(false);
    expect(bootDeadlineExceeded("local", LOCAL_MS + 1)).toBe(true);
  });

  it("an escaped frame (raw tag still accrue, mode down/boot-stalled) keeps accruing — stays escaped", () => {
    recordBootFrame("local", boot("daemon", "local"), 0);
    // deadline passed → the wrapper escaped; the caller records the escaped frame (tag stays accrue):
    recordBootFrame("local", boot("daemon", "local"), LOCAL_MS + 1);
    recordBootFrame("local", boot("membership", "local"), LOCAL_MS + 2);
    expect(bootDeadlineExceeded("local", LOCAL_MS + 3)).toBe(true);
  });
});

describe("bootDeadline — clear vs retain (C2)", () => {
  it("CLEARS on a `clear` tag (settled workspace/empty/down/host-failed) — late delivery un-wedges", () => {
    recordBootFrame("local", boot("session", "local"), 0);
    expect(bootDeadlineExceeded("local", LOCAL_MS + 1)).toBe(true);
    // the hung session leg finally delivers → resolvePrecedence settles to workspace (clear):
    recordBootFrame("local", cleared, LOCAL_MS + 2);
    expect(bootDeadlineExceeded("local", 10_000_000)).toBe(false);
  });

  it("RETAINS on a `retain` tag (records / !channelLive / restart-warming) — no flap dodge", () => {
    recordBootFrame("local", boot("session", "local"), 0);
    // a retain overlay frame flickers by (records-awaited connecting):
    recordBootFrame("local", retained, 5_000);
    // …and a kaval-restart warming (also retain):
    recordBootFrame("local", retained, 6_000);
    // the anchor is NOT reset — the ceiling still fires from the original t=0.
    expect(bootDeadlineExceeded("local", LOCAL_MS + 1)).toBe(true);
  });
});

describe("bootDeadline — ceiling-class transition re-anchors (R4 accrual per class)", () => {
  it("a long remote build does NOT instantly trip the shorter handshake cell", () => {
    // ~10 min of provisioning (600s cell) — not yet exceeded at 9m50s:
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0);
    expect(bootDeadlineExceeded("zest", 590_000)).toBe(false);
    // class transitions to the handshake (probing/connecting) → re-anchor at 590s, zero-credit:
    recordBootFrame("zest", boot("daemon", "remote-handshake"), 590_000);
    expect(
      bootDeadlineExceeded(
        "zest",
        590_000 + CEILING_MS["remote-handshake"] - 1,
      ),
    ).toBe(false);
    expect(
      bootDeadlineExceeded(
        "zest",
        590_000 + CEILING_MS["remote-handshake"] + 1,
      ),
    ).toBe(true);
  });
});

describe("bootDeadline — host switches (R7) + no cross-host credit", () => {
  it("wedged→healthy: a healthy host with no anchor never false-fires off another host's wedge", () => {
    recordBootFrame("zest", boot("session", "remote-handshake"), 0);
    expect(bootDeadlineExceeded("zest", 10_000_000)).toBe(true);
    // switch to a healthy local — it has no anchor of its own:
    expect(bootDeadlineExceeded("local", 10_000_000)).toBe(false);
  });

  it("healthy→revisited-wedged: switching back does NOT earn fresh grace (same-class frame keeps the anchor)", () => {
    recordBootFrame("zest", boot("session", "remote-handshake"), 0);
    // switch away (record other hosts / nothing for zest) … then switch BACK, still the same
    // wedged class — recordBootFrame keeps the ORIGINAL anchor (no re-anchor on same class):
    recordBootFrame("zest", boot("session", "remote-handshake"), 50_000);
    expect(
      bootDeadlineExceeded("zest", CEILING_MS["remote-handshake"] + 1),
    ).toBe(true);
  });
});

describe("bootDeadline — membership prune (fresh grace on re-add)", () => {
  it("prunes an anchor when its host leaves membership; a genuine re-add starts fresh", () => {
    recordBootFrame("zest", boot("session", "remote-handshake"), 0);
    expect(bootDeadlineExceeded("zest", 10_000_000)).toBe(true);
    // zest leaves the pool — only local remains:
    pruneBootAnchors(["local"]);
    expect(bootDeadlineExceeded("zest", 10_000_000)).toBe(false);
    // a genuine re-add re-anchors fresh from its new boot frame:
    recordBootFrame("zest", boot("session", "remote-handshake"), 1_000_000);
    expect(
      bootDeadlineExceeded(
        "zest",
        1_000_000 + CEILING_MS["remote-handshake"] - 1,
      ),
    ).toBe(false);
  });

  it("removal-race: a host that is never the active host is never recorded, so it never spuriously times out", () => {
    // The caller keys the anchor off `activeHost()` (always defined). A host that was never
    // active has no anchor and so is never exceeded — the property the deleted per-host-wire
    // anchor pinned, now holding by construction.
    expect(bootDeadlineExceeded("remote:never-active", 10_000_000)).toBe(false);
  });
});
