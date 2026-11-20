import type {
  SavedActiveTerminal,
  SavedSession,
  SavedTerminal,
} from "@kolu/padi-client/surface";
import {
  backfillSavedSession,
  SavedSessionSchema,
  stripImportedTargetArgv,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { resumeFormFor } from "kolu-agents/vocab";
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

const decodeSavedSession = Schema.decodeUnknownSync(SavedSessionSchema);

type RespawnOutcome = "spawned" | "already-live";

function respawnActive(
  t: SavedTerminal,
  parentId: string | undefined,
  resume: boolean,
): RespawnOutcome {
  const existing = getTerminal(t.id);
  if (existing?.meta.state === "parked") {
    discardLocalParked(t.id);
  } else if (getActiveTerminal(t.id)) {
    return "already-live";
  }
  // Every field of both seed shapes is a `Schema.optionalKey`, which accepts an
  // ABSENT key and REJECTS a present `undefined` one (#17) — so an absent saved
  // value is OMITTED here, never spelled as `undefined`; the absence stays
  // unspellable at the source rather than relying on a downstream truthiness read.
  restoreSpawn(
    t.id,
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
      ...(resume && t.restoreTarget !== undefined
        ? { restoreTarget: t.restoreTarget }
        : {}),
      ...(t.lastActivityAt === null
        ? {}
        : { lastActivityAt: t.lastActivityAt }),
      ...(resume && t.promptedAt !== null ? { promptedAt: t.promptedAt } : {}),
    },
  );
  if (resume) {
    const resumeForm = resumeFormFor(t.restoreTarget);
    if (resumeForm) getActiveTerminal(t.id)?.handle.write(`${resumeForm}\r`);
  }
  return "spawned";
}

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
  const restored = new Set<string>();
  const activeRespawns: {
    record: SavedActiveTerminal;
    ready: Promise<void> | undefined;
  }[] = [];
  const unrestored: SavedTerminal[] = [];
  const topLevel = saved.terminals.filter((t) => !t.parentId);
  const subTerminals = saved.terminals.filter(
    (t): t is SavedTerminal & { parentId: string } => t.parentId !== undefined,
  );

  const restoreRecord = (t: SavedTerminal, parentId?: string): void => {
    if (t.state === "sleeping") {
      seedSleepingTerminal(parentId !== undefined ? { ...t, parentId } : t);
      restored.add(t.id);
      return;
    }
    const outcome = respawnActive(t, parentId, optedIn(t.id));
    restored.add(t.id);
    if (outcome === "already-live") return;
    activeRespawns.push({
      record: t,
      ready: getActiveTerminal(t.id)?.handle.ready,
    });
  };

  const freeze: AutosaveFreeze = freezeAutosave(
    "session restore (spawn setup)",
  );
  try {
    for (const t of topLevel) restoreRecord(t);
    for (const t of subTerminals) {
      if (!restored.has(t.parentId)) {
        unrestored.push(t);
        continue;
      }
      restoreRecord(t, t.parentId);
    }

    restoreActiveTerminalId(saved.activeTerminalId ?? null);
    const live = snapshotSession();
    if (unrestored.length > 0) {
      for (const t of unrestored) {
        if (t.state === "active") {
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

  await settleRestoreRespawns(
    activeRespawns.map((a) => ({
      ready: a.ready,
      record: a.record,
    })),
    unrestored,
  );

  if (unrestored.length > 0) {
    const ids = unrestored.map((t) => t.id).join(", ");
    throw new Error(
      `Session restore incomplete: ${unrestored.length} terminal(s) could not be restored (missing parent): ${ids}. Their resume tokens were preserved — retry restore or start fresh.`,
    );
  }
  return { activeTerminalId: getActiveTerminalId() };
}

export async function settleRestoreRespawns(
  respawns: {
    ready: Promise<void> | undefined;
    record: SavedActiveTerminal;
  }[],
  retained: readonly SavedTerminal[] = [],
): Promise<void> {
  const reparked: SavedActiveTerminal[] = [];
  await Promise.all(
    respawns.map(async (r) => {
      if (!r.ready) return;
      try {
        await r.ready;
      } catch (err) {
        if (!(err instanceof TerminalSpawnRacedError)) {
          seedParkedTerminal(r.record);
          reparked.push(r.record);
        }
      }
      promoteOrphanedRestoreChildren(respawns);
      persistSettledRestoreSnapshot({ reparked, retained });
    }),
  );
}

function parentWasLostToThisRestore(record: SavedActiveTerminal): boolean {
  const parentId = record.parentId;
  if (parentId === undefined) return false;
  const parent = getTerminal(parentId as TerminalId);
  return parent === undefined || parent.meta.state === "parked";
}

export function promoteOrphanedRestoreChildren(
  respawns: {
    record: SavedActiveTerminal;
  }[],
): void {
  for (const { record } of respawns) {
    const id = record.id as TerminalId;
    if (!getActiveTerminal(id)) continue;
    if (parentWasLostToThisRestore(record)) setTerminalParent(id, null);
  }
}

export function persistSettledRestoreSnapshot(mergeIn: {
  reparked: readonly SavedActiveTerminal[];
  retained?: readonly SavedTerminal[];
}): void {
  const live = snapshotSession();
  const seen = new Set(live.terminals.map((t) => t.id));
  const extras: SavedTerminal[] = [];
  for (const t of [...mergeIn.reparked, ...(mergeIn.retained ?? [])]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    extras.push(t);
  }
  saveSession({
    ...live,
    terminals: [...live.terminals, ...extras],
  });
}

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

export async function importSession(input: {
  session: SavedSession;
  resumeAgents?: boolean;
  optOutIds?: readonly string[];
}): Promise<void> {
  const backfilled = decodeSavedSession(backfillSavedSession(input.session));
  discardAllLocalParked();
  setSavedSession(stripImportedTargetArgv(backfilled));
  await restoreSession({
    resumeAgents: input.resumeAgents,
    optOutIds: input.optOutIds,
  });
}
