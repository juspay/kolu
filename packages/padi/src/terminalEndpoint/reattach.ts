/**
 * Boot-time adoption (B3.3) — kolu's soul side of "terminals survive a deploy".
 *
 * When `ensureLocalEndpoint` ADOPTS a surviving kaval daemon (a redeploy that did
 * not change kaval's source — `adoptOrEnsure` returned `true`), the daemon's PTYs
 * are still alive. This orchestrates the reconciliation that the spine cannot
 * (the endpoint adopts a *connection*; kolu reconciles its *contents*):
 *
 *   1. List the surviving daemon's live PTYs and `reconcile` them against the
 *      saved session. A failure to list is a FAILED adoption, not a quiet skip
 *      (F3): it throws, and the boot recycles the daemon so it never leaves a
 *      connected survivor holding PTYs kolu has no registry entry for.
 *   2. **Adopt every representable live PTY**, all three kinds (never reap a
 *      survivor just because the debounced autosave lagged the daemon — F1):
 *        - survivors WITH a saved record → whole-record (`adoptLocalTerminal`),
 *          live `cwd`/`foreground` from the daemon snapshot (F2);
 *        - survivors with NO saved record (a create that never reached the
 *          debounced autosave) → live-snapshot defaults (`adoptLocalOrphan`);
 *        - survivors whose saved record does not DECODE (#2122 — a session
 *          written by a build whose vocabulary is wider than this one's) → the
 *          same live-snapshot defaults. The record is forfeit, the shell is not.
 *      Either way the provider DAG re-runs against the surviving taps. The ONE
 *      survivor kolu does NOT adopt is one whose wire id is not a UUID — kolu's
 *      registry cannot represent it, so it is killed (`reapUnrepresentablePty`)
 *      rather than left running hidden; fail-closed, not fail-open.
 *   3. **Converge** the saved session to exactly the adopted set: exited shells
 *      (saved but no longer live) drop out so no stale restore card lingers, and
 *      the active marker is preserved iff its terminal survived. An all-exited
 *      survivor clears the session (no restore card for shells that genuinely
 *      ended — exactly `handleExit`'s behavior).
 *   4. **Surface the count** so the client shows its one-shot "N reattached"
 *      confirmation.
 *
 * Runs ONLY for a daemon that survived. A fresh / recycled boot has no survivors,
 * so the existing restore-card path (the client reads the saved session and
 * offers to re-spawn it) is left untouched — B2 behavior, unchanged.
 */

import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Result, Schema } from "effect";
import type { PtyHostListEntry } from "kaval";

/** zod's `.safeParse` in Effect terms, bound once at module scope. */
const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);

import { encodeHostLocation, LOCAL_LOCATION } from "@kolu/padi-client/surface";
import { currentPtyHostIdentity as expectedKavalIdentity } from "kaval";
import { log } from "../log.ts";
import { readDaemonStatus, setAdoptedCount } from "../ptyHost/daemonStatus.ts";
import { ptyHostClient } from "../ptyHost/index.ts";
import {
  getLastPairedDaemon,
  isReplacedDaemon,
  recordPairedDaemon,
} from "../session/pairedDaemon.ts";
import { reconcile } from "../session/reconcile.ts";
import {
  clearSavedSession,
  getSavedSession,
  saveSession,
} from "../session/session.ts";
import { getTerminal, terminalEntries } from "../terminal-registry.ts";
import { restoreActiveTerminalId, snapshotSession } from "../terminals.ts";
import {
  adoptLocalOrphan,
  adoptLocalTerminal,
  dropVanishedTerminal,
  reapUnrepresentablePty,
  rewireLocalSurvivor,
  seedParkedTerminal,
  seedSleepingTerminal,
} from "./local.ts";

