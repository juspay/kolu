/** The daemon-status "pending run" ceiling — pure, dependency-free (no `../wire`,
 *  no clock, no subscription), so the "kaval didn't start" floor is unit-testable
 *  without mounting `useDaemonStatus.ts`'s live subscription.
 *
 * ── THE BUG this closes ──────────────────────────────────────────────────────
 * `useDaemonStatus.ts`'s `daemonStatusPendingTimedOut()` bounds "still pending" so
 * a daemon-status stream that NEVER yields (a boot that truly never came up)
 * eventually resolves to `down`/`dead` instead of spinning at "Connecting…"
 * forever (#1713's canvas symptom). That ceiling is measured from a "when did
 * this wait begin" anchor.
 *
 * ── Where the anchor lives (padi W9) ─────────────────────────────────────────
 * The daemon-status subscription is now RETAINED per host (`activeScope().wire`,
 * `createHostWire`): it opens on a host's FIRST activation and is held across every
 * switch-away, disposed only when the host leaves the pool. So its wait begins ONCE
 * per host and does NOT restart on a switch-back. The anchor rides the same retained
 * scope (`HostWire.daemonPendingAnchorMs`, stamped at scope birth) to match that
 * lifetime exactly: a repeatedly-revisited wedged host keeps its ORIGINAL deadline
 * (the ceiling still fires), while a genuinely re-added host earns a fresh one.
 *
 * (Before W9 the sub rode `padiMap.useEntry(activeHost)`, which re-keyed on every
 * switch, so the anchor was RE-taken on each switch — correct for that lifetime,
 * wrong for the retained one. Anchoring in the retained scope tracks the sub either
 * way.) This module stays the pure ceiling check; the anchor's provenance is the
 * scope's, not a stale `Date.now()` re-snapped on switch. */

/** True once a pending wait — anchored at `anchorMs` — has run longer than
 *  `timeoutMs`, AND only while `pending` itself still holds (a settled
 *  subscription is never "timed out", however old its anchor is). Pure twin of
 *  `useDaemonStatus.ts`'s `daemonStatusPendingTimedOut`, taking the retained
 *  per-host anchor as a plain value so the ceiling decision is testable without a
 *  live clock or subscription. */
export function isPendingTimedOut(
  pending: boolean,
  anchorMs: number,
  nowMs: number,
  timeoutMs: number,
): boolean {
  return pending && nowMs - anchorMs > timeoutMs;
}
