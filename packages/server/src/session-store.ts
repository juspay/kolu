/** Saved-session store helpers shared by the session domain and surface cell. */

import { type CellStore, confStore } from "@kolu/surface/server";
import type { SavedSession } from "kolu-common/surface";
import { store } from "./state.ts";

/** Pending autosave timer — explicit session writes cancel it before persist. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function cancelPendingSessionAutoSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

/** Get the saved session, or null if none exists. */
export function getSavedSession(): SavedSession | null {
  const session = store.get("session");
  if (!session || session.terminals.length === 0) return null;
  return session;
}

/** Schedule one autosave in the current quiet period. */
export function scheduleSessionAutoSave(save: () => void): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    save();
  }, 500);
}

/** Saved-session cell store. Every `.set(...)` cancels any pending autosave
 *  before persisting, so callers cannot forget the cancel-then-write pattern
 *  — the invariant is structural, not procedural. Reads normalize "empty
 *  terminals = null" so that legacy quirk lives at one site. */
const rawSavedSessionStore: CellStore<SavedSession | null> =
  confStore<SavedSession | null>(store, "session");

export const savedSessionStore: CellStore<SavedSession | null> = {
  get: () => getSavedSession(),
  set: (value) => {
    cancelPendingSessionAutoSave();
    rawSavedSessionStore.set(value);
  },
};
