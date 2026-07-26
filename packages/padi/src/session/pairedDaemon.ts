/**
 * The last kaval daemon kolu-server was PAIRED with — persisted across kolu-server
 * restarts so a boot can tell "our surviving daemon" from "a REPLACED daemon at the
 * same socket."
 *
 * The session-clobber bug (the zest incident): `adoptOrEnsure` adopts a kaval on
 * gate + socket + handshake alone, so a kaval that was restarted out-of-band (empty,
 * but reachable at the same socket) is adopted as if it were our survivor. The boot
 * converge then reconciled the saved session against that empty daemon's live PTYs
 * (none) and erased it. The fix gates the converge on daemon IDENTITY: only a
 * genuine survivor is converged; a replaced daemon takes the no-survivor path
 * (preserve the saved session, park its actives for the restore card).
 *
 * The discriminant is the daemon's `startedAt` — `Date.now()` stamped at kaval boot
 * (`inProcessPtyHost`), a PER-PROCESS value. A survivor of a kolu-server redeploy is
 * the SAME kaval process → same `startedAt`; a restarted daemon is a new process →
 * a new `startedAt`. The build `staleKey` is deliberately NOT the discriminant: it
 * is a nix-baked build constant, so two DIFFERENT kaval processes of the same build
 * share it and it cannot detect process replacement.
 *
 * The STORAGE is a conf-backed cell kolu-server injects at boot (`./confStores.ts`),
 * the same arrangement `session` / `activityFeed` use until W2.2 gives padi its own
 * state-root — so the pairing survives a kolu-server restart (without which the boot
 * would have nothing to compare against).
 */

import type { PtyHostListEntry } from "kaval";
import { z } from "zod";
import { requirePadiLastPairedDaemonStore } from "./confStores.ts";
import type { SavedSession } from "../vocab.ts";

/** The persisted identity of the kaval kolu-server last CONVERGED onto as its
 *  survivor. `startedAt` is the per-process boot timestamp the next boot compares
 *  against, to tell "our survivor whose terminals all exited" (clear) from "a
 *  replaced empty daemon" (preserve) — the one case the terminal-id match below
 *  cannot decide by itself. */
export const PairedDaemonSchema = z.object({
  /** kaval's `Date.now()` boot stamp (ms epoch) — the per-process discriminant. */
  startedAt: z.number(),
});
export type PairedDaemon = z.infer<typeof PairedDaemonSchema>;

/** The last-paired daemon, or null if none recorded (a first boot, or a boot that
 *  never converged onto a survivor). Reads through padi's injected conf store.
 *
 *  NORMALIZES `undefined` → `null`: the conf store returns `undefined` for a
 *  never-written key (a fresh-spawn boot never converges onto a survivor, so
 *  `recordPairedDaemon` never runs and the key is absent). Without this, `undefined`
 *  slips past `isReplacedDaemon`'s `lastPaired !== null` guard and throws on
 *  `.startedAt` — failing the boot CLOSED (a daemon recycle) instead of the intended
 *  clean preserve + park, in the exact fresh-boot → out-of-band-restart zest path. */
export function getLastPairedDaemon(): PairedDaemon | null {
  return requirePadiLastPairedDaemonStore().get() ?? null;
}

/** Persist the pairing after a survivor converge — the daemon we just confirmed
 *  holds (or held) our session. Recorded ONLY on the survivor path (never when
 *  parking a pending-restore session onto a fresh daemon), so a later boot doesn't
 *  mistake that fresh daemon for the session's owner. `undefined` clears it. */
export function recordPairedDaemon(startedAt: number | undefined): void {
  requirePadiLastPairedDaemonStore().set(
    startedAt === undefined ? null : { startedAt },
  );
}

/** Is the adopted daemon a REPLACEMENT (not the survivor holding our session)?
 *
 *  The PRIMARY, robust signal is the terminals' own IDs: kolu mints each PTY's id
 *  and the daemon round-trips it, so a live PTY whose id matches a saved ACTIVE
 *  record proves this daemon is OURS — whatever its `startedAt`, and even if the
 *  pairing went stale across a supervised restart / restore. So:
 *
 *   - no saved actives to protect → NOT replaced (the normal converge seeds any
 *     sleeping records and clears an empty session);
 *   - a live PTY matches a saved active → NOT replaced (a survivor still holding our
 *     terminals — the restore/create/adopt that re-homed the session onto THIS
 *     daemon is honoured, never re-parked out from under live scrollback);
 *   - otherwise (no live PTY matches any saved active — an empty or foreign daemon)
 *     it is EITHER a replaced daemon OR our own survivor whose actives all exited
 *     during downtime. Disambiguate by process identity: literally the same process
 *     we paired with (`startedAt` matches the recorded pairing) → the actives truly
 *     exited → NOT replaced (converge/clear, 2b). Any other / unknown process →
 *     REPLACED → preserve the session + park for the restore card (the zest incident,
 *     and every fresh-empty-daemon-at-the-socket boot). Preserving on the unknown
 *     case is the fail-safe: a wrongly-preserved session shows a restore card the
 *     user can dismiss; a wrongly-cleared one is gone. */
export function isReplacedDaemon(args: {
  currentStartedAt: number | undefined;
  lastPaired: PairedDaemon | null;
  live: PtyHostListEntry[];
  saved: SavedSession | null;
}): boolean {
  const { currentStartedAt, lastPaired, live, saved } = args;
  const savedActiveIds = new Set(
    (saved?.terminals ?? [])
      .filter((t) => t.state === "active")
      .map((t) => t.id),
  );
  if (savedActiveIds.size === 0) return false;
  if (live.some((entry) => savedActiveIds.has(entry.id))) return false;
  // No live PTY corresponds to our saved actives. Same process we converged onto
  // last time ⇒ they genuinely exited (2b, clear). Otherwise ⇒ replaced (preserve).
  if (
    lastPaired !== null &&
    currentStartedAt !== undefined &&
    currentStartedAt === lastPaired.startedAt
  ) {
    return false;
  }
  return true;
}
