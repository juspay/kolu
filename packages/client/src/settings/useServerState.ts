/**
 * Unified server state — singleton subscription for server-emitted data,
 * singleton local store for instant preference updates.
 *
 * Why both? Instant UI response requires synchronous local updates —
 * waiting for the server echo introduces a visible delay when a pref
 * flip gates a re-render (e.g., `canvasMode` → canvas mount → wheel
 * listener attach). On the CI side this timing shows up as a race against
 * the canvas ownership window; on the user side it's the same class of
 * single-frame lag.
 *
 * What kept biting before (issue #561): the original code reconciled the
 * server's preferences blob into the local store on *every* push, so any
 * unrelated `state:changed` event (a `trackRecentAgent`, another pref
 * write) would stomp a locally-applied change whose RPC hadn't round-tripped
 * yet. The fix here is "reconcile only once, at init" — the subscription
 * seeds the local store on its first yield, then never touches preferences
 * again. The local store is authoritative for preferences thereafter;
 * `updatePreferences` writes locally and tells the server, but subsequent
 * server echoes for those fields are intentionally ignored.
 *
 * `recentRepos` / `recentAgents` / `session` still come from the
 * subscription live — they're server-emitted and the client never writes
 * them, so there's no divergence to worry about.
 */

import { createEffect, createRoot, on } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { toast } from "solid-sonner";
import { createSubscription } from "../rpc/createSubscription";
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

const [prefs, setPrefs] = createStore<Preferences>(DEFAULT_PREFERENCES);
let initialized = false;

// createRoot detaches the subscription + init effect from any transient
// caller's reactive owner so they live for the app's lifetime.
const sub = createRoot(() => {
  const s = createSubscription(() => stream.state(), {
    onError: (err) => toast.error(`Server state error: ${err.message}`),
  });
  createEffect(
    on(
      () => s()?.preferences,
      (serverPrefs) => {
        if (serverPrefs && !initialized) {
          initialized = true;
          setPrefs(reconcile(serverPrefs));
        }
      },
    ),
  );
  return s;
});

export function useServerState() {
  /** Update one or more preferences. Applied to the local store
   *  synchronously (for instant UI response), then persisted to the
   *  server. The server's echo for these fields is ignored — see the
   *  module comment for why. */
  function updatePreferences(patch: PreferencesPatch) {
    const { rightPanel: rpPatch, ...rest } = patch;
    if (Object.keys(rest).length > 0) setPrefs(rest);
    if (rpPatch) {
      // tab is a discriminated union — use the 3-arg path form to REPLACE
      // the value wholesale. Shallow-merging `{ tab: newTab }` into the
      // rightPanel object would carry stale fields (e.g. a lingering `mode`
      // from {kind:"code"} when switching to {kind:"inspector"}).
      const { tab, ...rpRest } = rpPatch;
      if (Object.keys(rpRest).length > 0) {
        setPrefs("rightPanel", rpRest as Partial<Preferences["rightPanel"]>);
      }
      if (tab !== undefined) setPrefs("rightPanel", "tab", tab);
    }
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
    /** Preferences — local store, authoritative after the first server
     *  yield seeds it. */
    preferences: (): Preferences => prefs,
    recentRepos: () => (sub()?.recentRepos ?? []) as RecentRepo[],
    recentAgents: () => (sub()?.recentAgents ?? []) as RecentAgent[],
    savedSession: () => (sub()?.session ?? null) as SavedSession | null,
    updatePreferences,
  };
}
