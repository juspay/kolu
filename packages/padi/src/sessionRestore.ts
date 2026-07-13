/**
 * `@kolu/padi/sessionRestore` — host-side session restore / import behind
 * `padiSurface.procedures.session.restore` / `.import`. This is the ONE writer of
 * the restore path: it replaces the deleted client respawn loop
 * (`useSessionRestore.ts`), so the browser fires a single `session.restore` and
 * padi re-spawns every terminal server-side.
 *
 * Lives in its OWN module — not `session.ts` — deliberately: restore reaches
 * DOWN into the lifecycle façade (`createTerminal`/`snapshotSession`), while
 * `terminals.ts` already reaches UP into `session.ts` (`saveSession`). Putting
 * restore in `session.ts` would close that into an import CYCLE
 * (`session ↔ terminals`); a separate module that imports BOTH (and is imported
 * by neither) keeps the graph acyclic.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { resumeFormFor } from "anyagent/cli";
import {
  type AutosaveFreeze,
  cancelPendingAutosave,
  freezeAutosave,
  unfreezeAutosave,
} from "./autosaveGate.ts";
import {
  clearSavedSession,
  getSavedSession,
  saveSession,
  setSavedSession,
} from "./session.ts";
import {
  getActiveTerminal,
  getTerminal,
  hasParkedTerminals,
} from "./terminal-registry.ts";
import {
  discardAllLocalParked,
  discardLocalParked,
  seedParkedTerminal,
  seedSleepingTerminal,
  TerminalSpawnRacedError,
} from "./terminalEndpoint/local.ts";
import {
  createTerminal,
  restoreActiveTerminalId,
  setTerminalParent,
  snapshotSession,
} from "./terminals.ts";
import type {
  SavedActiveTerminal,
  SavedSession,
  SavedTerminal,
} from "./vocab.ts";
import { backfillSavedSession, SavedSessionSchema } from "./vocab.ts";

/** Re-spawn one saved ACTIVE record as a FRESH live terminal, forwarding its
 *  restore-relevant chrome + the saved recency, and (opt-in) resuming its agent.
 *  Returns the new id, or null when this record is a REPEAT restore that must be
 *  skipped (its parked token was already consumed, or a live PTY already stands
 *  for it — the parked→active flip's idempotency: a double `session.restore`
 *  never duplicates a terminal).
 *
 *  The parked entry padi's boot reconcile produced under this id IS the
 *  idempotency token: consume it (`discardLocalParked`) as the terminal flips to
 *  a fresh active PTY. Two cases have no parked token yet still restore exactly
 *  once: (a) a session set AFTER boot (the e2e `test__set`, no parking ran) —
 *  restore directly; (b) a repeat restore whose terminal is already live —
 *  skip. */
