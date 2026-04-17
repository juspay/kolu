/**
 * User preferences — server-persisted, client-authoritative.
 *
 * Owns the `preferences` key of the shared conf store. The client's
 * `usePreferences` hook seeds a local store from the first server yield,
 * then ignores subsequent echoes (so an unrelated activity tick can't stomp
 * a just-made client write). Writes here always publish; the client decides
 * whether to apply the echo — see `usePreferences`'s module comment.
 */

import {
  PreferencesSchema,
  type Preferences,
  type PreferencesPatch,
} from "kolu-common";
import { store } from "./state.ts";
import { publishSystem } from "./publisher.ts";
import { log } from "./log.ts";

/** Get the current preferences. */
export function getPreferences(): Preferences {
  return store.get("preferences");
}

/** Merge a partial update into preferences and publish. `rightPanel` is
 *  deep-merged so callers can patch a single nested field without supplying
 *  the rest of the object. */
export function updatePreferences(patch: PreferencesPatch): void {
  const current = store.get("preferences");
  const { rightPanel: rpPatch, ...rest } = patch;
  const next: Preferences = {
    ...current,
    ...rest,
    ...(rpPatch !== undefined && {
      rightPanel: { ...current.rightPanel, ...rpPatch },
    }),
  };
  store.set("preferences", next);
  publishSystem("preferences:changed", next);
}

/** Test-only: replace the preferences blob wholesale. Validates against the
 *  schema so e2e fixtures see the same errors as production callers would. */
export function setPreferencesForTest(prefs: Preferences): void {
  const result = PreferencesSchema.safeParse(prefs);
  if (!result.success) {
    log.error({ issues: result.error.issues }, "test preferences invalid");
    throw new Error("Invalid preferences in test__set");
  }
  store.set("preferences", result.data);
  publishSystem("preferences:changed", result.data);
}
