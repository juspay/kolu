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
 *  boot-stalled card (Reload recovers). Same jump the wall clock would have; bounded, honest.
 *
 *  That residual is CLOSED by the #2129 observability floor (told once, in
 *  `canvasModeResolver.ts`'s module header), which this module applies to BOTH halves of the
 *  cycle above — and it takes both, because a frozen tab runs NO frames at all:
 *   - the WRITE: a frame observed over a dead link releases the anchor — ANY frame, whatever
 *     its accrual, which is the rule `resolveCanvasMode` actually implements
 *     ({@link recordBootFrame}), so a reconnect measures a fresh window rather than the outage;
 *   - the READ: the verdict a dead link reports is the last one this browser WATCHED accrue
 *     ({@link bootDeadlineExceeded}), NOT a fresh subtraction over the frozen interval — so a
 *     ceiling crossed entirely while the tab was frozen and the socket was gone is never
 *     reached, because no frame ran to observe it.
 *  What survives is the honest case the monotonic clock was always going to have: a resume
 *  whose link was NEVER lost sees the real elapsed and may escape at once (Reload recovers). */

import { match } from "ts-pattern";
import type { BootTag, CeilingClass } from "./canvasModeResolver";

/** The LOCAL connect ceiling — mirrors `makeSession`'s default `connectTimeoutMs`, the
 *  local padi session's own connect-watchdog ceiling (client and server are separate
 *  packages; they need only agree on order of magnitude). Exported (was module-private in
 *  `useDaemonStatus.ts`, R6) so the ceiling table and its exhaustive test can name it. */
export const LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS = 30_000;

/** The FULL, all-FINITE ceiling table (#1763 R4). Every cell is bounded — an unbounded cell
 *  would recreate the no-escape class inside the fix (a link-live frozen `provisioning` would
 *  never escape). A remote's ssh provisioning legitimately outlasts the local
 *  ceiling, so provisioning gets a generous minutes-scale cell; a remote handshake
 *  (probing/connecting/pre-frame) a shorter but still finite one. */
export const CEILING_MS: Record<CeilingClass, number> = {
  local: LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS,
  "remote-provisioning": 600_000,
  "remote-handshake": 120_000,
};

/** The CAMPAIGN backstop ceiling (#1908 R8a) — a SECOND, class-BLIND cell above the per-class
 *  table. PR1's D1 retry cycle can flap a warming host's phase (probing→provisioning→retry)
 *  fast enough that the class anchor above re-zeros on every class change and so NEVER trips —
 *  the escape card would never fire for a persistently-wedged host. This bound is anchored ONCE
 *  per connector campaign (the `provisioning` leg — the whole warming-remote coming-up campaign)
 *  and held across every class flip. Its ELAPSED is measured PURELY on the client MONOTONIC clock
 *  (the same source the per-class cell uses) — so it keeps advancing even if the server stops
 *  publishing frames (a silent wedge — the very case it must catch) and no wall-clock / NTP step
 *  can jolt it. It deliberately does NOT read the server's `sinceMs`: that value is frame-stamped
 *  (freezes on a silent wedge) and `Date.now()`-derived (a clock step would false-fire or falsely
 *  reset it), so it is unfit as a deadline. The semantic is therefore "THIS browser has shown a
 *  non-connecting host for CAMPAIGN_CEILING_MS" — honest for a client-side backstop; a page reload
 *  starts a fresh observation window, which is correct for a per-browser last-resort escape. A
 *  DELIBERATE user recovery (Retry connection) calls {@link resetBootDeadline} to earn a fresh
 *  window at once (below), so the anchor never needs to guess a server-campaign reset from `sinceMs`.
 *  30min: comfortably above the 600s remote-provisioning cell AND above the server's own retry
 *  grants (R8b's 20min pre-connected no-progress backstop; R4's ≤16min per-step budget) — so a
 *  genuinely-progressing cold provision (which settles to `connected` and CLEARS well under this)
 *  never false-fires; only a campaign that has NOT settled for a solid half hour reaches it.
 *
 *  THE #2129 OBSERVABILITY FLOOR RELEASES THIS CELL TOO — a decision made here, not a
 *  side effect of `clear` releasing both. A browser that cannot hold a socket has no
 *  standing to certify a 30-minute campaign either, and this cell's semantic is already
 *  explicitly PER-BROWSER ("THIS browser has shown a non-connecting host for
 *  CAMPAIGN_CEILING_MS"), so an outage is time this browser did not observe — exactly the
 *  case a page reload already restarts. CONSEQUENCE, accepted: on a link that flaps faster
 *  than CAMPAIGN_CEILING_MS this backstop never fires, so the flapping-phase defeat it was
 *  built to survive (above) is re-reachable one level up, via a flapping LINK rather than a
 *  flapping phase. That is the honest surface: throughout, the transport overlay owns the
 *  screen and tells the user the true thing — kolu cannot see their machine. */
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