function respawnActive(
  t: SavedTerminal,
  parentId: string | undefined,
  resume: boolean,
): string | null {
  const existing = getTerminal(t.id);
  if (existing?.meta.state === "parked") {
    // The parked→active flip — consume the token so a concurrent/repeat restore
    // finds it gone and skips this record (no duplicate terminal).
    discardLocalParked(t.id);
  } else if (getActiveTerminal(t.id)) {
    // Already restored to a live PTY (a repeat restore after the flip) — skip.
    return null;
  }
  const info = createTerminal(t.cwd, parentId, {
    themeName: t.themeName,
    canvasLayout: t.canvasLayout,
    subPanel: t.subPanel,
    rightPanel: t.rightPanel,
    intent: t.intent,
    // Carry the saved agent-resume facts onto the fresh terminal ONLY when actually
    // resuming, so the closing `saveSession(snapshotSession())` re-persists the EXACT
    // target, not `none` (the fold's `updateMemory` re-derives both live once the
    // resumed agent is re-observed; until then the saved value stands — a resume that
    // never lands, or a second unclean death right after restore, still finds the target
    // on disk). An OPTED-OUT terminal (`resume` false) spawns a genuine bare shell: it
    // has no agent to re-observe, so the fold would NEVER clear a seeded `exact` (its
    // `restoreTargetOf` is already `none`, so `updateMemory` never fires to overwrite the
    // seed) — the exact target would persist and a later WAKE would resume the very agent
    // the user declined. So drop both, leaving the bare shell's target at `none`.
    lastAgentCommand: resume ? t.lastAgentCommand : undefined,
    restoreTarget: resume ? t.restoreTarget : undefined,
    // Preserve the saved recency across the restart (RISK Q6) — without this the
    // fold reseeds the restored terminal to a fresh (never-active) recency and
    // the dock's recency ranking permanently collapses after a `session.restore`.
    // The parked record already copied this off the saved active record at park
    // time; here it rides the fresh spawn. (Distinct from the client-facing
    // `lifecycle.create`, which drops it so a genuinely fresh terminal gets
    // padi's clock.) `?? undefined` bridges `AgentMemory`'s honest `null`
    // (never-active) onto this input's `undefined` absence form — both fall
    // through to the SAME `seedMemory()` default, so the bridge can't lose the
    // never-active fact, only its spelling.
    lastActivityAt: t.lastActivityAt ?? undefined,
  });
  // Auto-launch the resume form of the previously captured agent command, if the
  // user didn't opt out. `resumeFormFor` switches on the fold-derived
  // `restoreTarget` (the SAME composition the wake path feeds a fresh spawn, so
  // restore and wake can't drift): `exact` re-targets the exact conversation,
  // `legacyMostRecent` the most-recent fallback, `none`/absent a bare shell. The
  // proxy handle queues the write until the PTY spawn resolves.
  if (resume) {
    const resumeForm = resumeFormFor(t.restoreTarget);
    if (resumeForm) getActiveTerminal(info.id)?.handle.write(`${resumeForm}\r`);
  }
  return info.id;
}

/** Restore the persisted session HOST-SIDE — the ONE restore writer (the client
 *  respawn loop is deleted). Reads the saved session, re-creates each terminal
 *  (active → spawn a FRESH PTY + optional agent-resume; sleeping → seed dormant),
 *  re-parents sub-terminals onto their freshly-spawned parents, then re-persists
 *  the live snapshot. Mirrors the client loop's essential structure MINUS the
 *  client-only canvas/active-tile protocol (a server has no viewport to center).
 *
 *  IDEMPOTENT: an ACTIVE record restores by CONSUMING the parked registry entry
 *  padi's boot reconcile produced (`respawnActive`), so a concurrent/repeat
 *  `session.restore` finds the token gone and no-ops rather than duplicating.
 *
 *  `resumeIds` is the per-terminal agent-resume opt-in set: a terminal absent
 *  from it wakes to a bare shell; ABSENT (`undefined`) resumes all — the SAME
 *  opt-out semantics the restore card offers today. */
