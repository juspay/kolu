/** Report the user's new-terminal preferences to EVERY member host's padi.
 *
 *  padi resolves a new terminal's look at its `lifecycle.create` front door, so
 *  that a terminal created by the MCP server, a TUI or a script honours the
 *  **New terminal theme** setting exactly like a keyboard create (#2045). padi
 *  cannot READ the preference — see `packages/padi/README.md` § preferences for
 *  why it is a report and not a read, and why it carries the browser's RESOLVED
 *  `isDark` rather than a raw `"system"` colour scheme.
 *
 *  Lives beside `createViewState`'s `chrome.setActive` report — its twin — and is
 *  mounted from the app shell, not from a feature module: every member host must
 *  stay seeded whether or not anything has touched terminal CRUD, including the
 *  background host you are not looking at. Each host re-reports whenever the
 *  policy changes or that host's link comes (back) up, since a padi that
 *  respawned or was redialled starts with no reported policy.
 *
 *  ABSENCE IS REPORTED AS ABSENCE: while the preferences cell has not yielded
 *  there is nothing to say, and the reporter stays silent so padi's own
 *  "no chrome has reported" branch answers. Reporting a floored default in that
 *  window would hand padi a confident preference the user never chose. */

import type { HostKey } from "kolu-common/hostKey";
import { encodeHostKey } from "kolu-common/hostKey";
import type { NewTerminalPolicy } from "kolu-common/surface";
import { createEffect, createMemo, mapArray } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { useColorScheme } from "../settings/useColorScheme";
import { hostKeys, padiMap, preferencesLoaded } from "../wire";

/** One host's end of the report — the seam the unit suite substitutes for a live
 *  padi link. */
export interface NewTerminalPolicyHostPort {
  /** Is this host's link up? A report to a down host is dropped, and re-sent
   *  when it comes back. */
  connected: () => boolean;
  send: (policy: NewTerminalPolicy) => Promise<void>;
}

export interface NewTerminalPolicyReportPorts {
  hosts: () => HostKey[];
  /** The policy to report, or `undefined` while the preference is not yet known
   *  — an ABSENT fact, never floored to defaults. */
  policy: () => NewTerminalPolicy | undefined;
  portFor: (host: HostKey) => NewTerminalPolicyHostPort;
  onError: (host: HostKey, err: Error) => void;
}

/** The reporter proper, over injected ports. Call inside a reactive owner. */
export function createNewTerminalPolicyReport(
  ports: NewTerminalPolicyReportPorts,
): void {
  // `mapArray` gives each host its own reactive owner, disposed when the host
  // leaves the pool — so a departed host's reporter goes with it.
  createEffect(
    mapArray(ports.hosts, (host) => {
      const port = ports.portFor(host);
      createEffect(() => {
        const policy = ports.policy();
        if (policy === undefined) return;
        if (!port.connected()) return;
        void port.send(policy).catch((err: Error) => ports.onError(host, err));
      });
    }),
  );
}

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
  createNewTerminalPolicyReport({
    // `hostKeys` is `wire.ts`'s membership AUTHORITY — the same `entries`
    // subscription the host reconcile and the switcher read, not a second one.
    hosts: hostKeys,
    policy,
    portFor: (host) => {
      const entry = padiMap.entry(host);
      return {
        connected: () => entry.state().kind === "connected",
        send: async (p) => {
          await entry.procedures.chrome.setNewTerminalPolicy(p);
        },
      };
    },
    onError: (host, err) => {
      // Bookkeeping, not a user action — no toast. But it must not vanish
      // silently: a persistent failure means new terminals on this host quietly
      // stop following the setting.
      console.error(
        `useNewTerminalPolicyReport: failed to report to ${encodeHostKey(host)}: ${err.message}`,
      );
    },
  });
});
