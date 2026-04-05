/**
 * Unified server state — live subscription for server sync, local store for instant UI reactivity.
 *
 * Architecture:
 * - createSubscription: server pushes state changes over WebSocket
 * - Singleton SolidJS store: synchronous UI updates for preferences
 * - reconcile effect: syncs subscription → local store on every server push
 * - updatePreferences: instant local store update + async server mutation
 *
 * Why both? The subscription update path is async (WebSocket round-trip ~1-5ms).
 * Preference toggles need <16ms feedback. The local store handles synchronous
 * reactivity; the subscription handles server sync.
 */

import { createEffect, on } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createSubscription } from "solid-live/solid";
import { client } from "./rpc";
import type {
  ServerState,
  Preferences,
  RecentRepo,
  SavedSession,
} from "kolu-common";

const DEFAULT_PREFERENCES: Preferences = {
  seenTips: [],
  startupTips: true,
  randomTheme: true,
  scrollLock: true,
  activityAlerts: true,
  colorScheme: "dark",
};

// Singleton store — all callers share one reactive source of truth for preferences.
const [prefs, setPrefs] = createStore<Preferences>(DEFAULT_PREFERENCES);

// Module-scope singleton — lives for app lifetime, no cleanup needed.
// onCleanup inside createSubscription is a no-op here (no reactive owner).
const stateSub = createSubscription(() => client.state.get());
let storeInitialized = false;

export function useServerState() {
  // Sync singleton store from subscription — only the first caller wires this up.
  if (!storeInitialized) {
    storeInitialized = true;
    createEffect(
      on(
        () => stateSub()?.preferences,
        (serverPrefs) => {
          if (serverPrefs) setPrefs(reconcile(serverPrefs));
        },
      ),
    );
  }

  /** Update one or more preferences. Instant local update + async server persist. */
  function updatePreferences(patch: Partial<Preferences>) {
    // Synchronous local update — UI reacts immediately (singleton store)
    setPrefs(patch);
    // Server persist — live stream will push authoritative state back via reconcile
    void client.state.update({ preferences: patch });
  }

  return {
    /** Full server state (undefined while loading). */
    state: stateSub as () => ServerState | undefined,
    /** Subscription pending state. */
    pending: stateSub.pending,
    /** Preferences — singleton store, synced from subscription on every server push. */
    preferences: () => prefs,
    recentRepos: () => (stateSub()?.recentRepos ?? []) as RecentRepo[],
    savedSession: () => (stateSub()?.session ?? null) as SavedSession | null,
    updatePreferences,
  };
}
