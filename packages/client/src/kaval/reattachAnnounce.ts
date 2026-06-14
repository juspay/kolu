/** The pure B3.3 reattach-toast decision — "announce 'N terminals reattached'?"
 *
 *  Extracted as its own side-effect-free module (like `kavalCurrency`) so its
 *  truth table is unit-tested without mounting `useDaemonStatus`'s `daemonStatus`
 *  subscription. {@link useDaemonStatus}'s detached effect joins the live status
 *  with a persisted high-water mark and calls this.
 *
 *  Dedupe is keyed on `adoptedAt` — the ms-epoch the server stamped when it
 *  surfaced THIS adoption — compared against `lastAnnouncedAt`, the greatest
 *  adoptedAt this client has already toasted (persisted to localStorage). The
 *  monotonic `>` is what fixes juspay/kolu#1365: the `adopted`/`adoptedAt`
 *  snapshot is sticky server-side and replayed verbatim to every fresh
 *  subscription, so a reconnect after a page reload (mobile-Safari tab eviction,
 *  or a desktop hard refresh) re-delivers the SAME adoptedAt. A persisted
 *  high-water mark stays put across that reload — `adoptedAt > lastAnnouncedAt`
 *  is then false, so the replay is silent — whereas the old in-memory boolean
 *  reset with the JS context and re-fired the toast. A genuinely newer adoption
 *  (a later update) stamps a greater adoptedAt and announces again. */

import type { DaemonState } from "kolu-common/surface";

/** True when a NOT-yet-announced adoption is on the current snapshot: the daemon
 *  is `connected`, it actually adopted terminals (`adopted > 0`), it carries an
 *  `adoptedAt` identity, and that identity is strictly newer than the greatest
 *  one already announced. The `connected` gate excludes transient/down states
 *  whose snapshot isn't authoritative; the `> lastAnnouncedAt` gate (not `!==`)
 *  makes a stale/older replay silent and lets the `0` fallback announce the first
 *  adoption. */
export function shouldAnnounceReattach(
  state: DaemonState | undefined,
  adopted: number | undefined,
  adoptedAt: number | undefined,
  lastAnnouncedAt: number,
): boolean {
  return (
    state === "connected" &&
    (adopted ?? 0) > 0 &&
    typeof adoptedAt === "number" &&
    adoptedAt > lastAnnouncedAt
  );
}
