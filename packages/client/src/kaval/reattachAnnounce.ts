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

import type { DaemonState, DaemonStatus } from "@kolu/padi/surface";

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

/** The #2101 N1 twin of {@link announceReattach}: "padi found this host's kaval
 *  unresponsive, restarted it by itself, and a probe proved the replacement
 *  serves."
 *
 *  Same rail, same dedupe law, deliberately: the server stamps `autoRecoveredAt`
 *  on the `connected` status once per proven auto-repair, the stamp is sticky and
 *  replayed to every fresh subscription, and the client only announces one
 *  strictly newer than the greatest it has already announced (persisted, per
 *  host — the #1365 rule). Sharing the shape rather than the storage is
 *  deliberate too: the two marks are independent facts and one mark for both
 *  would let an adoption suppress a recovery.
 *
 *  Why announce at all, when the user can see the restore card: the card says
 *  the session is back, not WHY it went away. Without this line an automatic
 *  repair is indistinguishable from a daemon that crashed on its own — which is
 *  the difference between "kolu fixed it" and "kolu broke". */
export function announceAutoRecovery(
  status: Pick<DaemonStatus, "state" | "autoRecoveredAt"> | undefined,
  lastAnnouncedAt: number,
  commit: (at: number) => void,
  notify: () => void,
): void {
  announceStamp(
    status?.state,
    status?.autoRecoveredAt,
    lastAnnouncedAt,
    commit,
    notify,
  );
}

/** The #2184 third of this family: "the link to this host's kaval died
 *  mid-session and padi re-made it — the daemon never went away, and everything
 *  running behind it still is."
 *
 *  Same rail and same dedupe law as the two above (a sticky server stamp,
 *  replayed to every fresh subscription, announced only when strictly newer than
 *  the greatest already announced, persisted per host — the #1365 rule). And its
 *  OWN mark, for the argument {@link announceAutoRecovery} already makes one fact
 *  over: one mark for both would let a link restore suppress an auto-recovery, or
 *  the reverse, and these are three independent things that can happen to a host
 *  in any order.
 *
 *  Why it is not the auto-recovery line: that sentence says kaval was
 *  unresponsive, kolu restarted it, and the session is waiting to be restored.
 *  Of an ADOPTED heal all three are false — the daemon was healthy the whole
 *  time, it kept its pid, and the terminals never stopped. Telling a user their
 *  running session needs restoring is worse than saying nothing, which is why
 *  padi stamps the two verdicts apart and this announces the one it means. */
export function announceLinkRestored(
  status: Pick<DaemonStatus, "state" | "linkRestoredAt"> | undefined,
  lastAnnouncedAt: number,
  commit: (at: number) => void,
  notify: () => void,
): void {
  announceStamp(
    status?.state,
    status?.linkRestoredAt,
    lastAnnouncedAt,
    commit,
    notify,
  );
}

/** The dedupe law all the repair rails obey, written once (the #1365 rule): a
 *  sticky server stamp on a `connected` status, announced only when strictly
 *  newer than the greatest already announced, COMMITTED before notifying so a
 *  replay of the same snapshot is silent.
 *
 *  One implementation, independent marks: which mark a rail compares against is
 *  its caller's, so no fact can suppress another. `reattachToAnnounce` is not
 *  built on this — it carries a payload and a second `adopted > 0` gate, which is
 *  a different decision rather than the same one with a different field. */
function announceStamp(
  state: DaemonState | undefined,
  at: number | undefined,
  lastAnnouncedAt: number,
  commit: (at: number) => void,
  notify: () => void,
): void {
  if (state !== "connected") return;
  if (typeof at !== "number" || at <= lastAnnouncedAt) return;
  commit(at);
  notify();
}
