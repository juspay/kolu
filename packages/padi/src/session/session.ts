import type { SavedSession, SavedTerminal } from "@kolu/padi-client/surface";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { hasParkedTerminals, parkedTerminalIds } from "../terminal-registry.ts";
import { cancelPendingAutosave } from "./autosaveGate.ts";

function writeSession(next: SavedSession | null): void {
  if (next === null) {
    log.warn(
      { stack: new Error("session clear").stack },
      "session-trace writeSession: clearing session (next=null)",
    );
  } else {
    log.info(
      { terminals: next.terminals.length },
      `session-trace writeSession: ${next.terminals.length} terminals`,
    );
  }
  padiSurfaceCtx.cells.session.set(next);
}

/** A live snapshot of the terminal set — the shape autosave persists. One nominal
 *  contract for the producer (`snapshotSession`) and the consumers (
 *  {@link saveSession}, the autosave gate). */
export interface SessionSnapshot {
  terminals: SavedTerminal[];
  activeTerminalId: string | null;
}

/** Save a session snapshot. Clears the saved session when no terminals remain;
 *  otherwise stamps `savedAt` at the moment of the write. */
export function saveSession(snapshot: SessionSnapshot): void {
  if (snapshot.terminals.length === 0) {
    log.warn(
      { terminals: 0 },
      "session-trace saveSession: empty snapshot → clearing (empty→null)",
    );
    writeSession(null);
    return;
  }
  log.info(
    { terminals: snapshot.terminals.length },
    `session-trace saveSession: writing ${snapshot.terminals.length} terminals`,
  );
  writeSession({
    terminals: snapshot.terminals,
    activeTerminalId: snapshot.activeTerminalId,
    savedAt: Date.now(),
  });
}

export function saveActiveTerminalId(id: string): void {
  const saved = getSavedSession();
  if (saved === null || saved.activeTerminalId === id) return;
  log.info(
    { activeTerminalId: id },
    `session-trace saveActiveTerminalId: active=${id}`,
  );
  writeSession({ ...saved, activeTerminalId: id });
}

/** The saved session, or null when none exists — a blob with no terminals reads
 *  as null. */
export function getSavedSession(): SavedSession | null {
  const session = padiSurfaceCtx.cells.session.get();
  if (!session || session.terminals.length === 0) return null;
  return session;
}

/** Clear the saved session (e.g. after a successful restore). */
export function clearSavedSession(): void {
  writeSession(null);
}

/** Set the saved session directly. Cancels any pending autosave first, so a
 *  `terminals:dirty` armed before this call cannot fire after it and clobber what
 *  was just set. */
export function setSavedSession(session: SavedSession | null): void {
  cancelPendingAutosave();
  writeSession(session);
}

function mergeRestorePendingSnapshot(
  snapshot: SessionSnapshot,
): SessionSnapshot {
  const saved = getSavedSession();
  const savedTerminals = saved?.terminals ?? [];
  const liveIds = new Set(snapshot.terminals.map((t) => t.id));
  const merged: SessionSnapshot = {
    terminals: [
      ...savedTerminals.filter((t) => !liveIds.has(t.id)),
      ...snapshot.terminals,
    ],
    activeTerminalId:
      snapshot.activeTerminalId ?? saved?.activeTerminalId ?? null,
  };
  log.info(
    {
      onDisk: savedTerminals.length,
      live: snapshot.terminals.length,
      merged: merged.terminals.length,
    },
    `session-trace capture: restore pending → merged union (${merged.terminals.length} records, no shrink)`,
  );
  return merged;
}

/** Capture a live snapshot as the saved session — the restart-capture path. An
 *  EMPTY capture preserves what is already on disk; with a restore pending the
 *  capture is MERGED with the saved records, never shrinking them. */
export function setSavedSessionFromSnapshot(snapshot: SessionSnapshot): void {
  cancelPendingAutosave();
  if (snapshot.terminals.length === 0) {
    log.info(
      { snapshot: 0 },
      "session-trace capture: snapshot=0 → empty-preserve early-return (existing session left intact)",
    );
    return;
  }
  if (hasParkedTerminals()) {
    saveSession(mergeRestorePendingSnapshot(snapshot));
    return;
  }
  log.info(
    { snapshot: snapshot.terminals.length },
    `session-trace capture: snapshot=${snapshot.terminals.length} → persisting`,
  );
  saveSession(snapshot);
}

export function orphanedParkedIds(): string[] {
  const named = new Set((getSavedSession()?.terminals ?? []).map((t) => t.id));
  return parkedTerminalIds().filter((id) => !named.has(id));
}
