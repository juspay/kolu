/** The boot-deadline anchor (#1763) — the caller-side half of the canvas boot ceiling.
 *
 *  `canvasModeResolver` decides WHICH surface wins and tags a boot overlay; THIS module
 *  decides WHEN a boot overlay has been up too long. It replaces the deleted daemon-only
 *  ceiling (`daemonPendingAnchorMs` in the per-host wire scope + `daemonStatusPendingTimedOut`
 *  + `isPendingTimedOut`), which could only ever fire for the daemon leg and only while
 *  `activeScope()` was defined — so a hung MEMBERSHIP leg (activeScope undefined, no anchor)
 *  or a hung SESSION leg (daemon already delivered) span the connect overlay forever.
 *
 *  ── One per-host episode anchor, app-lifetime, keyed by the ACTIVE host ──────────
 *  A module-lifetime `Map` keyed by `encodeHostKey(activeHost())`. `activeHost()` is ALWAYS
 *  defined — even during the membership stall where `activeScope()` is undefined — so the
 *  membership-leg boot still anchors (under `"local"`), which is what fixes Hole A
 *  STRUCTURALLY: the anchor no longer lives inside the per-host scope that the stall starves.
 *
 *  Retained across host switches (a revisited wedged host must NOT earn fresh grace — the
 *  deleted per-host-wire anchor's documented property, preserved here); pruned when a host
 *  leaves membership (a genuine re-add earns a fresh episode). No cross-host crediting — the
 *  map is per-host, so host B never reads host A's anchor.
 *
 *  ── One resolve per frame, no reactive cycle (C1) ───────────────────────────────
 *  The `useCanvasMode` memo, in ONE evaluation: reads the stored anchor → computes `exceeded`
 *  from PRIOR accrual ({@link bootDeadlineExceeded}) → runs the ONE `resolveCanvasMode` →
 *  writes the frame's tag back ({@link recordBootFrame}). `exceeded` is derived from the
 *  prior frame's stored class, so a ceiling-CLASS transition (build→handshake, remote→local)
 *  uses the old class for ≤1 tick (≤1s, self-correcting) — an accepted edge, only reachable
 *  after an escape was already showing.
 *
 *  ── Monotonic clock ─────────────────────────────────────────────────────────────
 *  Elapsed rides a MONOTONIC source (`getMonotonicNow` in `time/clock.ts`, `performance.now`), not the
 *  wall clock — so an NTP step / clock change can't false-fire the ceiling. Residual: the page
 *  is frozen during OS suspend (no accrual WHILE suspended), but a boot overlay spanning a long
 *  suspend sees the real elapsed on resume and may escape immediately to the honest
 *  boot-stalled card (Reload recovers). Same jump the wall clock would have; bounded, honest. */

import { match } from "ts-pattern";
import type { BootTag, CeilingClass } from "./canvasModeResolver";

/** The LOCAL connect ceiling — mirrors `makeSession`'s default `connectTimeoutMs`, the
 *  local padi session's own connect-watchdog ceiling (client and server are separate
 *  packages; they need only agree on order of magnitude). Exported (was module-private in
 *  `useDaemonStatus.ts`, R6) so the ceiling table and its exhaustive test can name it. */
export const LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS = 30_000;

/** The FULL, all-FINITE ceiling table (#1763 R4). Every cell is bounded — an unbounded cell
 *  would recreate the no-escape class inside the fix (a link-live frozen `building` would
 *  never escape). A remote's ssh dial + nix copy + build legitimately outlasts the local
 *  ceiling, so provisioning gets a generous minutes-scale cell; a remote handshake
 *  (probing/connecting/pre-frame) a shorter but still finite one. */
export const CEILING_MS: Record<CeilingClass, number> = {
  local: LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS,
  "remote-provisioning": 600_000,
  "remote-handshake": 120_000,
};

/** The CAMPAIGN backstop ceiling (#1908 R8a) — a SECOND, class-BLIND cell above the per-class
 *  table. PR1's D1 retry cycle can flap a warming host's phase (probing→copying→building→retry)
 *  fast enough that the class anchor above re-zeros on every class change and so NEVER trips —
 *  the escape card would never fire for a persistently-wedged host. This bound is anchored ONCE
 *  per connector campaign (the `provisioning` leg — the whole warming-remote coming-up campaign),
 *  held across every class flip, and measured on the SAME client MONOTONIC clock the per-class
 *  cell uses — NOT the server's `sinceMs`. `sinceMs` is unfit as a deadline source: it is
 *  stamped only when `makeSession` publishes a frame (so it FREEZES during a silent wedge — the
 *  very case this must catch) and it is `Date.now()`-derived (so an NTP step could false-fire it,
 *  the exact wall-clock hazard the per-class cell's monotonic clock deliberately avoids). A
 *  client-monotonic campaign anchor has neither flaw and needs no wire fact. 30min: comfortably
 *  above the 600s remote-provisioning cell AND above the server's own retry grants (R8b's 20min
 *  pre-connected no-progress backstop; R4's ≤16min per-step budget) — so a genuinely-progressing
 *  cold provision (which settles to `connected` and CLEARS well under this) never false-fires;
 *  only a campaign that has NOT settled for a solid half hour reaches it. */
export const CAMPAIGN_CEILING_MS = 1_800_000;

interface Anchor {
  /** Monotonic ms when THIS ceiling-class episode began for this host. */
  anchorMs: number;
  /** The class the elapsed accrues against — a class change re-anchors (zero-credit),
   *  so a 10-minute build never instantly trips the 30s local cell. */
  ceiling: CeilingClass;
}