/** Park the saved session on the NO-SURVIVOR boot / restart path — the twin of
 *  `adoptSurvivingSession` for a FRESH (recycled) daemon, where nothing live
 *  survives. Runs when `adoptOrEnsure` did NOT adopt (a cold boot, or the
 *  supervised daemon restart's reattach step), REPLACING the old no-op that left
 *  the saved session for the client to respawn.
 *
 *  Seeds a PARKED registry entry for every saved ACTIVE record (copying its
 *  `lastActivityAt` — RISK Q6) so:
 *    - the restore card's "resume" rows are backed by live registry records the
 *      client filters OUT of the canvas tile set (a parked record never renders
 *      as a tile), keeping the canvas EMPTY so the restore card shows;
 *    - `session.restore` re-spawns each terminal by CONSUMING its parked entry
 *      (the parked→active flip is the restore idempotency token).
 *
 *  SLEEPING records are DELIBERATELY NOT seeded here (RISK Q3 — never park a
 *  sleeping record, and don't render it as a dormant tile either). Seeding a
 *  sleeping record would flip the canvas to `workspace` (a dormant tile counts as
 *  a tile) and hide the restore card — breaking the byte-identical no-survivor UX
 *  (a slept-only session must still surface the restore card after a restart, and
 *  `restoreSession` re-seeds the sleeper dormant on click). The sleeping rows on
 *  the restore card ride the saved session the client still reads; the SURVIVOR
 *  path (`adoptSurvivingSession`) DOES seed sleeping, because there it renders as
 *  a dormant tile ALONGSIDE the adopted live tiles (no restore card) — unchanged.
 *
 *  Sets the active marker (WITHOUT firing `terminals:dirty`) so a later restore's
 *  `snapshotSession` keeps the active tile; does NOT persist here — the saved
 *  session already holds the pre-reboot records the parked entries stand in for,
 *  and `snapshotSession` skips parked (a save would be a no-op at best). */
export function parkSavedSession(): void {
  const saved = getSavedSession();
  log.info(
    { saved: saved ? saved.terminals.length : null },
    `session-trace park: getSavedSession=${saved ? `${saved.terminals.length} terminals` : "null"}`,
  );
  if (!saved) {
    log.warn({}, "session-trace park: no saved session, nothing to park");
    return;
  }
  let seeded = 0;
  for (const record of saved.terminals) {
    if (record.state === "active") {
      seedParkedTerminal(record);
      seeded++;
    }
  }
  restoreActiveTerminalId(saved.activeTerminalId ?? null);
  log.info({ seeded }, `session-trace park: seeded ${seeded} parked`);
}

/** Adopt a live survivor from the DAEMON SNAPSHOT alone — the shape used both for
 *  a PTY with no saved record (F1) and for one whose record did not decode
 *  (#2122). Returns whether it was adopted.
 *
 *  Validates the wire id against `TerminalIdSchema` at this boundary (the contract
 *  doc assigns id validation to kolu-server — ptyHostSurface.ts:36) so
 *  `adoptLocalOrphan` receives a branded `TerminalId`, not a re-cast raw string. A
 *  malformed (non-UUID) id is FAIL-CLOSED — the live PTY is KILLED
 *  (`reapUnrepresentablePty`), never left running hidden (F1): every real client
 *  mints a UUID (`crypto.randomUUID()` — kolu-server and kaval-tui alike), so a
 *  non-UUID PTY is an anomaly outside kolu's domain. kolu cannot register it (the
 *  registry is keyed on `TerminalId`), and leaving it alive would be a hidden live
 *  process behind a stale restore card — exactly the fail-open the boot recycle
 *  (index.ts) guards against. So it is killed rather than dropped and forgotten;
 *  the contract's kill RPC takes the opaque wire string.
 *
 *  Note the deliberate asymmetry with an undecodable RECORD: an unusable *id*
 *  leaves kolu no way to hold the terminal at all, while an unusable *record*
 *  costs only the chrome beside a perfectly usable PTY. */
function adoptSurvivorAsOrphan(entry: PtyHostListEntry): boolean {
  const parsed = decodeTerminalId(entry.id);
  if (Result.isFailure(parsed)) {
    reapUnrepresentablePty(entry.id);
    return false;
  }
  adoptLocalOrphan(parsed.success, entry);
  return true;
}

