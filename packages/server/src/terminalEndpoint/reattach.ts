/**
 * Boot-time adoption (B3.3) — kolu's soul side of "terminals survive a deploy".
 *
 * When `ensureLocalEndpoint` ADOPTS a surviving kaval daemon (a redeploy that did
 * not change kaval's source — `adoptOrEnsure` returned `true`), the daemon's PTYs
 * are still alive. This orchestrates the reconciliation that the spine cannot (the
 * endpoint adopts a *connection*; kolu reconciles its *contents*), split into two
 * structurally-distinct phases so the round-1 "save the session on PARTIAL host
 * info" bug is impossible by type:
 *
 *   - `adoptSurvivingHost(scope)` reconciles + adopts ONE host and RETURNS its
 *     `HostAdoptionResult`. It has NO `saveSession` in scope and does NOT seed the
 *     sleeping records — it cannot converge the session, because it only knows about
 *     its own host. (Per host: list the daemon's live PTYs, join against the saved
 *     session FILTERED to this host's location, adopt every representable survivor,
 *     reap the crash-window sleeping PTYs, surface the "N reattached" count.)
 *   - `commitBootAdoption(sweep)` is the ONLY place that seeds the sleeping records
 *     and saves the session — and it requires a branded `CompleteHostSweep`, which
 *     only `completeSweep([...all host results])` can mint. Committing one host's
 *     result is a TYPE ERROR, so the session can never be saved on a subset of hosts.
 *
 * `adoptSurvivingSession` is the orchestrator index.ts wires as `onAdopted`: sweep
 * every registered host, then commit the complete sweep. One local host today, so
 * this is byte-identical to the pre-split single-pass adoption.
 *
 * Runs ONLY for a daemon that survived. A fresh / recycled boot has no survivors, so
 * the existing restore-card path is left untouched — B2 behavior, unchanged.
 */

import { currentPtyHostIdentity as expectedKavalIdentity } from "kaval";
import {
  type SavedSession,
  type SavedSleepingTerminal,
  TerminalIdSchema,
} from "kolu-common/surface";
import { log } from "../log.ts";
import { readDaemonStatus, setAdoptedCount } from "../ptyHost/daemonStatus.ts";
import { reconcile } from "../reconcile.ts";
import { getSavedSession, saveSession } from "../session.ts";
import { getTerminal } from "../terminal-registry.ts";
import {
  restoreActiveTerminalId,
  restoreSleepingTerminal,
  snapshotSession,
} from "../terminals.ts";
import { type HostScope, hostScopes, serverEndpointFor } from "./resolve.ts";

/** What reconciling ONE host's survivors yielded — everything the session-wide
 *  commit needs from this host, and NOTHING that lets this function converge the
 *  session on its own. `sleepingRecords` are this host's saved sleeping terminals
 *  (no PTY to adopt) for `commitBootAdoption` to seed once EVERY host is in. */
export interface HostAdoptionResult {
  readonly scope: HostScope;
  readonly adoptedCount: number;
  readonly sleepingRecords: readonly SavedSleepingTerminal[];
}

declare const completeSweepBrand: unique symbol;

/** Every host's `HostAdoptionResult`, gathered — the branded token that proves the
 *  sweep is COMPLETE. Only `completeSweep` mints it (from a full result list), so a
 *  caller cannot hand `commitBootAdoption` a single host's result: that is a TYPE
 *  error, which is what makes "save the session on partial host info" unspellable. */
export interface CompleteHostSweep {
  readonly [completeSweepBrand]: true;
  readonly results: readonly HostAdoptionResult[];
  readonly saved: SavedSession | null;
}

/** Mint a `CompleteHostSweep` from the results of sweeping EVERY host. The one
 *  construction site of the brand — the orchestrator calls it after the per-host
 *  loop, so by type the session is committed only with all hosts accounted for. */
export function completeSweep(
  results: readonly HostAdoptionResult[],
  saved: SavedSession | null,
): CompleteHostSweep {
  return { results, saved } as CompleteHostSweep;
}

/** Reconcile a SURVIVING host's live PTYs against the saved session and adopt the
 *  survivors — for ONE host. Returns its `HostAdoptionResult`; does NOT seed sleeping
 *  records, restore the active marker, or save the session (that is the complete
 *  sweep's job).
 *
 *  THROWS if it cannot list the survivor's PTYs (F3): a connected daemon holding PTYs
 *  kolu has no registry entry for is a fail-closed condition — the boot recycles it
 *  rather than leaving hidden live PTYs behind a stale restore card. Every per-terminal
 *  adoption failure is contained (it reaps just that PTY), so the only throw is the
 *  all-or-nothing `list`. */