/** The per-host episode anchors — module-lifetime, keyed by encoded active host. */
const anchors = new Map<string, Anchor>();

/** The per-host CAMPAIGN anchors (#1908 R8a): monotonic ms when this host's connector-owned
 *  (`provisioning` leg) warming campaign began. Set ONCE when the campaign starts and HELD across
 *  every class flip (unlike {@link anchors}, which re-anchors per class), so a flapping phase
 *  cannot re-zero it; deleted the instant the entry stops being a connector campaign (settles, or
 *  any non-`provisioning` boot leg). Separate from {@link anchors} so the two lifecycles — per-class
 *  re-anchoring vs held-once-per-campaign — never entangle. */
const campaignAnchors = new Map<string, number>();

/** Step 1 (read): is the active host's boot overlay past EITHER ceiling? Two independent cells,
 *  OR-ed (#1908 R8a), both on the SAME monotonic `nowMs`:
 *   - the per-CLASS anchor (C1 — computed from the PRIOR frame's stored class; the ≤1-tick lag
 *     is the accepted, self-correcting edge). A host with no stored anchor (never a boot overlay,
 *     or already settled+cleared) is not exceeded this way — a brief overlay under the ceiling
 *     holds the neutral surface, exactly as before.
 *   - the class-BLIND CAMPAIGN backstop: the connector campaign's monotonic start
 *     ({@link campaignAnchors}, armed by {@link recordBootFrame} off the `provisioning` leg) past
 *     {@link CAMPAIGN_CEILING_MS}. This is what still fires when a flapping phase re-zeros the
 *     class anchor forever — and, being client-monotonic, it keeps advancing even if the server
 *     stops publishing frames (a silent wedge) and can't be jolted by a wall-clock step. */
export function bootDeadlineExceeded(hostEnc: string, nowMs: number): boolean {
  const a = anchors.get(hostEnc);
  const classExceeded =
    a !== undefined && nowMs - a.anchorMs > CEILING_MS[a.ceiling];
  const campaignStart = campaignAnchors.get(hostEnc);
  const campaignExceeded =
    campaignStart !== undefined && nowMs - campaignStart > CAMPAIGN_CEILING_MS;
  return classExceeded || campaignExceeded;
}

/** Step 3 (write): fold this frame's resolved tag into the host's anchor (C2) — a pure switch
 *  on the tag's 3-way `accrual` verdict, which the resolver already decided at its return site
 *  (no `kind`-based re-derivation here).
 *   - `accrue` → (re)anchor the CLASS cell on the FIRST boot frame of a class, and re-anchor on a
 *     class CHANGE (zero-credit); otherwise keep the running class anchor. This includes the
 *     escaped down/boot-stalled frames (their raw tag stays `accrue`), so an escape keeps accruing
 *     (stays escaped) until the hung leg delivers. Independently, the CAMPAIGN cell is ARMED (once,
 *     then held) for a connector-owned `provisioning` leg and CLEARED for any other leg — so it
 *     tracks the whole warming-remote campaign across class flips but never a client-side leg.
 *   - `clear` → release BOTH cells: a SETTLED surface (workspace/empty/down/host-failed).
 *   - `retain` → no-op on both: a non-boot OVERLAY the deadline must ignore (kaval-restart warming,
 *     a records-awaited / `!channelLive` connecting) — so an overlay-flavored flap can't dodge the
 *     ceiling by momentarily settling. A boot LEG flapping delivered↔undelivered clears each cycle
 *     and so never accrues — that is the hung-subscription TRIGGER class, out of scope. */
export function recordBootFrame(
  hostEnc: string,
  tag: BootTag,
  nowMs: number,
): void {
  // `.exhaustive()` (not a bare `switch`, which returns `void` and so would let a future
  // 4th `accrual` variant compile as a silent no-op) — prefer-ts-pattern.
  match(tag)
    .with({ accrual: "accrue" }, (t) => {
      const a = anchors.get(hostEnc);
      if (a === undefined || a.ceiling !== t.ceiling) {
        anchors.set(hostEnc, { anchorMs: nowMs, ceiling: t.ceiling });
      }
      // The campaign cell tracks the connector-owned (`provisioning`) campaign ONLY: arm it once
      // at the campaign's first frame and HOLD it across class flips; a non-connector boot leg is
      // not a connector campaign, so it clears the cell (a later `provisioning` frame re-arms fresh).
      if (t.leg === "provisioning") {
        if (!campaignAnchors.has(hostEnc)) campaignAnchors.set(hostEnc, nowMs);
      } else {
        campaignAnchors.delete(hostEnc);
      }
    })
    .with({ accrual: "clear" }, () => {
      anchors.delete(hostEnc);
      campaignAnchors.delete(hostEnc);
    })
    .with({ accrual: "retain" }, () => {})
    .exhaustive();
}

/** Prune anchors for hosts no longer in membership — a genuine re-add earns a FRESH episode
 *  (its stale anchor must not carry over), while a switch-away-and-back (still a member)
 *  keeps its anchor (no fresh grace for a revisited wedged host). Prunes BOTH cells together. */
export function pruneBootAnchors(memberEncs: readonly string[]): void {
  const keep = new Set(memberEncs);
  for (const k of [...anchors.keys()]) {
    if (!keep.has(k)) anchors.delete(k);
  }
  for (const k of [...campaignAnchors.keys()]) {
    if (!keep.has(k)) campaignAnchors.delete(k);
  }
}

/** Test-only: clear all episode anchors so each test accrues fresh. */
export function resetBootAnchors(): void {
  anchors.clear();
  campaignAnchors.clear();
}
