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

import type { SavedSession, SavedTerminal } from "kolu-common";
import { log } from "./log.ts";
import { publisher, publishSystem } from "./publisher.ts";
import { store } from "./state.ts";

/** Write the session blob (or clear it) and publish to subscribers. */
function writeSession(next: SavedSession | null): void {
  store.set("session", next);
  publishSystem("session:changed", next);
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

/** Get the saved session, or null if none exists. */
export function getSavedSession(): SavedSession | null {
  const session = store.get("session");
  if (!session || session.terminals.length === 0) return null;
  return session;
}

/** Clear the saved session (e.g. after successful restore). */
export function clearSavedSession(): void {
  writeSession(null);
}

/** Set the saved session directly (used by test harness and session tests). */
export function setSavedSession(session: SavedSession | null): void {
  writeSession(session);
}

// --- Auto-save: terminal lifecycle → session persistence (decoupled via publisher) ---

let saveTimer: ReturnType<typeof setTimeout> | undefined;

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
      for await (const _ of publisher.subscribe("terminals:dirty")) {
        if (saveTimer) continue;
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          saveSession(snapshot());
        }, 500);
      }
    } catch (err) {
      log.error({ err }, "session auto-save subscription failed");
    }
  })();
}