export async function adoptSurvivingHost(
  scope: HostScope,
): Promise<HostAdoptionResult> {
  const endpoint = serverEndpointFor(scope);
  // Fail CLOSED on a list failure (F3): re-throw so the boot recycles the survivor.
  const live = await endpoint.listLivePtys();

  const saved = getSavedSession();
  // Reconcile against the saved records on THIS host's location only — a remote
  // host's records aren't reaped by another host's reconcile (the destructive
  // remote-prep filter inside `reconcile`).
  const { adopt, adoptOrphans, reapSleeping } = reconcile(
    live,
    saved,
    scope.location,
  );

  // Adopt every live PTY — never reap (F1). A survivor WITH a saved record rides its
  // whole record through (`adopt`); a survivor with NO saved record (a create that
  // never reached the debounced autosave) is adopted from the live daemon snapshot
  // (`adoptOrphan`), stamped with this host's location.
  for (const pair of adopt) endpoint.adopt(pair.record, pair.live);
  // Validate each orphan's wire id against `TerminalIdSchema` at this boundary so the
  // adopt receives a branded `TerminalId`, not a raw string. A malformed (non-UUID)
  // id is FAIL-CLOSED — the live PTY is killed, never left running hidden (F1).
  let orphansAdopted = 0;
  for (const orphan of adoptOrphans) {
    const parsed = TerminalIdSchema.safeParse(orphan.id);
    if (!parsed.success) {
      endpoint.reapUnrepresentablePty(orphan.id);
      continue;
    }
    endpoint.adoptOrphan(parsed.data, orphan, scope.location);
    orphansAdopted += 1;
  }

  const adoptedCount = adopt.length + orphansAdopted;

  // Adopt-or-REAP the crash-window survivors: a sleep that persisted the dormant
  // record but crashed before the PTY kill completed leaves a PTY whose id is a
  // sleeping saved id. The record is sleeping, so REAP the orphan (never re-wake).
  for (const orphan of reapSleeping) {
    log.info(
      { terminal: orphan.id },
      "reaping a sleeping terminal's crash-surviving PTY",
    );
    endpoint.reapDaemonPty(orphan.id);
  }

  // This host's sleeping saved records (no PTY to adopt) — handed to the complete
  // sweep to seed AFTER every host is reconciled, so the converge can't wipe a
  // not-yet-reconciled host's terminals.
  const sleepingRecords = (saved?.terminals ?? []).filter(
    (record): record is SavedSleepingTerminal => record.state === "sleeping",
  );

  if (adoptedCount > 0) {
    setAdoptedCount(scope.hostId, adoptedCount);
    log.info(
      { host: scope.hostId, adopted: adopt.length, orphansAdopted },
      "adopted surviving terminals after restart",
    );
  }

  // Currency diagnostic (B3.4): the adopted daemon's REPORTED build vs the kaval this
  // server WOULD spawn. When they differ the survivor is a build behind, so the rail's
  // read-site `kavalStale` nudge fires. Logged here — the one place adoption is
  // confirmed — as the two RAW staleKeys.
  const status = readDaemonStatus(scope.hostId);
  const running = status?.identity?.staleKey ?? "";
  const expected = expectedKavalIdentity().staleKey;
  if (status && !running && expected) {
    log.warn(
      { status },
      "kaval currency: adopted daemon status has no staleKey",
    );
  }
  log.info(
    { host: scope.hostId, running, expected },
    `kaval currency on adopt: running=${running} expected=${expected}`,
  );

  return { scope, adoptedCount, sleepingRecords };
}

/** Seed every host's sleeping records and CONVERGE the session — the ONLY place that
 *  writes the sleeping records to the registry and saves the session, gated on a
 *  branded `CompleteHostSweep` so it can only run with every host accounted for.
 *
 *  Seeds the sleeping records dormant (routed to each record's own host via the
 *  façade), then keeps the active marker iff its terminal survived (adopted active OR
 *  seeded sleeping) and persists the converged session — exited terminals drop out (no
 *  stale restore card); an empty registry clears the session (`saveSession` empty→null). */
export function commitBootAdoption(sweep: CompleteHostSweep): void {
  // Seed every SLEEPING saved record dormant BEFORE the converge — they have no PTY to
  // adopt, so without seeding they would be absent from the registry and wiped by the
  // converge below. Routed to each record's own host through the façade.
  for (const result of sweep.results) {
    for (const record of result.sleepingRecords)
      restoreSleepingTerminal(record);
  }

  const saved = sweep.saved;
  restoreActiveTerminalId(
    saved?.activeTerminalId && getTerminal(saved.activeTerminalId)
      ? saved.activeTerminalId
      : null,
  );
  saveSession(snapshotSession());
}

/** Reconcile EVERY surviving host, then commit the complete sweep — the orchestrator
 *  `ensureLocalEndpoint` runs as `onAdopted`. Sweeping each host independently and
 *  committing only the gathered whole is what forecloses the partial-save bug. One
 *  local host today; F-REMOTE's dialed hosts join the loop with no change here. */
export async function adoptSurvivingSession(): Promise<void> {
  const results: HostAdoptionResult[] = [];
  for (const scope of hostScopes()) {
    results.push(await adoptSurvivingHost(scope));
  }
  commitBootAdoption(completeSweep(results, getSavedSession()));
}
