/**
 * Saved-session persistence — save/restore terminal sessions across restarts.
 *
 * Owns the `session` key of the shared conf store. Writers publish on the
 * `session:changed` channel so the client's `session.get` live query stays
 * current. The autosave loop is driven by the `terminals:dirty` control-flow
 * channel (distinct from the `session:changed` *content* channel) — every
 * terminal/meta mutation fires `terminals:dirty`, this module throttles and
 * then persists.
 */

import type { SavedSession, SavedTerminal } from "kolu-common/surface";
import { log } from "./log.ts";
import { terminalsDirtyChannel } from "./publisher.ts";
import { scheduleSessionAutoSave } from "./session-store.ts";
import { surfaceCtx } from "./surface.ts";

export { getSavedSession } from "./session-store.ts";

/** Write the session blob (or clear it). The surface owns persist+publish;
 *  the cell store cancels any pending autosave before persist. */
function writeSession(next: SavedSession | null): void {
  surfaceCtx.cells.session.set(next);
}

/** Save a session snapshot. Clears the session when no terminals remain. */
export function saveSession(snapshot: {
  terminals: SavedTerminal[];
  activeTerminalId: string | null;
}): void {
  if (snapshot.terminals.length === 0) {
    writeSession(null);
    return;
  }
  writeSession({
    terminals: snapshot.terminals,
    activeTerminalId: snapshot.activeTerminalId,
    savedAt: Date.now(),
  });
}

/** Clear the saved session (e.g. after successful restore). */
export function clearSavedSession(): void {
  writeSession(null);
}

/** Set the saved session directly (used by test harness and session tests).
 *  Bypasses the empty-terminals normalization in `saveSession`. */
export function setSavedSession(session: SavedSession | null): void {
  writeSession(session);
}

// --- Auto-save: terminal lifecycle → session persistence (decoupled via publisher) ---

/** Wire up throttled session save from terminal change events. Called once at startup.
 *
 *  Leading-edge throttle: the first dirty event in a quiet period schedules
 *  a save 500ms later; subsequent events during that window are absorbed
 *  into the same upcoming snapshot (because `snapshot()` runs inside the
 *  callback, not at schedule time). A trailing-edge debounce — the obvious
 *  alternative — starves under bursty inputs: the Claude transcript
 *  watcher fires every 150ms while an agent is streaming, which would
 *  reset the timer indefinitely and the save would never fire.
 *
 *  Assumes `saveSession` is synchronous (it is — `writeSession` does sync
 *  `store.set` + sync publish). If anyone makes it async, add an in-flight
 *  guard so a new schedule can't race an unfinished write. */
export function initSessionAutoSave(
  snapshot: () => {
    terminals: SavedTerminal[];
    activeTerminalId: string | null;
  },
): void {
  void (async () => {
    try {
      for await (const _ of terminalsDirtyChannel.subscribe(undefined)) {
        scheduleSessionAutoSave(() => saveSession(snapshot()));
      }
    } catch (err) {
      log.error({ err }, "session auto-save subscription failed");
    }
  })();
}
