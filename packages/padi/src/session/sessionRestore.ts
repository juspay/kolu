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

import type {
  SavedActiveTerminal,
  SavedSession,
  SavedTerminal,
} from "@kolu/padi-client/surface";
import {
  backfillSavedSession,
  SavedSessionSchema,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { resumeFormFor } from "anyagent/cli";
import { Schema } from "effect";
import { getActiveTerminal, getTerminal } from "../terminal-registry.ts";
import {
  discardAllLocalParked,
  discardLocalParked,
  seedParkedTerminal,
  seedSleepingTerminal,
  TerminalSpawnRacedError,
} from "../terminalEndpoint/local.ts";
import {
  getActiveTerminalId,
  restoreActiveTerminalId,
  restoreSpawn,
  setTerminalParent,
  snapshotSession,
} from "../terminals.ts";
import {
  type AutosaveFreeze,
  cancelPendingAutosave,
  freezeAutosave,
  unfreezeAutosave,
} from "./autosaveGate.ts";
import { resumableTerminalIds } from "./resumable.ts";
import {
  clearSavedSession,
  getSavedSession,
  saveSession,
  setSavedSession,
} from "./session.ts";
import { padiStateBackupRing } from "./stateStore.ts";

/** zod's `.parse`, in Effect terms — bound once at module scope (`decodeUnknownSync`
 *  compiles the schema on each application). Fail-fast by design: an IMPORTED blob
 *  that does not decode after the backfill ladder is a refusal, not a silent drop. */
const decodeSavedSession = Schema.decodeUnknownSync(SavedSessionSchema);

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
  // `restoreSpawn` — the ONE constructor that may seed the server-derived authored
  // facts, through its distinct `restoreOnly` arm (an ordinary `createTerminal` can't
  // spell them). Base chrome rides `initial`; the three restore-only facts ride
  // `restoreOnly`.
  // Every field of both seed shapes is a `Schema.optionalKey`, which accepts an
  // ABSENT key and REJECTS a present `undefined` one (#17) — so an absent saved
  // value is OMITTED here, never spelled as `undefined`. Same conditional-spread
  // idiom `settleRestoreRespawns` uses for `parentId` below; the absence stays
  // unspellable at the source rather than relying on a downstream truthiness read.
  const info = restoreSpawn(
    t.cwd,
    parentId,
    {
      ...(t.themeName === undefined ? {} : { themeName: t.themeName }),
      ...(t.canvasLayout === undefined ? {} : { canvasLayout: t.canvasLayout }),
      ...(t.subPanel === undefined ? {} : { subPanel: t.subPanel }),
      ...(t.rightPanel === undefined ? {} : { rightPanel: t.rightPanel }),
      ...(t.intent === undefined ? {} : { intent: t.intent }),
    },
    {
      // Carry the saved agent-resume facts ONLY when actually resuming, so the closing
      // `saveSession(snapshotSession())` re-persists the EXACT target, not `none` (the
      // fold's `updateMemory` re-derives both live once the resumed agent is re-observed;
      // until then the saved value stands — a resume that never lands, or a second unclean
      // death right after restore, still finds the target on disk). An OPTED-OUT terminal
      // (`resume` false) spawns a genuine bare shell: it has no agent to re-observe, so the
      // fold would NEVER clear a seeded `exact` (its `restoreTargetOf` is already `none`, so
      // `updateMemory` never fires to overwrite the seed) — the exact target would persist
      // and a later WAKE would resume the very agent the user declined. So drop both,
      // leaving the bare shell's target at `none`.
      ...(resume && t.lastAgentCommand !== undefined
        ? { lastAgentCommand: t.lastAgentCommand }
        : {}),
      ...(resume && t.restoreTarget !== undefined
        ? { restoreTarget: t.restoreTarget }
        : {}),
      // Preserve the saved recency across the restart (RISK Q6) — without this the fold
      // reseeds the restored terminal to a fresh (never-active) recency and the dock's
      // recency ranking permanently collapses after a `session.restore`. The parked record
      // already copied this off the saved active record at park time; here it rides the
      // fresh spawn. (Distinct from the client-facing `lifecycle.create`, which drops it so
      // a genuinely fresh terminal gets padi's clock.) `AgentMemory`'s honest `null`
      // (never-active) bridges onto this input's ABSENCE — omitting the key falls through
      // to the SAME `seedMemory()` default, so the bridge can't lose the never-active fact,
      // only its spelling.
      ...(t.lastActivityAt === null
        ? {}
        : { lastActivityAt: t.lastActivityAt }),
    },
  );
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
 *  Resume intent is host-owned: the host computes the resumable set from each
 *  record's `restoreTarget` ({@link resumableTerminalIds}); the client may only
 *  subtract via `optOutIds`. `resumeAgents: false` resumes none; `true` (default)
 *  resumes every host-resumable id not listed in `optOutIds`.
 *
 *  ANSWERS with the active-terminal marker as of the end of the restore — the
 *  saved marker mapped through `oldToNew`, read back from its ONE writer rather
 *  than re-derived. The client seeds its active tile from THIS answer. It used to
 *  read the `session` cell instead, and that is a race the client cannot win: the
 *  terminals are published as they spawn, while the cell's snapshot only publishes
 *  after `saveSession` has been through padi's Conf (a synchronous DISK write). On
 *  a loaded box the disk write outlasts the client's per-terminal metadata
 *  round-trips, so the client saw the full restored set while still holding the
 *  blob it CONSUMED — pre-restore ids, none of them live — and silently seeded the
 *  FIRST tile instead. Riding the call means the answer cannot arrive after the
 *  terminals it describes. */
export async function restoreSession(
  input: { resumeAgents?: boolean; optOutIds?: readonly string[] } = {},
): Promise<{ activeTerminalId: string | null }> {
  const saved = getSavedSession();
  if (!saved) return { activeTerminalId: getActiveTerminalId() };
  const resumeAgents = input.resumeAgents ?? true;
  const optOut = new Set(input.optOutIds ?? []);
  const hostResumable = new Set(resumableTerminalIds(saved.terminals));
  const optedIn = (id: string) =>
    resumeAgents && hostResumable.has(id) && !optOut.has(id);
  // Old id → new id: a restored active terminal gets a NEW id, so a sub-terminal
  // re-parents onto the fresh id; a sleeping one keeps its stable id.
  const oldToNew = new Map<string, string>();
  // The fresh actives this restore spawned, paired with the saved record each stands
  // for AND that spawn's own `ready` settle. `respawnActive` consumes the parked
  // idempotency token BEFORE the async spawn confirms, so a spawn that FAILS mid-restore
  // (a kaval death 100 ms after the user clicks Restore) unwinds to `finalizeRemoval` —
  // and the next autosave would then DELETE that terminal from the saved session
  // outright (CONF-6). We pair each respawn with its saved record + its `ready` promise
  // so a GENUINE spawn failure (ready REJECTED) can be RE-PARKED the instant it settles
  // (`settleRestoreRespawns`), which re-suppresses the autosave before any removal is
  // journaled — no process-wide freeze is held across the spawn window.
  const activeRespawns: {
    newId: string;
    record: SavedActiveTerminal;
    ready: Promise<void> | undefined;
  }[] = [];
  /** Saved records that could not be restored (e.g. parent missing from the
   *  session). Must stay on disk with their resume tokens and surface as a
   *  loud error — never silently dropped (fail-fast). */
  const unrestored: SavedTerminal[] = [];
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

  // Freeze the autosave for the SYNCHRONOUS spawn setup + optimistic persist ONLY —
  // NOT across the spawn `await` below. The fresh `createTerminal`s fire `terminals:dirty`
  // that would otherwise arm a save mid-setup; the freeze absorbs those so the ONE durable
  // write is the optimistic snapshot. It is lifted the instant that snapshot is on disk.
  //
  // Deliberately NOT held until every `ready` settles: a single wedged kaval RPC (socket
  // open, `spawn` never answered → `ready` never settles) would then pin the freeze
  // FOREVER and suppress a live sibling's padi-local metadata persistence for the whole
  // process lifetime (F5). Instead each respawn is compensated INDEPENDENTLY as it settles
  // (`settleRestoreRespawns`), so a never-settling spawn blocks no persistence. Released
  // by THIS restore's own lease so a concurrent restart's freeze section is never thawed
  // early.
  const freeze: AutosaveFreeze = freezeAutosave(
    "session restore (spawn setup)",
  );
  try {
    for (const t of topLevel) restoreRecord(t);
    for (const t of subTerminals) {
      // A sub whose parent is absent from the session (corrupt blob / missing
      // parent id) cannot hang off a live parent (F3). Do NOT silently drop it:
      // keep the record (and its resume token) and fail loudly after the rest
      // of the restore lands.
      const parentId = oldToNew.get(t.parentId);
      if (parentId === undefined) {
        // Corrupt / missing parent — keep the record on disk (with its resume
        // token) and fail loudly after the rest of the restore lands.
        unrestored.push(t);
        continue;
      }
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
    // Unrestored records are MERGED back in so their resume tokens never leave disk
    // (the silent-drop bug class).
    const live = snapshotSession();
    if (unrestored.length > 0) {
      for (const t of unrestored) {
        if (t.state === "active") {
          // Re-park so the restore card can offer them again; seed is idempotent
          // when the parked token was never consumed.
          seedParkedTerminal(t);
        }
      }
      saveSession({
        ...live,
        terminals: [...live.terminals, ...unrestored],
      });
    } else {
      saveSession(live);
    }
  } finally {
    unfreezeAutosave(freeze);
    cancelPendingAutosave();
  }

  // Settle every fresh spawn INDEPENDENTLY, with NO process-wide freeze held: each genuine
  // failure re-parks the instant ITS OWN `ready` settles, and the re-park's
  // `suppressed-parked` gate (a microtask that always beats the 500 ms autosave the
  // failure's `finalizeRemoval` arms) plus an eager re-persist keep the removal from ever
  // journaling a shrunken session (CONF-6) — replacing the blanket freeze with per-spawn
  // compensation. A spawn whose `ready` never settles leaves THIS await pending but pins no
  // persistence state, so a live sibling's metadata still reaches disk (the F5 fix).
  await settleRestoreRespawns(
    activeRespawns.map((a) => ({
      ready: a.ready,
      newId: a.newId,
      record: a.record,
      parentIdMapped: a.record.parentId
        ? oldToNew.get(a.record.parentId)
        : undefined,
    })),
    // Missing-parent records must ride every settle write — otherwise a
    // sibling spawn's `persistSettledRestoreSnapshot(live+reparked)` drops
    // them from disk and erases the resume tokens the optimistic merge kept.
    unrestored,
  );

  if (unrestored.length > 0) {
    const ids = unrestored.map((t) => t.id).join(", ");
    throw new Error(
      `Session restore incomplete: ${unrestored.length} terminal(s) could not be restored (missing parent): ${ids}. Their resume tokens were preserved — retry restore or start fresh.`,
    );
  }
  // Read the marker back from its ONE writer rather than re-deriving the mapping:
  // a spawn that failed and re-parked above cannot leave this answer disagreeing
  // with what the host actually holds. The id can still name a terminal that did
  // not come back (its respawn was re-parked), which is exactly why the client
  // re-validates membership before seeding.
  return { activeTerminalId: getActiveTerminalId() };
}

/** Settle the fresh restore respawns INDEPENDENTLY — the ONE place the mixed
 *  parent/child settlement (F2), the kill-vs-infra discriminant (F3), and the F5
 *  unbounded-freeze fix live. Runs with NO process-wide autosave freeze held: each
 *  genuine spawn failure is re-parked the INSTANT its OWN `ready` settles — never after
 *  the whole batch — so a sibling spawn that NEVER settles neither delays that
 *  compensation nor pins persistence.
 *
 *  A REJECTED settle re-parks under its FRESH id (with the mapped parent) so the restore
 *  card re-offers it — the durable optimistic snapshot named it by that id, so the parked
 *  token stays consumable on a retry (a mismatched id would orphan the park forever and
 *  pin `hasParkedTerminals()`, suppressing every later autosave — CONF-6 / F1). We EXCLUDE
 *  the typed {@link TerminalSpawnRacedError}: a pre-ready KILL/SLEEP by a second client is
 *  an explicit newer intent, NOT infrastructure failure — re-offering it would manufacture
 *  restore-pending state for a terminal the user just killed (F3). A spawn that SUCCEEDED
 *  but was killed/slept AFTER `ready` resolved leaves the settle FULFILLED, already honored.
 *
 *  The re-park is what keeps `finalizeRemoval` from journaling a shrunken session WITHOUT a
 *  held freeze: seeding the parked entry flips `isRestorePending()` true, and that seed runs
 *  on the rejection microtask — always draining before the 500 ms macrotask autosave the
 *  removal armed — so the fire decides `suppressed-parked` and never persists the shrink.
 *  The eager {@link persistSettledRestoreSnapshot} RETAINS the re-parked record (which
 *  `snapshotSession` skips) alongside every live sibling's freshest metadata.
 *
 *  {@link promoteOrphanedRestoreChildren} lifts children orphaned by a failed/parked parent
 *  (F2) and a merge is persisted after EACH spawn settles — NOT once after the whole batch.
 *  That incrementality matters: a parent A can reject and re-park while an UNRELATED spawn C
 *  never settles; if promotion waited on the batch `Promise.all`, C's wedge would keep A's
 *  successful child B hidden under A's parked entry forever. Running the reconcile inside
 *  each settle handler repairs B the instant A settles, independent of C. */
export async function settleRestoreRespawns(
  respawns: {
    ready: Promise<void> | undefined;
    newId: string;
    record: SavedActiveTerminal;
    parentIdMapped: string | undefined;
  }[],
  /** Records that must survive every settle write (e.g. missing-parent
   *  unrestored actives re-parked in the optimistic pass). Merged with
   *  reparked on each persist so a sibling spawn cannot erase them. */
  retained: readonly SavedTerminal[] = [],
): Promise<void> {
  const reparked: SavedActiveTerminal[] = [];
  await Promise.all(
    respawns.map(async (r) => {
      if (!r.ready) return;
      try {
        await r.ready;
      } catch (err) {
        if (err instanceof TerminalSpawnRacedError) {
          // F3: honor a second client's pre-ready kill/slept — never re-park. But its
          // removal may have orphaned a live child, so fall through to reconcile below
          // rather than returning early.
        } else {
          // OMIT `parentId` for a top-level record rather than spelling
          // `undefined`: it is a `Schema.optionalKey` field, which accepts an
          // ABSENT key and REJECTS a present `undefined` one (#17). Spelling it
          // would make `seedParkedTerminal`'s tolerant decode DROP the record —
          // silently losing the very re-park this path exists to perform.
          const record: SavedActiveTerminal = {
            ...r.record,
            id: r.newId,
            ...(r.parentIdMapped === undefined
              ? {}
              : { parentId: r.parentIdMapped }),
          };
          seedParkedTerminal(record); // idempotent — a repeat settle no-ops
          reparked.push(record);
        }
      }
      // Reconcile orphans across ALL respawns the INSTANT this one settles — NOT gated
      // behind the whole batch's `Promise.all` (F2). A parent that just parked/removed
      // itself here has orphaned any live child of its own; promoting incrementally means
      // an UNRELATED never-settling sibling spawn can no longer strand that child under a
      // hidden parent for the process lifetime. Then persist the merged live+re-parked
      // (+ retained unrestored) snapshot so the promotion (and any re-park) reaches disk
      // without awaiting the batch.
      promoteOrphanedRestoreChildren(respawns);
      persistSettledRestoreSnapshot(reparked, retained);
    }),
  );
}

/** Promote children orphaned by a failed/parked parent to TOP-LEVEL (F2). A restored
 *  ACTIVE child whose parent is NO LONGER a live terminal — its parent respawn failed for a
 *  PER-RECORD reason (a removed cwd, a pre-ready lifecycle race) and was re-parked, or a
 *  second client killed the parent mid-restore — must not dangle under a parked/absent
 *  parent (which the canvas would hide). Spawn failures are NOT monotonic (a parent can
 *  reject while its later-queued child succeeds), so reparent the live child to TOP-LEVEL,
 *  keeping its live PTY + agent visible. A SLEEPING (dormant) parent is a valid parent and
 *  is left alone. */
export function promoteOrphanedRestoreChildren(
  respawns: {
    newId: string;
    parentIdMapped: string | undefined;
  }[],
): void {
  for (const r of respawns) {
    if (!getActiveTerminal(r.newId as TerminalId)) continue; // failed / re-parked
    if (r.parentIdMapped === undefined) continue; // already top-level
    const parent = getTerminal(r.parentIdMapped as TerminalId);
    if (!parent || parent.meta.state === "parked") {
      setTerminalParent(r.newId as TerminalId, null);
    }
  }
}

/** Persist the merged live+re-parked snapshot after a respawn settles — part of the F5
 *  fix. During the spawn window a terminal that already spawned stays fully interactive, and
 *  a padi-LOCAL setter ({@link setTerminalTheme} / {@link setCanvasLayout} /
 *  {@link setSubPanelState} / {@link setRightPanelState} / {@link setTerminalIntent} /
 *  {@link setTerminalParent} / {@link setActiveTerminalId}) mutates committed in-memory state
 *  and fires `terminals:dirty` WITHOUT waiting on kaval. Re-persisting the live snapshot as
 *  each spawn settles captures those — and, crucially, because no process-wide freeze is held
 *  across the spawn `await`, a live sibling's change ALSO persists through the normal
 *  autosave gate while spawns are still in flight, so a wedged kaval (a `ready` that never
 *  settles) can no longer suppress it for the process lifetime.
 *
 *  MERGES the live snapshot with `reparked` — the genuine-failure records
 *  {@link settleRestoreRespawns} re-parked. `snapshotSession` SKIPS parked records, so
 *  persisting it ALONE would DELETE a re-parked terminal from disk (the CONF-6 shrink the
 *  optimistic snapshot exists to prevent). Threading the re-parked set back in RETAINS
 *  exactly those records while still capturing every live sibling's freshest metadata — so a
 *  MIXED outcome (a live sibling changed AND a sibling failed + re-parked) persists BOTH,
 *  rather than choosing between saving only-live (drops the re-park) and saving-nothing
 *  (drops the live change — F5). The re-parked ids can't collide with the live snapshot (a
 *  parked entry is excluded from it), and a raced-kill (honored, never re-parked, never live)
 *  is in NEITHER set → correctly removed from disk. */
export function persistSettledRestoreSnapshot(
  reparked: SavedActiveTerminal[],
  retained: readonly SavedTerminal[] = [],
): void {
  const live = snapshotSession();
  // Live wins id collisions; then reparked (spawn failures); then retained
  // unrestored records (e.g. missing-parent) that snapshotSession never sees.
  const seen = new Set(live.terminals.map((t) => t.id));
  const extras: SavedTerminal[] = [];
  for (const t of [...reparked, ...retained]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    extras.push(t);
  }
  saveSession({
    ...live,
    terminals: [...live.terminals, ...extras],
  });
}

/** FORFEIT the pending restore — the EXPLICIT "start fresh / discard my previous
 *  session" act behind `padiSurface.procedures.session.forfeit`. Discards every
 *  parked restore-card entry AND clears the saved session on disk, TOGETHER, as one
 *  user-intended step: the parked entries and the blob they stand for are the same
 *  restore offer, so forfeiting means dropping both atomically. Distinct from
 *  `lifecycle.create` (which no longer forfeits — creating a terminal leaves the
 *  restore offered) and from `restoreSession` (which CONSUMES the parked entries via
 *  the parked→active flip and re-persists the live session). A no-op-safe idempotent
 *  call: with no parked entries and no saved session it clears nothing.
 *
 *  SNAPSHOTS FIRST, and refuses to proceed if that snapshot fails. Forfeit is the
 *  only verb in padi whose whole job is to destroy user data, so it is exactly the
 *  class the state-backup ring (#1658) exists for — `backups.restore` already
 *  pushes the current state file into the ring "so the restore is itself undoable",
 *  and the same must hold for the one act that discards N terminals on a single
 *  click. The ring's `snapshot()` is fail-SOFT by design (a typed outcome, never a
 *  throw) because on the BOOT path a backup is a safety net and not a gate; HERE the
 *  safety net IS the gate, so a `failed` outcome throws rather than degrading to an
 *  unrecoverable discard, and the session survives to be forfeited again once
 *  whatever broke the ring (a full disk, a read-only state root) is fixed.
 *  `no-state-file` is not a failure — there is no saved blob to lose, so the forfeit
 *  destroys nothing on disk — and `unchanged` means the ring already holds a
 *  byte-identical copy, which is precisely the recoverability this gate asks for. */
export function forfeitSession(stateRoot: string): void {
  const snapshot = padiStateBackupRing(stateRoot).snapshot();
  if (snapshot.kind === "failed") {
    throw new Error(
      "refusing to forfeit the session: the state backup snapshot failed, so this discard would not be recoverable",
    );
  }
  discardAllLocalParked();
  clearSavedSession();
}

/** Import a session blob and restore it host-side — the diagnostic "Import
 *  session" flow moved off the client. Backfills the imported blob to the
 *  current schema (idempotent on an already-current record), persists it as the
 *  saved session, then runs the restore path with the same resume intent.
 *  Answers nothing: neither of its two callers (`session.import`,
 *  `backups.restore`) seeds a view from the call — both restore a blob the user
 *  just chose — so an active-marker here would be shape for its own sake, which
 *  is exactly the argument the 5.1 ledger note makes about `session.import`.
 *  `session.restore`, whose client DOES seed its active tile from the call,
 *  keeps its answer. */
export async function importSession(input: {
  session: SavedSession;
  resumeAgents?: boolean;
  optOutIds?: readonly string[];
}): Promise<void> {
  const backfilled = decodeSavedSession(backfillSavedSession(input.session));
  setSavedSession(backfilled);
  await restoreSession({
    resumeAgents: input.resumeAgents,
    optOutIds: input.optOutIds,
  });
}