/**
 * What a mid-session LINK heal runs where the boot runs {@link adoptSurvivingSession}
 * (juspay/kolu#2182) — re-wire the taps of the terminals padi already holds, and
 * nothing else.
 *
 * The two are not variants of one verb and must not be merged back. Adoption
 * answers "what was running before I existed?", which is a question only the
 * saved session can answer; a heal already knows, because its registry never
 * emptied. Handing a heal the boot's answer is how a repair rewinds a user's
 * layout to the last autosave and persists it, wipes a tile born inside the
 * autosave debounce, announces a boot adoption of a session that never left, and
 * reaps a "half-wired orphan" the user is actively typing into.
 *
 * FAILS when it could not finish, and that failure is NOT the boot's. The boot
 * answers an unfinished reconcile by recycling the daemon, because an unlistable
 * survivor may hold PTYs kolu never registered. Mid-session every live PTY
 * already HAS an entry, so there is no hidden-terminal hazard — and a recycle
 * would destroy the session this exists to save. The heal's converge therefore
 * carries `onAdoptFailure: "report"`, which turns this failure into the
 * `incomplete` verdict: nothing is killed, nothing is announced, and the healer's
 * next attempt runs it again. Succeeding quietly with the taps down would be
 * worse than either — the loop would cancel on `connected` and no next attempt
 * would ever come.
 *
 * It also syncs MEMBERSHIP, not just sensors. A PTY that exited while the link
 * was down is absent from `list()`, and nothing else will ever notice: the
 * inventory reconciler's exited arm is deliberately a no-op because "every
 * terminal kolu tracks has a per-id exit tap" — and that tap died with the link.
 * Boot adoption got this for free by reconciling live-against-saved; dropping
 * that verb dropped this with it, so the heal has to do it explicitly or leave
 * dead shells on the canvas as live tiles forever.
 */
export const rewireSurvivingSession: Effect.Effect<void, unknown> = Effect.gen(
  function* () {
    // The membership sweep's CANDIDATES, read BEFORE the list is asked for. The
    // ordering is the whole safety of it: a terminal created or woken while the
    // list is in flight gets its real pid after the snapshot the daemon answered
    // with, so it is legitimately absent from that snapshot — and sweeping the
    // registry as it stands AFTER the await would read that absence as an exit
    // and tear down a terminal that is starting up. `handleExit` does not kill
    // the kaval PTY, so the tile would vanish while the shell kept running.
    // Only ids padi already held before it asked can be judged by the answer.
    const candidates = new Set(
      [...terminalEntries()]
        .filter(([, entry]) => entry.info.pid !== 0)
        .map(([id]) => id),
    );
    // Propagates on purpose — see the note above. `incomplete`, not a recycle.
    const live = (yield* ptyHostClient.surface.terminal.list({})).entries;
    const liveIds = new Set(live.map((e) => e.id));

    let rewired = 0;
    let unknown = 0;
    let failed = 0;
    for (const entry of live) {
      const outcome = rewireLocalSurvivor(entry);
      if (outcome === "rewired") rewired += 1;
      else if (outcome === "unknown") unknown += 1;
      else failed += 1;
    }

    // MEMBERSHIP: an active terminal we hold that the daemon no longer lists
    // exited while we could not see it. Its exit tap died with the link, so this
    // is the only place that fact can still be observed.
    let vanished = 0;
    for (const id of candidates) {
      if (liveIds.has(id)) continue;
      // Still held? A kill or exit that landed while we were listing has already
      // removed it, and dropping it twice would publish a second exit.
      if (!getTerminal(id)) continue;
      dropVanishedTerminal(id);
      vanished += 1;
    }

    // `unknown` is not a fault: a PTY created out-of-band while the link was down
    // has no registry entry yet, and discovering those is the inventory
    // reconciler's standing job — not something to invent an entry for here.
    log.info(
      { rewired, unknown, vanished, failed },
      "re-wired surviving terminals after a link heal",
    );
    // A terminal whose sensors did not come back is a terminal kolu is blind to.
    // Fail so the heal reports `incomplete` and the loop tries again, rather than
    // announcing a restored link over a tile nothing is watching.
    if (failed > 0) {
      return yield* Effect.fail(
        new Error(
          `link heal could not re-wire ${failed} of ${live.length} surviving terminals`,
        ),
      );
    }
  },
);

/** Reconcile a SURVIVING kaval daemon's live PTYs against the saved session and
 *  adopt the survivors. See the module doc. Runs at BOOT and only at boot — its
 *  premises are an empty registry and a saved session that is the only surviving
 *  record of what was running. A mid-session heal has neither, and runs
 *  {@link rewireSurvivingSession} instead (juspay/kolu#2182); the two must not be
 *  merged back into one verb.
 *
 *  FAILS if it cannot list the survivor's PTYs (F3): a connected daemon holding
 *  PTYs kolu has no registry entry for is a fail-closed condition — the boot
 *  recycles it rather than leaving hidden live PTYs behind a stale restore card.
 *  That answer is the boot's alone; the same failure during a heal reports
 *  `incomplete` and retries, because mid-session there are no unregistered PTYs
 *  to fail closed against and a recycle would destroy a live session.
 *  Every per-terminal adoption failure is contained (it reaps just that PTY), so
 *  the only failure is the all-or-nothing `list`. */
