/** Report the user's new-terminal theme preference to every host's padi.
 *
 *  padi resolves a new terminal's theme at its `lifecycle.create` front door, so
 *  that a terminal created by the MCP server, a TUI or a script honours the
 *  **New terminal theme** setting exactly like a keyboard create (#2045). padi
 *  cannot READ the preference — kolu-server owns it, and a REMOTE padi has no
 *  channel to kolu-server's conf at all — so the app chrome reports it, the same
 *  way it reports the active terminal (`chrome.setActive`).
 *
 *  The report carries the RESOLVED `isDark`, never the raw `colorScheme`: a
 *  `"system"` scheme is only answerable against the browser's media query, and
 *  padi runs headless. Resolving it here and resolving the THEME in padi is the
 *  split that keeps each guarantee at the endpoint that can actually make it.
 *
 *  One reporter per member host, so a background host's out-of-band creates
 *  honour the setting too — not just the host you happen to be looking at. Each
 *  re-reports whenever the preference changes, the resolved dark mode flips, or
 *  that host's link comes (back) up: a padi that respawned or was redialled
 *  starts with no reported policy, and this is what re-seeds it. */

import { encodeHostKey } from "kolu-common/hostKey";
import { createEffect, mapArray } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { useHostMembers } from "../host/useHostMembers";
import { useColorScheme } from "../settings/useColorScheme";
import { padiMap, preferences } from "../wire";

export const useNewTerminalThemePolicyReport = createSharedRoot(() => {
  const { isDark } = useColorScheme();
  const hosts = useHostMembers();

  // `mapArray` gives each host its own reactive owner, disposed when the host
  // leaves the pool — so a departed host's reporter goes with it.
  createEffect(
    mapArray(hosts, (host) => {
      const entry = padiMap.entry(host);
      createEffect(() => {
        // Re-runs on a reconnect too: `state()` re-enters `connected`, so a padi
        // that respawned or was redialled is re-seeded before the user (or an
        // MCP caller) can create anything on it.
        if (entry.state().kind !== "connected") return;
        void entry.procedures.chrome
          .setNewTerminalThemePolicy({
            newTerminalTheme: preferences().newTerminalTheme,
            shuffleBehavior: preferences().shuffleBehavior,
            isDark: isDark(),
          })
          .catch((err: Error) => {
            // Bookkeeping, not a user action — no toast. But it must not vanish
            // silently: a persistent failure means new terminals on this host
            // quietly stop following the setting.
            console.error(
              `useNewTerminalThemePolicyReport: failed to report to ${encodeHostKey(host)}: ${err.message}`,
            );
          });
      });
    }),
  );
});
