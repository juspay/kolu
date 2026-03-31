/**
 * Session persistence — save/restore terminal sessions across restarts.
 *
 * Reads and writes to the shared conf store (see state.ts).
 */

import type { SavedSession, SavedTerminal } from "kolu-common";
import { store } from "./state.ts";
import { publisher } from "./publisher.ts";
import { log } from "./log.ts";

/** Save a session snapshot. Clears the session when no terminals remain. */
export function saveSession(terminals: SavedTerminal[]): void {
  if (terminals.length === 0) {
    store.set("session", null);
    return;
  }
  store.set("session", { terminals, savedAt: Date.now() });
}

/** Get the saved session, or null if none exists. */
export function getSavedSession(): SavedSession | null {
  const session = store.get("session");
  if (!session || session.terminals.length === 0) return null;
  return session;
}

/** Clear the saved session (e.g. after successful restore). */
export function clearSavedSession(): void {
  store.set("session", null);
}

/** Set the saved session directly (test-only). */
export function setSavedSession(session: SavedSession): void {
  store.set("session", session);
}

// --- Auto-save: terminal lifecycle → session persistence (decoupled via publisher) ---

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Wire up debounced session save from terminal change events. Called once at startup. */
export function initSessionAutoSave(snapshot: () => SavedTerminal[]): void {
  void (async () => {
    try {
      for await (const _ of publisher.subscribe("session:changed")) {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveSession(snapshot()), 500);
      }
    } catch (err) {
      log.error({ err }, "session auto-save subscription failed");
    }
  })();
}
