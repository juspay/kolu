/** Report the user's new-terminal preferences to EVERY member host's padi.
 *
 *  See `packages/padi/README.md` § preferences for the whole rationale — why
 *  padi is TOLD the policy rather than reading it, why the report carries the
 *  browser's RESOLVED `isDark`, and why an unloaded preference is reported as
 *  ABSENCE (silence) rather than a floored default.
 *
 *  Lives beside `createViewState`'s `chrome.setActive` report — its twin — and is
 *  mounted from the app shell, not from a feature module: every member host must
 *  stay seeded whether or not anything has touched terminal CRUD, including the
 *  background host you are not looking at. Each host re-reports whenever the
 *  policy changes or that host's link comes (back) up, since a padi that
 *  respawned or was redialled starts with no reported policy. */

import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { NewTerminalPolicy } from "kolu-common/surface";
import { createEffect, createMemo, mapArray } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { useColorScheme } from "../settings/useColorScheme";
import { hostKeys, padiMap, preferencesLoaded } from "../wire";

export const useNewTerminalPolicyReport = createSharedRoot(() => {
  const { isDark } = useColorScheme();
  // Derived ONCE, with structural equality: the fact being reported is three
  // fields, but `preferences` is a fresh object on every server push — tracking
  // it whole would fire one RPC per member host every time the user drags a
  // panel or flips a tip.
  const policy = createMemo<NewTerminalPolicy | undefined>(
    () => {
      const prefs = preferencesLoaded();
      if (!prefs) return undefined;
      return {
        newTerminalTheme: prefs.newTerminalTheme,
        shuffleBehavior: prefs.shuffleBehavior,
        isDark: isDark(),
      };
    },
    undefined,
    {
      equals: (a, b) =>
        a?.newTerminalTheme === b?.newTerminalTheme &&
        a?.shuffleBehavior === b?.shuffleBehavior &&
        a?.isDark === b?.isDark,
    },
  );
  // One eager root per host, keyed on the ENCODED host string (keys cannot be
  // compared by `===`) — the same shape as `useAttentionFacts` /
  // `useFleetTerminalIndex`. `hostKeys` is `wire.ts`'s membership AUTHORITY, and
  // `mapArray` disposes a departed host's reporter with its owner.
  createEffect(
    mapArray(
      () => hostKeys().map(encodeHostKey),
      (encHost) => {
        const host = decodeHostKey(encHost);
        const entry = padiMap.entry(host);
        // Just the link transition — depending on the whole `EntryStatus` would
        // re-fire the report on every post-connect `clockOffset` measurement.
        const connected = createMemo(() => entry.state().kind === "connected");
        createEffect(() => {
          const p = policy();
          if (p === undefined) return;
          if (!connected()) return;
          void entry.procedures.chrome
            .setNewTerminalPolicy(p)
            .catch((err: Error) => {
              // Bookkeeping, not a user action — no toast. But it must not
              // vanish silently: a persistent failure means new terminals on
              // this host quietly stop following the setting.
              console.error(
                `useNewTerminalPolicyReport: failed to report to ${encHost}: ${err.message}`,
              );
            });
        });
      },
    ),
  );
});
