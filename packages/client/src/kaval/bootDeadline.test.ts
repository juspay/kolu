/** Pins the per-host boot-deadline anchor (#1763) — the caller-side ceiling that
 *  replaced the deleted daemon-only one. Pure map functions taking an explicit
 *  monotonic `now`, so the accrual/clear/prune rules (C2), the ceiling-class table
 *  (R4), and the switch/late-delivery behaviours (R7) are pinned without a live
 *  clock or Solid owner. The removal-race property the deleted per-host-wire anchor
 *  used to pin ("no active host ⇒ no spurious timeout") is here too — it holds by
 *  construction because the anchor keys off `activeHost()`, which is never undefined. */

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
} from "./bootDeadline";

const LOCAL_MS = LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS;
// Typed with the accrue variant's own field types (F4) — a leg/ceiling typo, or a future
// union change, fails at compile time instead of being cast away. `phase` is irrelevant to
// the anchor mechanics this file pins (it only drives the escape surface's rendered copy,
// pinned in canvasModeResolver.test.ts instead), so every fixture here fixes it `undefined`.
const boot = (leg: StalledLeg, ceiling: CeilingClass): BootTag => ({
  accrual: "accrue",
  leg,
  ceiling,
  phase: undefined,
});
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

describe("bootDeadline — campaign backstop (#1908 R8a, class-blind, client-monotonic)", () => {
  it("the campaign ceiling is finite and comfortably above the per-class table", () => {
    expect(Number.isFinite(CAMPAIGN_CEILING_MS)).toBe(true);
    // Above the 600s remote-provisioning cell (and every other class cell) with real margin —
    // a genuinely-progressing provision settles + clears well under it.
    for (const ms of Object.values(CEILING_MS)) {
      expect(CAMPAIGN_CEILING_MS).toBeGreaterThan(ms);
    }
    expect(CAMPAIGN_CEILING_MS).toBeGreaterThan(600_000);
  });

  it("a flapping phase that re-zeros the class anchor FOREVER still escapes once the MONOTONIC campaign clock passes the backstop — and the escape is the CAMPAIGN, not the class", () => {
    // The R8a hole: PR1's retry cycle flaps a warming host's phase, so every class change
    // re-anchors the class cell (zero-credit) and it NEVER trips on its own. Every frame is the
    // connector-owned `provisioning` leg, so the campaign cell is armed ONCE at t=0 and HELD.
    // `sinceMs` tracks `nowMs` (a campaign observed from ~its start, no reset).
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0, 0);
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-handshake"),
      100_000,
      100_000,
    );
    // Re-anchor the class cell just BELOW the campaign ceiling (the flap keeps re-zeroing it):
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-provisioning"),
      CAMPAIGN_CEILING_MS - 2,
      CAMPAIGN_CEILING_MS - 2,
    );
    // Just under the campaign ceiling: campaign not yet past, class freshly re-anchored → neither.
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS - 1)).toBe(false);
    // One tick past the campaign ceiling: the class cell has accrued only 3ms against its 600s
    // cell (idle), so the escape is UNAMBIGUOUSLY the class-blind campaign backstop.
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(true);
  });

  it("the campaign anchor is HELD across class flips — not re-zeroed — even when the current class cell says fine", () => {
    // Arm at t=0, flap the class at 28m. If the campaign re-anchored on that flip it would need
    // another 30m; because it is HELD from t=0 it fires at 30m + a tick, while the class cell
    // (re-anchored at 28m, 120s handshake cell) is nowhere near its own ceiling.
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0, 0);
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-handshake"),
      1_700_000,
      1_700_000,
    );
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(true);
  });

  it("a campaign first observed already-old (large `sinceMs` — a page reload mid-campaign) is anchored to its REAL start, firing soon — not granted a fresh full 30min (codex F1)", () => {
    const alreadyOld = CAMPAIGN_CEILING_MS - 60_000; // the server says it has already run 29 min
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-provisioning"),
      5_000,
      alreadyOld,
    );
    // From its REAL start it has ~29 min on the clock, so it fires ~1 min after first observation…
    expect(bootDeadlineExceeded("zest", 5_000 + 60_000 - 1)).toBe(false);
    expect(bootDeadlineExceeded("zest", 5_000 + 60_000 + 1)).toBe(true);
  });

  it("a fresh server campaign (`sinceMs` reset — Retry connection / recheck) re-anchors, so the retry earns a FRESH window and the card dismisses (codex F1)", () => {
    // A campaign observed from ~its start, run past the ceiling → the connector card is showing:
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-provisioning"),
      1_000,
      1_000,
    );
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(true);
    // The user hits Retry connection → recheck() begins a fresh server campaign → the next frame's
    // `sinceMs` DROPS back to ~0 (below the last ~30 min). The client re-anchors on the reset, so
    // the escape must DISMISS — the recovery verb genuinely recovers rather than re-showing at once.
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-handshake"),
      CAMPAIGN_CEILING_MS + 2,
      0,
    );
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS + 3)).toBe(false);
  });

  it("a `clear` (settle) releases the campaign anchor — a provision that connects never trips it", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0, 0);
    recordBootFrame("zest", cleared, 400_000); // connected well under the ceiling
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(false);
  });

  it("a `retain` frame (a CONNECTED-arm overlay — the connector campaign is over) clears the campaign anchor, so a later fresh warming campaign can't inherit the stale start (codex F7)", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0, 0);
    // Class-flip near the ceiling so the class cell is freshly re-anchored (isolating the campaign):
    recordBootFrame(
      "zest",
      boot("provisioning", "remote-handshake"),
      CAMPAIGN_CEILING_MS - 100,
      CAMPAIGN_CEILING_MS - 100,
    );
    // The connector connects into a records-awaited / restart-warming connected overlay → retain:
    recordBootFrame("zest", retained, CAMPAIGN_CEILING_MS - 50);
    // With the campaign cleared, one tick past the old 30-min mark does NOT fire (class still fresh);
    // without the F7 fix the stale campaign start from t=0 would fire here.
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(false);
  });

  it("a non-`provisioning` boot leg after a provisioning one clears the campaign anchor (the connector campaign ended)", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0, 0);
    // Connected-but-session-pending near the 30-min mark → a client-side `session` leg (a class
    // CHANGE, so its short class re-anchors fresh), and the campaign cell drops:
    recordBootFrame(
      "zest",
      boot("session", "remote-handshake"),
      CAMPAIGN_CEILING_MS - 100,
    );
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(false);
  });

  it("pruning a departed host drops its campaign anchor too", () => {
    recordBootFrame("zest", boot("provisioning", "remote-provisioning"), 0, 0);
    pruneBootAnchors(["local"]);
    expect(bootDeadlineExceeded("zest", CAMPAIGN_CEILING_MS + 1)).toBe(false);
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
