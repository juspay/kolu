/**
 * `@kolu/padi/sessionRestore` — host-side session restore / import behind
 * `padiSurface.procedures.session.restore` / `.import`. The thin real impl W1.R0
 * lands (the full parked-state production + boot reconcile is R6): it moves the
 * client respawn loop (`useSessionRestore.ts`) server-side so padi is the ONE
 * writer.
 *
 * Lives in its OWN module — not `session.ts` — deliberately: restore reaches
 * DOWN into the lifecycle façade (`createTerminal`/`snapshotSession`), while
 * `terminals.ts` already reaches UP into `session.ts` (`saveSession`). Putting
 * restore in `session.ts` would close that into an import CYCLE
 * (`session ↔ terminals`); a separate module that imports BOTH (and is imported
 * by neither) keeps the graph acyclic.
 */

import { resumeFormFor } from "anyagent/cli";
import type { SavedSession, SavedTerminal } from "kolu-common/surface";
import { backfillSavedSession, SavedSessionSchema } from "kolu-common/surface";
import { getSavedSession, saveSession, setSavedSession } from "./session.ts";
import { getActiveTerminal } from "./terminal-registry.ts";
import { seedSleepingTerminal } from "./terminalEndpoint/local.ts";
import {
  createTerminal,
  restoreActiveTerminalId,
  snapshotSession,
} from "./terminals.ts";

/** Restore the persisted session HOST-SIDE — the thin real impl W1.R0 lands.
 *  Reads the saved session, re-creates each terminal (active → spawn + optional
 *  agent-resume; sleeping → seed dormant), re-parents sub-terminals onto their
 *  freshly-spawned parents, then re-persists the live snapshot. Mirrors the
 *  client loop's essential structure MINUS the client-only canvas/active-tile
 *  protocol (a server has no viewport to center). Full parked-state + boot
 *  reconcile lands in R6.
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
  // Old id → new id: an active terminal gets a NEW id on respawn, so a sub-
  // terminal must re-parent onto the fresh id; a sleeping one keeps its stable
  // id (Wake respawns later).
  const oldToNew = new Map<string, string>();
  const topLevel = saved.terminals.filter((t) => !t.parentId);
  const subTerminals = saved.terminals.filter(
    (t): t is SavedTerminal & { parentId: string } => t.parentId !== undefined,
  );
  for (const t of topLevel) {
    if (t.state === "sleeping") {
      seedSleepingTerminal(t);
      oldToNew.set(t.id, t.id);
      continue;
    }
    const info = createTerminal(t.cwd, undefined, {
      themeName: t.themeName,
      canvasLayout: t.canvasLayout,
      subPanel: t.subPanel,
      rightPanel: t.rightPanel,
      intent: t.intent,
      // Preserve the saved recency across the restart — WITHOUT this, the fold
      // reseeds every restored terminal to `lastActivityAt: 0` (spawnPty's
      // `seedMemory` default) and the snapshot sensor deliberately does NOT bump
      // on a resuming wake, so the dock's recency ranking would permanently
      // collapse after a `session.restore`. This host-side restore is the twin
      // of the client loop it replaces, which forwarded `lastActivityAt` too.
      // (Distinct from the client-facing `lifecycle.create`, which drops it so a
      // FRESH terminal is stamped with padi's own clock.)
      lastActivityAt: t.lastActivityAt,
    });
    oldToNew.set(t.id, info.id);
    // Auto-launch the resume form of the previously captured agent command, if
    // the user didn't opt out. `resumeFormFor` switches on the fold-derived
    // `restoreTarget` (SAME composition the server's wake path feeds a fresh
    // spawn, so restore and wake can't drift): `exact` re-targets the exact
    // conversation, `legacyMostRecent` the most-recent fallback, `none`/absent a
    // bare shell.
    const optedIn = resumeAll || resumeSet.has(t.id);
    const resumeForm = optedIn ? resumeFormFor(t.restoreTarget) : null;
    if (resumeForm) getActiveTerminal(info.id)?.handle.write(`${resumeForm}\r`);
  }
  for (const t of subTerminals) {
    const parentId = oldToNew.get(t.parentId);
    if (parentId) createTerminal(t.cwd, parentId, {});
  }
  restoreActiveTerminalId(saved.activeTerminalId ?? null);
  saveSession(snapshotSession());
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