export async function restoreSession(input: {
  resumeIds?: string[];
}): Promise<void> {
  const saved = getSavedSession();
  if (!saved) return;
  const resumeAll = input.resumeIds === undefined;
  const resumeSet = new Set(input.resumeIds ?? []);
  const optedIn = (id: string) => resumeAll || resumeSet.has(id);
  // Old id → new id: a restored active terminal gets a NEW id, so a sub-terminal
  // re-parents onto the fresh id; a sleeping one keeps its stable id.
  const oldToNew = new Map<string, string>();
  // The fresh actives this restore spawned, paired with the saved record each stands
  // for AND that spawn's own `ready` settle. `respawnActive` consumes the parked
  // idempotency token BEFORE the async spawn confirms, so a spawn that FAILS mid-restore
  // (a kaval death 100 ms after the user clicks Restore) unwinds to `finalizeRemoval` —
  // and the next autosave would then DELETE that terminal from the saved session
  // outright (CONF-6). We pair each respawn with its saved record + its `ready` promise
  // so a GENUINE spawn failure (ready REJECTED) can be RE-PARKED, and freeze the
  // autosave across the whole spawn window so no removal is ever journaled mid-restore.
  const activeRespawns: {
    newId: string;
    record: SavedActiveTerminal;
    ready: Promise<void> | undefined;
  }[] = [];
  const topLevel = saved.terminals.filter((t) => !t.parentId);
  const subTerminals = saved.terminals.filter(
    (t): t is SavedTerminal & { parentId: string } => t.parentId !== undefined,
  );

  // Restore ONE saved record into the live registry, threading `oldToNew`. A
  // SLEEPING record restores DORMANT — seed it (no PTY spawn, no resume; Wake does
  // that later), keeping its saved id (idempotent seed) so its canvas layout and
  // the active marker map 1:1. When `parentId` is given the sleeper is a SLEPT
  // SUB-TERMINAL (#1651): honor the saved state and re-parent onto the FRESH parent
  // id (NOT a fresh active split), respecting F3 (a sub hangs off a LIVE parent —
  // the restored parent; a slept parent closes its splits on sleep, so a
  // slept-sub-under-slept-parent never occurs). An ACTIVE record re-spawns a fresh
  // PTY (opt-in agent-resume) and maps old→new; a skipped repeat (`respawnActive` →
  // null) adds no mapping.
  const restoreRecord = (t: SavedTerminal, parentId?: string): void => {
    if (t.state === "sleeping") {
      seedSleepingTerminal(parentId !== undefined ? { ...t, parentId } : t);
      oldToNew.set(t.id, t.id);
      return;
    }
    const newId = respawnActive(t, parentId, optedIn(t.id));
    if (newId === null) {
      // `respawnActive` returns null ONLY for the already-live skip: this id already
      // stands for a live PTY (a repeat/concurrent restore, OR a PRIOR restore that
      // spawned THIS record live while a sibling failed — the mixed-outcome retry).
      // Map it to ITSELF so its still-parked children re-parent onto the LIVE terminal
      // instead of being dropped. Without the mapping a sub whose parent is already
      // live gets `oldToNew.get(parent) === undefined` and is skipped — but its parked
      // token would then linger FOREVER, pinning `hasParkedTerminals()` and suppressing
      // every later autosave (F2, the retry half of mixed parent/child settlement).
      // Nothing was spawned, so this record does NOT join `activeRespawns` (no `ready`
      // to await, no re-park on failure).
      oldToNew.set(t.id, t.id);
      return;
    }
    oldToNew.set(t.id, newId);
    // `t` is the active arm here (the sleeping branch returned above). Capture the
    // fresh proxy's `ready` promise NOW, while the entry is still the live shadow —
    // its SETTLE (fulfilled vs rejected) is the authoritative "did the spawn succeed",
    // read below without depending on later registry presence.
    activeRespawns.push({
      newId,
      record: t,
      ready: getActiveTerminal(newId)?.handle.ready,
    });
  };

  // Freeze the autosave for the ENTIRE spawn window (through the tail await below): a
  // respawn that fails mid-restore fires `terminals:dirty` via `finalizeRemoval`, and an
  // unfrozen autosave would journal that removal — deleting the terminal from the saved
  // session (CONF-6). Lifted in the `finally` by releasing THIS restore's own lease, so
  // a concurrent restart's freeze section is never thawed early.
  const freeze: AutosaveFreeze = freezeAutosave(
    "session restore (spawn window)",
  );
  try {
    for (const t of topLevel) restoreRecord(t);
    for (const t of subTerminals) {
      // A sub whose parent didn't restore (skipped as a repeat) is dropped —
      // there is no live parent to hang it off (F3).
      const parentId = oldToNew.get(t.parentId);
      if (parentId === undefined) continue;
      restoreRecord(t, parentId);
    }

    // Preserve the active marker across the restart (RISK Q1 host-side): map the
    // saved active id through `oldToNew` so it names the RESTORED terminal (a fresh
    // id for an active, the stable id for a sleeper).
    const savedActive = saved.activeTerminalId ?? null;
    restoreActiveTerminalId(
      savedActive === null ? null : (oldToNew.get(savedActive) ?? savedActive),
    );
    // Persist the now-live snapshot IMMEDIATELY — the optimistic restored actives, the
    // synchronous write the common-case (kaval alive) restore and the tests both rely
    // on. This snapshot NAMES every restored terminal, so even if a spawn later fails
    // and unwinds, the saved session still holds it (CONF-6: nothing is deleted).
    saveSession(snapshotSession());

    // Then wait for every fresh spawn to SETTLE (the proxy `ready` resolves on success,
    // rejects on failure) and reconcile the outcomes as a TREE (`reconcileRestoreSettlement`).
    // The autosave stayed FROZEN across this window, so any `finalizeRemoval → notifyDirty`
    // a failure fires could not journal a shrunken session; the snapshot written above is
    // the durable record.
    const settled = await Promise.allSettled(
      activeRespawns.map((a) => a.ready),
    );
    reconcileRestoreSettlement(
      activeRespawns.map((a) => ({
        newId: a.newId,
        record: a.record,
        parentIdMapped: a.record.parentId
          ? oldToNew.get(a.record.parentId)
          : undefined,
      })),
      settled,
    );
    // Re-persist the FINAL live snapshot now the window has settled. While the freeze
    // was held, a terminal that spawned FAST (a live sibling) could accrue padi-LOCAL
    // metadata — a theme / layout / panel / intent / active-marker change, all of which
    // mutate in-memory state and fire `terminals:dirty` with NO kaval RPC. Those pulses
    // were SUPPRESSED by the freeze and the `finally`'s `cancelPendingAutosave` would
    // drop the last armed one, so without this they'd sit committed-in-memory but never
    // reach disk until some later dirty pulse (F5). This capture closes that window.
    persistSettledRestoreSnapshot();
  } finally {
    unfreezeAutosave(freeze);
    cancelPendingAutosave();
  }
}

