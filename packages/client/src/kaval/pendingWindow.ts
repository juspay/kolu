/** The daemon-status "pending run" window — pure, dependency-free (no `../wire`,
 *  no clock, no subscription), so the fresh-connect warm floor is unit-testable
 *  without mounting `useDaemonStatus.ts`'s live subscription.
 *
 * ── THE BUG this closes ──────────────────────────────────────────────────────
 * `useDaemonStatus.ts`'s `daemonStatusPendingTimedOut()` bounds "still pending" so
 * a daemon-status stream that NEVER yields (a boot that truly never came up)
 * eventually resolves to `down`/`dead` instead of spinning at "Connecting…"
 * forever (#1713's canvas symptom). That ceiling is measured from a "when did
 * this wait begin" anchor.
 *
 * The daemon-status subscription (`sub` in `useDaemonStatus.ts`) rides
 * `padiMap.useEntry(activeHost)`, which RE-KEYS — tears down and rebuilds — every
 * time the active host switches (W4 "the switch"): a brand-new remote host's
 * subscription starts genuinely pending again, exactly like boot. A single
 * `Date.now()` snapshot taken once at MODULE LOAD would keep measuring the
 * ORIGINAL (e.g. boot-time, local) wait's age forever — so switching to a
 * freshly-connected remote MINUTES into a session reads `now - moduleLoadInstant
 * > 30s` and resolves `pendingTimedOut` TRUE the INSTANT the switch happens, well
 * before the new host's own warm/handshake window even started. The canvas then
 * renders the terminal `down`/`dead` "kaval didn't start" surface over a daemon
 * that is simply warming — stuck there (a `NOT-YET` rendered as a
 * `PERMANENT-FAILURE`) until a page refresh re-runs the module and resets the
 * anchor.
 *
 * The fix: re-anchor the pending window's start to NOW every time the active
 * host key changes ({@link reanchorPendingWindow}), so the 30s ceiling always
 * measures the CURRENTLY-ACTIVE host's own wait, never a stale one inherited from
 * a host that is no longer even the one being watched. */

/** One pending-window anchor: which host it was taken for, and when. */
export interface PendingWindow {
  hostKey: string;
  anchorMs: number;
}

/** Re-anchor the pending window for `hostKey` at `nowMs`. Returns `prev`
 *  UNCHANGED (same reference) when `hostKey` matches the window already held —
 *  so a `createMemo` reducer wrapping this only re-renders on a genuine host
 *  switch, not on every unrelated recompute — and a FRESH window (anchored at
 *  `nowMs`) whenever `hostKey` differs from `prev` (including the very first
 *  call, `prev === undefined`). This is the ONE place "did the active host
 *  change" resets the daemon-status wait clock. */
export function reanchorPendingWindow(
  prev: PendingWindow | undefined,
  hostKey: string,
  nowMs: number,
): PendingWindow {
  if (prev !== undefined && prev.hostKey === hostKey) return prev;
  return { hostKey, anchorMs: nowMs };
}

/** True once a pending wait — anchored at `window.anchorMs` — has run longer
 *  than `timeoutMs`, AND only while `pending` itself still holds (a settled
 *  subscription is never "timed out", however old its last window is). Pure
 *  twin of `useDaemonStatus.ts`'s `daemonStatusPendingTimedOut`, taking the
 *  anchor as a plain value so the ceiling decision is testable without a live
 *  clock or subscription. */
export function isPendingTimedOut(
  pending: boolean,
  window: PendingWindow,
  nowMs: number,
  timeoutMs: number,
): boolean {
  return pending && nowMs - window.anchorMs > timeoutMs;
}
