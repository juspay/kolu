/**
 * User preferences — singleton local store, seeded from the server's first
 * yield, then authoritative client-side.
 *
 * Why a local store? Instant UI response requires synchronous updates —
 * waiting for the server echo introduces a visible delay when a pref flip
 * gates a re-render. On the CI side this timing shows up as a race against
 * UI mount/teardown windows; on the user side it's the same class of
 * single-frame lag.
 *
 * What kept biting before #561 (and motivated #577): the original code
 * reconciled the server's preferences blob into the local store on *every*
 * push, so any unrelated server-side state change (e.g. a `trackRecentAgent`)
 * piggybacking on the same channel would stomp a locally-applied change
 * whose RPC hadn't round-tripped yet. The fix is "reconcile only once, at
 * init" — the subscription seeds the local store on its first yield, then
 * never touches preferences again. The local store is authoritative for
 * preferences thereafter; `updatePreferences` writes locally and tells the
 * server, but subsequent server echoes are intentionally ignored. After
 * #577 preferences ride their own dedicated channel, so unrelated events
 * (activity feed, session) can no longer trigger a stomp at all.
 */

import { createEffect, createRoot, on } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { toast } from "solid-sonner";
import { createSubscription } from "../rpc/createSubscription";
import { client, stream } from "../rpc/rpc";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import type { Preferences, PreferencesPatch } from "kolu-common";

const [prefs, setPrefs] = createStore<Preferences>(DEFAULT_PREFERENCES);
let initialized = false;

// createRoot detaches the subscription + init effect from any transient
// caller's reactive owner so they live for the app's lifetime.
const sub = createRoot(() => {
  const s = createSubscription(() => stream.preferences(), {
    onError: (err) =>
      toast.error(`Preferences subscription error: ${err.message}`),
  });
  createEffect(
    on(
      () => s(),
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

/** Update one or more preferences. Applied to the local store synchronously
 *  (for instant UI response), then persisted to the server. The server's
 *  echo is ignored — see the module comment for why. */
function updatePreferences(patch: PreferencesPatch) {
  const { rightPanel: rpPatch, ...rest } = patch;
  if (Object.keys(rest).length > 0) setPrefs(rest);
  if (rpPatch) {
    const { tab, ...rpRest } = rpPatch;
    // Scalar fields of rightPanel (collapsed, size, pinned) go through the
    // normal merge — any path form works for primitives.
    if (Object.keys(rpRest).length > 0) {
      setPrefs("rightPanel", rpRest as Partial<Preferences["rightPanel"]>);
    }
    // `tab` is a discriminated-union object. The 3-arg path form deep-merges
    // an object value (leaving stale fields from the old variant), and the
    // 2-arg merge form doesn't trigger fine-grained reactivity on nested
    // readers like `tab.mode` — verified empirically. `reconcile` both
    // REPLACES wholesale and fires proper reactivity.
    if (tab !== undefined) setPrefs("rightPanel", "tab", reconcile(tab));
  }
  void client.preferences
    .update(patch)
    .catch((err: Error) =>
      toast.error(`Failed to save preferences: ${err.message}`),
    );
}

export function usePreferences() {
  return {
    sub,
    /** Local-store accessor — authoritative after the first server yield. */
    preferences: (): Preferences => prefs,
    updatePreferences,
  } as const;
}