/** Reconcile the settled respawn outcomes as a TREE — the ONE place the mixed
 *  parent/child settlement (F2) and the kill-vs-infra discriminant (F3) are decided.
 *  Runs while the autosave is still FROZEN (its caller's `finally` releases the
 *  lease), so nothing here journals a shrunken session.
 *
 *  Two passes:
 *
 *  1. RE-PARK genuine spawn failures. A REJECTED settle is re-parked under its FRESH
 *     id (with the mapped parent) so the restore card re-offers it — the durable
 *     snapshot named it by that id, so the parked token stays consumable on a retry
 *     (a mismatched id would orphan the park forever and pin `hasParkedTerminals()`,
 *     suppressing every later autosave — CONF-6 / F1). We EXCLUDE the typed
 *     {@link TerminalSpawnRacedError}: a pre-ready KILL/SLEEP by a second client is an
 *     explicit newer intent, NOT an infrastructure failure — re-offering it would
 *     manufacture restore-pending state for a terminal the user just killed (F3). A
 *     spawn that SUCCEEDED but was killed/slept AFTER `ready` resolved leaves the
 *     settle FULFILLED, so it is already honored (never re-parked).
 *
 *  2. PROMOTE orphaned children. A restored ACTIVE child whose parent is NO LONGER a
 *     live terminal — its parent respawn failed for a PER-RECORD reason (a removed
 *     cwd, a pre-ready lifecycle race) and was re-parked in pass 1, or a second client
 *     killed the parent mid-restore — must not dangle under a parked/absent parent
 *     (which the canvas would hide). Spawn failures are NOT monotonic (a parent can
 *     reject while its later-queued child succeeds), so this reparents the live child
 *     to TOP-LEVEL, keeping its live PTY + agent visible. A SLEEPING (dormant) parent
 *     is a valid parent and is left alone. */
