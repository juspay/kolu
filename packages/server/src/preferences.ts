/**
 * User preferences — pure patch logic.
 *
 * Persistence and publish/subscribe live in the framework: see
 * `cellHandlers(preferencesCell, ...)` in `router.ts`. This module owns
 * only the domain-specific patch shape — the deep merge of `rightPanel`
 * and the validation in `applyPreferencesPatch`. The client's
 * `usePreferences` hook seeds a local store from the first server yield,
 * then ignores subsequent echoes (so an unrelated activity tick can't
 * stomp a just-made client write); see `usePreferences`'s module comment.
 */

import type { Preferences, PreferencesPatch } from "kolu-common";

/** Pure merge of a `PreferencesPatch` into the current preferences.
 *  `rightPanel` is deep-merged so callers can patch a single nested field
 *  without supplying the rest of the object. */
export function applyPreferencesPatch(
  current: Preferences,
  patch: PreferencesPatch,
): Preferences {
  const { rightPanel: rpPatch, ...rest } = patch;
  return {
    ...current,
    ...rest,
    ...(rpPatch !== undefined && {
      rightPanel: { ...current.rightPanel, ...rpPatch },
    }),
  };
}
