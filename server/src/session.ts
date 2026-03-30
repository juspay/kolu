/**
 * Session persistence — save/restore terminal sessions across restarts.
 *
 * Reads and writes to the shared conf store (see state.ts).
 */

import type { SavedSession, SavedTerminal } from "kolu-common";
import { store } from "./state.ts";

/** Save a session snapshot. Only saves when terminals exist (avoids overwriting with empty). */
export function saveSession(terminals: SavedTerminal[]): void {
  if (terminals.length === 0) return;
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

// --- Auto-save: terminal lifecycle → session persistence (decoupled via event) ---

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Wire up debounced session save from terminal change events. Called once at startup. */
export function initSessionAutoSave(
  onChange: { on: (event: "changed", fn: () => void) => void },
  snapshot: () => SavedTerminal[],
): void {
  onChange.on("changed", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSession(snapshot()), 500);
  });
}
