/**
 * Unified server state — live subscription for server sync, local store for instant UI reactivity.
 *
 * Architecture:
 * - createSubscription: server pushes state changes over WebSocket
 * - Singleton SolidJS store: synchronous UI updates for preferences
 * - reconcile effect: syncs subscription → local store on every server push
 * - updatePreferences: instant local store update + async server mutation
 *
 * Why both? The server round-trip (even on localhost) takes a few ms.
 * For instant toggle feedback, the local store handles the synchronous update;
 * the subscription pushes authoritative state back via reconcile.
 */

import { createEffect, on } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { toast } from "solid-sonner";
import {
  createSubscription,
  onSubscriptionError,
} from "../rpc/createSubscription";
import { client, stream } from "../rpc/rpc";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import type {
  ServerState,
  Preferences,
  PreferencesPatch,
  RecentRepo,
  RecentAgent,
  SavedSession,
} from "kolu-common";

// Singleton store — all callers share one reactive source of truth for preferences.
const [prefs, setPrefs] = createStore<Preferences>(DEFAULT_PREFERENCES);
let storeInitialized = false;

export function useServerState() {
  const sub = createSubscription(() => stream.state());

  // Sync singleton store from subscription — only the first caller wires this up.
  if (!storeInitialized) {
    storeInitialized = true;
    createEffect(
      on(
        () => sub()?.preferences,
        (serverPrefs) => {
          if (serverPrefs) setPrefs(reconcile(serverPrefs));
        },
      ),
    );
    // Surface subscription errors (e.g. schema mismatch) so they don't vanish silently.
    onSubscriptionError(sub, (err) =>
      toast.error(`Server state error: ${err.message}`),
    );
  }

  /** Update one or more preferences. Instant local update + async server persist.
   *  Nested objects (rightPanel) are deep-merged both locally and on the server. */
  function updatePreferences(patch: PreferencesPatch) {
    // Synchronous local update — UI reacts immediately (singleton store).
    // SolidJS store setter supports path-based deep updates.
    const { rightPanel: rpPatch, ...rest } = patch;
    if (Object.keys(rest).length > 0) setPrefs(rest);
    if (rpPatch) setPrefs("rightPanel", rpPatch);
    // Server persist — live stream will push authoritative state back via reconcile
    void client.state
      .update({ preferences: patch })
      .catch((err: Error) =>
        toast.error(`Failed to save preferences: ${err.message}`),
      );
  }

  return {
    sub,
    /** Full server state (undefined while loading). */
    state: () => sub() as ServerState | undefined,
    /** Preferences — singleton store, synced from subscription on every server push. */
    preferences: () => prefs,
    recentRepos: () => (sub()?.recentRepos ?? []) as RecentRepo[],
    recentAgents: () => (sub()?.recentAgents ?? []) as RecentAgent[],
    savedSession: () => (sub()?.session ?? null) as SavedSession | null,
    updatePreferences,
  };
}