export const adoptSurvivingSession: Effect.Effect<void, unknown> = Effect.gen(
  function* () {
    // Fail CLOSED on a list failure (F3): let it propagate so the boot recycles the
    // survivor. Absorbing it here would leave the endpoint connected to a daemon
    // whose PTYs kolu never registered — invisible live terminals behind a stale
    // restore card, and a duplicate-terminal hazard if the user restored it.
    const live = (yield* ptyHostClient.surface.terminal.list({})).entries;

    const saved = getSavedSession();

    // Is the adopted daemon OUR survivor, or a REPLACED kaval (restarted out-of-band,
    // reachable at the same socket)? `adoptOrEnsure` adopts on gate + socket +
    // handshake alone and cannot tell — so gate the converge on daemon IDENTITY. A
    // replacement's live PTYs are not our saved session's, and converging against them
    // (an empty daemon → an empty registry → `saveSession([])`'s empty→null) ERASES the
    // saved session with no restore card ever shown — the zest incident. Compare the
    // connected daemon's per-process `startedAt` against the pairing we persisted last
    // boot; `recordCurrentPairing` (onBootSettled) records THIS daemon for next time.
    const currentStartedAt = readDaemonStatus(
      encodeHostLocation(LOCAL_LOCATION),
    )?.startedAt;
    if (
      isReplacedDaemon({
        currentStartedAt,
        lastPaired: getLastPairedDaemon(),
        live,
        saved,
      })
    ) {
      // A replaced daemon is a NO-SURVIVOR boot in disguise: preserve the saved
      // session and PARK its actives for the restore card — the exact `onNotAdopted`
      // flow. Never reach the converge below (that is the erase).
      log.warn(
        { currentStartedAt },
        "boot adopted a REPLACED kaval (not our survivor) — preserving saved session, parking for restore",
      );
      parkSavedSession();
      return;
    }

    const { plan, adoptOrphans, reapSleeping } = reconcile(live, saved);

    // Adopt every live PTY — never reap (F1). A survivor WITH a saved record rides
    // its whole record through (`adoptLocalTerminal`); a survivor with NO saved
    // record (a create that never reached the debounced autosave) is adopted from
    // the live daemon snapshot (`adoptLocalOrphan`). Killing the latter merely
    // because the debounced session lagged the daemon would break the headline
    // "terminals survive a kolu update" guarantee. `reconcile` already paired each
    // adopted record with its live PTY, so there is no join to redo here.
    //
    // A record this build cannot DECODE takes the orphan path too (#2122) — the
    // PTY is alive either way, and "never reap a survivor" does not become false
    // because the record beside it is unreadable. Before, the decode threw, this
    // whole Effect failed, and the boot's fail-closed arm recycled the daemon —
    // one record written by a wider-vocabulary build cost the host every terminal
    // it had. The terminal comes back as a live shell without its saved chrome.
    let adoptedWhole = 0;
    let orphansAdopted = 0;

    // Dispatch `reconcile`'s ordered PLAN — adopt an active whose PTY survived,
    // seed a sleeping one dormant (it has no PTY to adopt, and would otherwise
    // be absent from the registry and wiped by the converge below; that seeding
    // is what makes a slept terminal survive a restart and ride the wire as ☾).
    // A malformed record drops itself (tolerant).
    //
    // The ORDER is the plan's, and it matters because the registry is a `Map`
    // whose insertion order IS the client's row order (see `registerTerminal`).
    // Seeding every sleeper after every adopted active — which two passes did —
    // moved every ☾ tile to the bottom of its repo section on a padi restart,
    // and could take a whole section with it, renumbering `Cmd+1..9`. Invisible
    // while the dock re-sorted everything by recency; load-bearing since #2141
    // made dock order structural.
    //
    // `reconcile` owns the join and the walk over `saved.terminals`, so this is
    // a dispatch rather than a second derivation of both.
    for (const step of plan) {
      if (step.kind === "seedSleeping") {
        seedSleepingTerminal(step.record);
        continue;
      }
      if (adoptLocalTerminal(step.record, step.live)) {
        adoptedWhole += 1;
        continue;
      }
      if (adoptSurvivorAsOrphan(step.live)) orphansAdopted += 1;
    }
    // True orphans last — a create the debounced autosave never saw, so it has no
    // saved position to honour and IS the newest thing on the host.
    for (const orphan of adoptOrphans) {
      if (adoptSurvivorAsOrphan(orphan)) orphansAdopted += 1;
    }

    const adoptedCount = adoptedWhole + orphansAdopted;
    // Adopt-or-REAP the crash-window survivors: a sleep that persisted the dormant
    // record but crashed before the PTY kill completed leaves a PTY whose id is a
    // sleeping saved id. The record is sleeping, so REAP the orphan (never re-wake) —
    // the cold path converges with no orphan PTY (the reboot-mid-sleep journey).
    for (const orphan of reapSleeping) {
      log.info(
        { terminal: orphan.id },
        "reaping a sleeping terminal's crash-surviving PTY",
      );
      // Fire-and-forget, DETACHED: the reap is best-effort cleanup whose failure is
      // logged and never propagates, and it must not be interrupted by this boot
      // finishing before the daemon answers.
      yield* Effect.forkDetach(
        Effect.catch(
          ptyHostClient.surface.terminal.kill({ id: orphan.id }),
          (err) =>
            Effect.sync(() =>
              log.error(
                { err, terminal: orphan.id },
                "reap of sleeping PTY failed",
              ),
            ),
        ),
        { startImmediately: true },
      );
    }

    // Converge the saved session to exactly what is now live or dormant: exited
    // terminals drop out (no stale restore card), and the active marker is kept iff
    // its terminal is still present (adopted active OR seeded sleeping).
    restoreActiveTerminalId(
      saved?.activeTerminalId && getTerminal(saved.activeTerminalId)
        ? saved.activeTerminalId
        : null,
    );
    // An empty registry here means our GENUINE survivor (identity-gated above)
    // reported all its PTYs exited during downtime — the terminals truly ended, so
    // clear, exactly `handleExit`'s behaviour (2b). Spelled as an explicit clear
    // rather than an incidental `saveSession([])` empty→null so it reads as an
    // OBSERVED all-exited on a daemon we KNOW is ours — the only boot writer allowed
    // to empty the session, and only because the replaced-daemon path returned above
    // (2c). Every other empty is a spurious transient that must never clear.
    const converged = snapshotSession();
    if (converged.terminals.length === 0) clearSavedSession();
    else saveSession(converged);

    // Record THIS daemon as our confirmed survivor — recorded only here, on the
    // survivor path (never when parking a replaced/no-survivor session onto a fresh
    // daemon), so the next boot's `startedAt` tiebreak sees the process that actually
    // held our terminals. It only decides the empty-live case (2b clear vs replaced);
    // a live-PTY id match makes the pairing moot on every other path.
    recordPairedDaemon(currentStartedAt);

    if (adoptedCount > 0) {
      setAdoptedCount(encodeHostLocation(LOCAL_LOCATION), adoptedCount);
      log.info(
        { adopted: adoptedWhole, orphansAdopted },
        "adopted surviving terminals after restart",
      );
    }

    // Currency diagnostic (B3.4): the adopted daemon's REPORTED build vs the kaval
    // this server WOULD spawn (its own baked `KAVAL_BUILD_ID`). When they differ
    // the survivor is a build behind — adoption (B3.3) kept a wire-compatible-but-
    // older daemon alive, so the rail's read-site `kavalStale` nudge fires ("update
    // pending") and a restart picks up the new build. Logged here — the one place
    // adoption is confirmed — as the two RAW staleKeys, so operators (and the
    // build-skew VM gate) can read "running X, would spawn Y" in the journal. The
    // nudge PREDICATE (the connected-gate + empty-guard comparison) lives in the
    // client's `kavalStale`; this is observability, not a second source of truth.
    const status = readDaemonStatus(encodeHostLocation(LOCAL_LOCATION));
    const running = status?.identity?.staleKey ?? "";
    const expected = expectedKavalIdentity().staleKey;
    // Current padi always reports an identity object for `connected`: a
    // pre-fragment kaval gets the honest-unknown `{ staleKey: "", ... }`, which is
    // expected to differ from a known baked build and drive the update nudge. Only
    // a MISSING identity object is still a status-propagation anomaly (or an older
    // padi's retained wire shape); keep that diagnostic without mislabeling the
    // intentional empty staleKey.
    if (
      status?.state === "connected" &&
      status.identity === undefined &&
      expected
    ) {
      log.error(
        { status },
        "kaval currency: adopted daemon status has no identity",
      );
    }
    log.info(
      { running, expected },
      `kaval currency on adopt: running=${running} expected=${expected}`,
    );
  },
);
