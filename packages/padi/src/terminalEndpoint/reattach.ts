import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Result, Schema } from "effect";
import type { PtyHostListEntry } from "kaval";

const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);

import type {
  SavedActiveTerminal,
  SavedSession,
} from "@kolu/padi-client/surface";
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
import { reconcile, type ReconcileStep } from "../session/reconcile.ts";
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
  for (const record of savedActiveRecords(saved)) {
    seedParkedTerminal(record);
    seeded++;
  }
  restoreActiveTerminalId(saved.activeTerminalId ?? null);
  log.info({ seeded }, `session-trace park: seeded ${seeded} parked`);
}

function adoptSurvivorAsOrphan(entry: PtyHostListEntry): boolean {
  const parsed = decodeTerminalId(entry.id);
  if (Result.isFailure(parsed)) {
    reapUnrepresentablePty(entry.id);
    return false;
  }
  adoptLocalOrphan(parsed.success, entry);
  return true;
}

export const rewireSurvivingSession: Effect.Effect<void, unknown> = Effect.gen(
  function* () {
    const candidates = new Set(
      [...terminalEntries()]
        .filter(([, entry]) => entry.info.pid !== 0)
        .map(([id]) => id),
    );
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

    let vanished = 0;
    for (const id of candidates) {
      if (liveIds.has(id)) continue;
      if (!getTerminal(id)) continue;
      dropVanishedTerminal(id);
      vanished += 1;
    }

    log.info(
      { rewired, unknown, vanished, failed },
      "re-wired surviving terminals after a link heal",
    );
    if (failed > 0) {
      return yield* Effect.fail(
        new Error(
          `link heal could not re-wire ${failed} of ${live.length} surviving terminals`,
        ),
      );
    }
  },
);

function savedActiveRecords(saved: SavedSession): SavedActiveTerminal[] {
  return saved.terminals.filter(
    (record): record is SavedActiveTerminal => record.state === "active",
  );
}

interface AdoptedCounts {
  adoptedWhole: number;
  orphansAdopted: number;
}

function adoptEveryRepresentable(
  plan: readonly ReconcileStep[],
  adoptOrphans: readonly PtyHostListEntry[],
): AdoptedCounts {
  let adoptedWhole = 0;
  let orphansAdopted = 0;
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
  for (const orphan of adoptOrphans) {
    if (adoptSurvivorAsOrphan(orphan)) orphansAdopted += 1;
  }
  return { adoptedWhole, orphansAdopted };
}

function reapSleepingSurvivors(
  reapSleeping: readonly PtyHostListEntry[],
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    for (const orphan of reapSleeping) {
      log.info(
        { terminal: orphan.id },
        "reaping a sleeping terminal's crash-surviving PTY",
      );
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
  });
}

function convergeSavedSession(saved: SavedSession | null): void {
  restoreActiveTerminalId(
    saved?.activeTerminalId && getTerminal(saved.activeTerminalId)
      ? saved.activeTerminalId
      : null,
  );
  const converged = snapshotSession();
  if (converged.terminals.length === 0) clearSavedSession();
  else saveSession(converged);
}

function surfaceAdoptedCount({
  adoptedWhole,
  orphansAdopted,
}: AdoptedCounts): void {
  const adoptedCount = adoptedWhole + orphansAdopted;
  if (adoptedCount === 0) return;
  setAdoptedCount(encodeHostLocation(LOCAL_LOCATION), adoptedCount);
  log.info(
    { adopted: adoptedWhole, orphansAdopted },
    "adopted surviving terminals after restart",
  );
}

function logKavalCurrency(): void {
  const status = readDaemonStatus(encodeHostLocation(LOCAL_LOCATION));
  const running = status?.identity?.staleKey ?? "";
  const expected = expectedKavalIdentity().staleKey;
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
}

export const adoptSurvivingSession: Effect.Effect<void, unknown> = Effect.gen(
  function* () {
    const live = (yield* ptyHostClient.surface.terminal.list({})).entries;
    const saved = getSavedSession();

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
      log.warn(
        { currentStartedAt },
        "boot adopted a REPLACED kaval (not our survivor) — preserving saved session, parking for restore",
      );
      parkSavedSession();
      return;
    }

    const { plan, adoptOrphans, reapSleeping } = reconcile(live, saved);
    const counts = adoptEveryRepresentable(plan, adoptOrphans);
    yield* reapSleepingSurvivors(reapSleeping);

    convergeSavedSession(saved);
    recordPairedDaemon(currentStartedAt);
    surfaceAdoptedCount(counts);
    logKavalCurrency();
  },
);
