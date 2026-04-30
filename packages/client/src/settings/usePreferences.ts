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
 *
 * Implemented via `useCell` from `@kolu/cells/solid` with `authority: "local"`.
 * The framework primitive captures the entire pattern (initial-seed-only +
 * ignore-echoes + optimistic local apply); the discriminated-union
 * `rightPanel.tab` reconcile is expressed via `mergeIntoStore`, the framework's
 * escape hatch for nested mutations that `applyPatch` + reconcile can't
 * handle cleanly (a 3-arg path-form `setStore` is required to deep-replace
 * the tab variant without leaving stale fields from the old variant).
 */

import { useCell } from "@kolu/cells/solid";
import type { Preferences, PreferencesPatch } from "kolu-common";
import { preferencesCell } from "kolu-common/cells";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import { reconcile } from "solid-js/store";
import { toast } from "solid-sonner";
import { client, stream } from "../rpc/rpc";

const cell = useCell(preferencesCell, {
  authority: "local",
  initial: DEFAULT_PREFERENCES,
  source: () => stream.preferences(),
  mutate: async (patch: PreferencesPatch) => {
    try {
      await client.preferences.update(patch);
    } catch (err) {
      if (err instanceof Error) {
        toast.error(`Failed to save preferences: ${err.message}`);
      } else {
        toast.error("Failed to save preferences");
      }
    }
  },
  // The 3-arg path form `setStore("rightPanel", "tab", reconcile(tab))` is
  // load-bearing: the 2-arg merge form leaves stale fields from the old
  // variant when `tab` switches between `kind: "inspector"` and
  // `kind: "code"`, and the inspector branch's nested fields (mode) don't
  // trigger fine-grained reactivity on readers like `tab.mode`. `reconcile`
  // both replaces wholesale and fires proper reactivity.
  mergeIntoStore: (setStore, patch: PreferencesPatch) => {
    const { rightPanel: rpPatch, ...rest } = patch;
    if (Object.keys(rest).length > 0) setStore(rest);
    if (rpPatch) {
      const { tab, ...rpRest } = rpPatch;
      if (Object.keys(rpRest).length > 0) {
        setStore("rightPanel", rpRest as Partial<Preferences["rightPanel"]>);
      }
      if (tab !== undefined) setStore("rightPanel", "tab", reconcile(tab));
    }
  },
  onError: (err) =>
    toast.error(`Preferences subscription error: ${err.message}`),
});

function updatePreferences(patch: PreferencesPatch): void {
  void cell.patch(patch);
}

export function usePreferences() {
  return {
    sub: cell.sub,
    /** Local-store accessor — authoritative after the first server yield. */
    preferences: (): Preferences => cell.value() ?? DEFAULT_PREFERENCES,
    updatePreferences,
  } as const;
}