export function reconcileRestoreSettlement(
  respawns: {
    newId: string;
    record: SavedActiveTerminal;
    parentIdMapped: string | undefined;
  }[],
  settled: PromiseSettledResult<void>[],
): void {
  respawns.forEach((r, i) => {
    const outcome = settled[i];
    if (outcome?.status !== "rejected") return;
    if (outcome.reason instanceof TerminalSpawnRacedError) return; // F3: honor the kill/slept
    seedParkedTerminal({
      ...r.record,
      id: r.newId,
      parentId: r.parentIdMapped,
    });
  });
  for (const r of respawns) {
    if (!getActiveTerminal(r.newId as TerminalId)) continue; // failed / re-parked in pass 1
    if (r.parentIdMapped === undefined) continue; // already top-level
    const parent = getTerminal(r.parentIdMapped as TerminalId);
    if (!parent || parent.meta.state === "parked") {
      setTerminalParent(r.newId as TerminalId, null);
    }
  }
}

/** Persist the FINAL live snapshot after the spawn window settles — the F5 fix. The
 *  restore holds a PROCESS-WIDE autosave freeze across the whole `await` on every
 *  spawn's `ready`. If one spawn is slow (or a socket-open kaval wedges a single RPC),
 *  a terminal that already spawned stays fully interactive, and a padi-LOCAL setter
 *  ({@link setTerminalTheme} / {@link setCanvasLayout} / {@link setSubPanelState} /
 *  {@link setRightPanelState} / {@link setTerminalIntent} / {@link setTerminalParent} /
 *  {@link setActiveTerminalId}) mutates committed in-memory state and fires
 *  `terminals:dirty` WITHOUT waiting on kaval. The freeze suppresses that autosave and
 *  the caller's `cancelPendingAutosave` drops the last armed one — so the change is
 *  lost from persistence. Re-persisting the live snapshot once the window settles
 *  captures it.
 *
 *  GUARDED on {@link hasParkedTerminals}: a spawn that FAILED was re-parked in pass 1,
 *  and `snapshotSession` SKIPS parked records — persisting here would DELETE the
 *  re-parked terminal from disk (the CONF-6 shrink the pre-await optimistic snapshot
 *  exists to prevent). So a restore left with parked residue keeps that optimistic
 *  snapshot standing (the restore-pending state correctly suppresses autosave until the
 *  user resolves the card); only a CLEAN settle re-persists. This does NOT bound the
 *  forever-hang case (a wedged kaval whose `ready` never settles keeps the freeze held
 *  and never reaches here) — that residual is the pre-existing transport-layer gap (no
 *  per-request deadline on any kaval RPC), a sibling of the dispositioned #1719
 *  follow-up, not a padi-restore concern. */
export function persistSettledRestoreSnapshot(): void {
  if (hasParkedTerminals()) return;
  saveSession(snapshotSession());
}

/** FORFEIT the pending restore — the EXPLICIT "start fresh / discard my previous
 *  session" act behind `padiSurface.procedures.session.forfeit`. Discards every
 *  parked restore-card entry AND clears the saved session on disk, TOGETHER, as one
 *  user-intended step: the parked entries and the blob they stand for are the same
 *  restore offer, so forfeiting means dropping both atomically. Distinct from
 *  `lifecycle.create` (which no longer forfeits — creating a terminal leaves the
 *  restore offered) and from `restoreSession` (which CONSUMES the parked entries via
 *  the parked→active flip and re-persists the live session). A no-op-safe idempotent
 *  call: with no parked entries and no saved session it clears nothing. */
export function forfeitSession(): void {
  discardAllLocalParked();
  clearSavedSession();
}

/** Import a session blob and restore it host-side — the diagnostic "Import
 *  session" flow moved off the client. Backfills the imported blob to the
 *  current schema (idempotent on an already-current record), persists it as the
 *  saved session, then runs the restore path with the same `resumeIds`. */
export async function importSession(input: {
  session: SavedSession;
  resumeIds?: string[];
}): Promise<void> {
  const backfilled = SavedSessionSchema.parse(
    backfillSavedSession(input.session),
  );
  setSavedSession(backfilled);
  await restoreSession({ resumeIds: input.resumeIds });
}