/** The per-host CAMPAIGN anchors (#1908 R8a): the client-monotonic ms at which this host's
 *  connector-owned (`provisioning` leg) warming campaign began. Set once per campaign, HELD across
 *  every class flip (unlike {@link anchors}, which re-anchors per class), and deleted the instant
 *  the entry stops being a connector campaign (settles, a `retain` connected-arm overlay, or any
 *  non-`provisioning` boot leg) OR the user explicitly retries ({@link resetBootDeadline}). Separate
 *  from {@link anchors} so the two lifecycles — per-class re-anchoring vs held-once-per-campaign —
 *  never entangle. */
const campaignAnchors = new Map<string, number>();

/** The last ceiling verdict this browser actually WATCHED accrue, per host — the sample half
 *  of {@link bootDeadlineExceeded}'s sample-and-hold (#2129). Written on every frame observed
 *  over a LIVE link, read on every frame observed over a dead one, and released together with
 *  the two anchor cells (a settled episode leaves no verdict behind to resurrect). Absent = the
 *  browser has never watched this host's ceiling elapse, which is exactly `false`. */
const watchedVerdict = new Map<string, boolean>();

/** WHAT A BOOT EPISODE IS, named once: these three per-host cells. Every path that ends an
 *  episode ends all three, so "which cells does a host own?" has exactly one answer to keep
 *  true — adding a fourth cell means adding it here, not remembering four release sites. */
const EPISODE_CELLS = [anchors, campaignAnchors, watchedVerdict] as const;

/** End this host's episode: drop every cell it owns. The three callers below differ only in
 *  WHY the episode ended (settled/unobservable, a user Retry, a departed host), never in what
 *  ending it means — so the reasons stay at the call sites and the mechanics live here. */
function releaseEpisode(hostEnc: string): void {
  for (const cell of EPISODE_CELLS) cell.delete(hostEnc);
}

/** Step 1 (read): is the active host's boot overlay past EITHER ceiling — as far as this
 *  browser has actually WATCHED? Two independent cells, OR-ed (#1908 R8a), both on the SAME
 *  monotonic `nowMs`:
 *   - the per-CLASS anchor (C1 — computed from the PRIOR frame's stored class; the ≤1-tick lag
 *     is the accepted, self-correcting edge). A host with no stored anchor (never a boot overlay,
 *     or already settled+cleared) is not exceeded this way — a brief overlay under the ceiling
 *     holds the neutral surface, exactly as before.
 *   - the class-BLIND CAMPAIGN backstop: the connector campaign's monotonic start
 *     ({@link campaignAnchors}, armed by {@link recordBootFrame} off the `provisioning` leg) past
 *     {@link CAMPAIGN_CEILING_MS}. This is what still fires when a flapping phase re-zeros the
 *     class anchor forever — and, being client-monotonic, it keeps advancing even if the server
 *     stops publishing frames (a silent wedge) and can't be jolted by a wall-clock step.
 *
 *  `transportLive` is THE #2129 OBSERVABILITY FLOOR APPLIED TO THE CLOCK, and it is a
 *  separate necessity from the floor `resolveCanvasMode` applies to the frame's TAG. That one
 *  stops a deadline ARMING or ADVANCING across frames observed while blind; this one stops one
 *  being REACHED across the interval BETWEEN frames — which is the case a frozen tab produces,
 *  where there are no frames to observe at all. Both subtractions above span wall-time the
 *  browser may have spent frozen with its socket gone, so over a dead link we do not subtract:
 *  we report the verdict we last watched accrue. That makes the escape's "earned while the link
 *  was live" premise (`canvasModeResolver.ts`'s AFP C6 exemption) literally true rather than
 *  merely likely — without it, a tab frozen mid-boot wakes past its ceiling, finds the link
 *  already dead, and certifies a stall it never watched: #2129's exact shape, one level up. */
export function bootDeadlineExceeded(
  hostEnc: string,
  nowMs: number,
  transportLive: boolean,
): boolean {
  if (!transportLive) return watchedVerdict.get(hostEnc) ?? false;
  const a = anchors.get(hostEnc);
  const classExceeded =
    a !== undefined && nowMs - a.anchorMs > CEILING_MS[a.ceiling];
  const campaignStart = campaignAnchors.get(hostEnc);
  const campaignExceeded =
    campaignStart !== undefined && nowMs - campaignStart > CAMPAIGN_CEILING_MS;
  const exceeded = classExceeded || campaignExceeded;
  // Sample on every WATCHED frame, so the held value is never staler than the last moment
  // this browser could see the server — including a re-anchor (a class flip) walking it back
  // to false, which a latch that only ever went true would get wrong.
  watchedVerdict.set(hostEnc, exceeded);
  return exceeded;
}

