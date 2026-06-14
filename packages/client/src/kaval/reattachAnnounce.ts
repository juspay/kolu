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

import type { DaemonState, DaemonStatus } from "kolu-common/surface";

/** The reattach decision WITH its payload — `{ count, at }` to announce, or
 *  `null` to stay silent. Returns the announce-this payload when a NOT-yet-
 *  announced adoption is on the current snapshot: the daemon is `connected`, it
 *  actually adopted terminals (`adopted > 0`), it carries an `adoptedAt`
 *  identity, and that identity is strictly newer than the greatest one already
 *  announced. The `connected` gate excludes transient/down states whose snapshot
 *  isn't authoritative; the `> lastAnnouncedAt` gate (not `!==`) makes a
 *  stale/older replay silent and lets the `0` fallback announce the first
 *  adoption. Yielding the proven `{ count, at }` — not a bare boolean — means the
 *  one consumer commits the high-water mark and renders the count straight from
 *  the proof, with no re-read of the raw status fields. */
export function reattachToAnnounce(
  state: DaemonState | undefined,
  adopted: number | undefined,
  adoptedAt: number | undefined,
  lastAnnouncedAt: number,
): { count: number; at: number } | null {
  if (
    state === "connected" &&
    (adopted ?? 0) > 0 &&
    typeof adoptedAt === "number" &&
    adoptedAt > lastAnnouncedAt
  ) {
    return { count: adopted!, at: adoptedAt };
  }
  return null;
}

/** The announce side effect, as a glue function so the persist-before-toast
 *  wiring is testable WITHOUT mounting {@link useDaemonStatus}'s detached
 *  effect, real `localStorage`, or `solid-sonner`. Runs the {@link
 *  reattachToAnnounce} decision against the current `status` and the persisted
 *  high-water mark; on an announce, COMMITS the proven `adoptedAt` as the new
 *  mark FIRST (so a re-run on the same snapshot — `localDaemonStatus()` re-emits
 *  on every transition — sees `adoptedAt == lastAnnouncedAt` and stays silent),
 *  then notifies. Order matters: commit before notify keeps the effect
 *  idempotent; the unit test pins it by re-running on the same snapshot and
 *  asserting a single notify. {@link useDaemonStatus} passes the live status,
 *  the persisted signal's getter/setter, and a toast-bound `notify`. */
export function announceReattach(
  status: Pick<DaemonStatus, "state" | "adopted" | "adoptedAt"> | undefined,
  lastAnnouncedAt: number,
  commit: (at: number) => void,
  notify: (count: number) => void,
): void {
  const a = reattachToAnnounce(
    status?.state,
    status?.adopted,
    status?.adoptedAt,
    lastAnnouncedAt,
  );
  if (!a) return;
  commit(a.at);
  notify(a.count);
}