/** Step 3 (write): fold this frame's resolved tag into the host's anchor (C2) — a pure switch
 *  on the tag's 3-way `accrual` verdict, which the resolver already decided at its return site
 *  (no `kind`-based re-derivation here).
 *   - `accrue` → (re)anchor the CLASS cell on the FIRST boot frame of a class, and re-anchor on a
 *     class CHANGE (zero-credit); otherwise keep the running class anchor. This includes the
 *     escaped down/boot-stalled frames (their raw tag stays `accrue`), so an escape keeps accruing
 *     (stays escaped) until the hung leg delivers. Independently, the CAMPAIGN cell is armed (once,
 *     then held) for a connector-owned `provisioning` leg and CLEARED for any other leg — so it
 *     tracks the whole warming-remote campaign across class flips but never a client-side leg.
 *   - `clear` → release the whole episode — both anchor cells AND the watched verdict — for
 *     either of two reasons: a SETTLED surface
 *     (workspace/empty/down/host-failed), or an UNOBSERVABLE one (the #2129 observability
 *     floor — see `canvasModeResolver.ts`'s module header for the whole rule). Both mean the
 *     ceiling is no longer measuring anything in progress. Releasing the CAMPAIGN cell too
 *     is deliberate — see {@link CAMPAIGN_CEILING_MS}. The floor covers EVERY accrual
 *     variant, not just `accrue`, so this module holds no assumption about which frames a
 *     dead link can produce: `retain` over a dead link is unreachable in production (every
 *     `retain` site is on the connected arm, which `floorOnLiveness` demotes off in the
 *     same tick), so covering it is a no-op that simply removes the cross-package
 *     invariant this paragraph used to assert. A future `retain` outside the connected arm
 *     would then still be timed correctly, instead of silently breaking an assumption.
 *   - `retain` → hold the CLASS cell (a non-boot OVERLAY the deadline must ignore — kaval-restart
 *     warming, a records-awaited / `!channelLive` connecting — so an overlay-flavored flap can't
 *     dodge the class ceiling), but CLEAR the campaign cell: every `retain` is a CONNECTED-arm
 *     overlay, which proves the connector campaign has ended, so it must not carry a stale start
 *     into a later fresh warming campaign (codex F7). */
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
    // The whole episode goes, watched verdict included: it dies with the episode it
    // described. Were it left standing, a host that SETTLED and then lost the link would
    // still be holding "we watched this exceed", and the next blind frame would resurrect
    // a card off an episode that already ended.
    .with({ accrual: "clear" }, () => releaseEpisode(hostEnc))
    .with({ accrual: "retain" }, () => campaignAnchors.delete(hostEnc))
    .exhaustive();
}

/** Reset BOTH deadline cells for one host — the DELIBERATE user-recovery reset (#1908 R8a, codex
 *  F1). The boot-stalled card's **Retry connection** verb calls this when it recycles the server
 *  connector, so the card dismisses at once and the host earns a FRESH class + campaign window —
 *  even on a same-class retry (`probing → Retry → probing`), where the class anchor would otherwise
 *  stay exceeded and the recovery verb would look broken. Deterministic (a real user action), not a
 *  guess from a `sinceMs` sample. The next boot frame re-arms both cells from `now`, so a genuinely
 *  still-wedged host escapes again after a fresh window rather than being permanently silenced. */
export function resetBootDeadline(hostEnc: string): void {
  // The whole episode, watched verdict included: a Retry that left the verdict standing would
  // re-show the card on the very next blind frame — precisely the "recovery verb looks broken"
  // bug above.
  releaseEpisode(hostEnc);
}

/** Prune anchors for hosts no longer in membership — a genuine re-add earns a FRESH episode
 *  (its stale anchor must not carry over), while a switch-away-and-back (still a member)
 *  keeps its anchor (no fresh grace for a revisited wedged host). Prunes ALL THREE per-host
 *  cells together — the two anchors and the watched verdict — so a departed host leaves nothing
 *  a re-add could inherit. */
export function pruneBootAnchors(memberEncs: readonly string[]): void {
  const keep = new Set(memberEncs);
  for (const cell of EPISODE_CELLS) {
    // Deleting the current key mid-iteration is spec-safe for a Map, so no key-array copy.
    for (const k of cell.keys()) {
      if (!keep.has(k)) cell.delete(k);
    }
  }
}

/** Test-only: clear all episode state so each test accrues fresh. */
export function resetBootAnchors(): void {
  for (const cell of EPISODE_CELLS) cell.clear();
}
