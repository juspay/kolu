/**
 * One PartySocket connection feeding `surfaceClient` + module-level
 * `.use(...)` calls for the app's singleton reactive subscriptions.
 *
 * `app` exposes:
 *   - `app.cells / .collections / .streams / .events` — bound `.use(policy)`
 *     hooks (drop `source` / `mutate` / `valueSource` / `keyToInput`)
 *   - `app.rpc` — typed oRPC client; `app.rpc.surface.<key>.<verb>(...)` for
 *     surface-managed procedures, `app.rpc.{terminal,git,server}.<verb>(...)`
 *     for raw oRPC.
 *
 * The `preferences` / `recentRepos` / `savedSession` accessors below
 * collapse what used to be hand-rolled `usePreferences` / `useActivityFeed`
 * / `useSavedSession` modules into module-level subscriptions — every
 * consumer reads the same singleton without per-component lookups.
 */

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { surfaceClient } from "@kolu/cells/solid";
import type {
  Preferences,
  PreferencesPatch,
  RecentAgent,
  RecentRepo,
  SavedSession,
} from "kolu-common";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import { contract } from "kolu-common/contract";
import { surface } from "kolu-common/surface";
import { WebSocket as PartySocket } from "partysocket";
import { reconcile } from "solid-js/store";
import { toast } from "solid-sonner";

const { protocol, host } = window.location;
const wsUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

export const ws = new PartySocket(wsUrl);

// Expose for e2e tests: the reconnect regression test (#410) needs to
// drop and restore the socket directly. Same pattern as __xterm on the
// terminal container. Harmless in production — just an attribute on window.
(window as Window & { __koluWs?: PartySocket }).__koluWs = ws;

export const app = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof contract, ClientRetryPluginContext>
>(surface, { websocket: ws as unknown as WebSocket });

/** Convenience alias — `client.terminal.create(...)`, `client.git.worktreeCreate(...)`,
 *  `client.surface.preferences.patch(...)`, etc. */
export const client = app.rpc;

// ── Module-level singleton subscriptions ───────────────────────────────

const _preferences = app.cells.preferences.use({
  authority: "local",
  initial: DEFAULT_PREFERENCES,
  // The 3-arg path form `setStore("rightPanel", "tab", reconcile(tab))` is
  // load-bearing: the 2-arg merge form leaves stale fields from the old
  // variant when `tab` switches between `kind: "inspector"` and
  // `kind: "code"`, and the inspector branch's nested fields (mode) don't
  // trigger fine-grained reactivity on readers like `tab.mode`. `reconcile`
  // both replaces wholesale and fires proper reactivity.
  mergeIntoStore: (setStore, patch: PreferencesPatch) => {
    const { rightPanel: rpPatch, ...rest } = patch;
    if (Object.keys(rest).length > 0) {
      // biome-ignore lint/suspicious/noExplicitAny: setStore's overloaded merge form
      (setStore as any)(rest);
    }
    if (rpPatch) {
      const { tab, ...rpRest } = rpPatch;
      if (Object.keys(rpRest).length > 0) {
        // biome-ignore lint/suspicious/noExplicitAny: setStore's overloaded merge form
        (setStore as any)("rightPanel", rpRest);
      }
      if (tab !== undefined) {
        // biome-ignore lint/suspicious/noExplicitAny: setStore's overloaded merge form
        (setStore as any)("rightPanel", "tab", reconcile(tab));
      }
    }
  },
  onError: (err) =>
    toast.error(`Preferences subscription error: ${err.message}`),
});

/** Local-store accessor for user preferences — authoritative after the
 *  first server yield. */
export const preferences = (): Preferences =>
  _preferences.value() ?? DEFAULT_PREFERENCES;

/** Streaming subscription handle. Use this when callers need
 *  `.pending()` / `.error()` (e.g. boot gating) rather than the value. */
export const preferencesSub = _preferences.sub;

/** Patch user preferences; reports failures via `toast`. */
export function updatePreferences(patch: PreferencesPatch): void {
  void _preferences
    .patch(patch)
    .catch((err: Error) =>
      toast.error(`Failed to save preferences: ${err.message}`),
    );
}

const _activityFeed = app.cells.activityFeed.use({
  onError: (err) =>
    toast.error(`Activity feed subscription error: ${err.message}`),
});
export const recentRepos = (): RecentRepo[] =>
  _activityFeed.value()?.recentRepos ?? [];
export const recentAgents = (): RecentAgent[] =>
  _activityFeed.value()?.recentAgents ?? [];

const _savedSession = app.cells.session.use({
  onError: (err) =>
    toast.error(`Saved-session subscription error: ${err.message}`),
});
/** The persisted saved-session, or null when none exists / no yield yet. */
export const savedSession = (): SavedSession | null =>
  _savedSession.value() ?? null;
export const savedSessionSub = _savedSession.sub;

// Live terminal list — server-driven on create/kill.
const _terminalList = app.cells.terminalList.use({
  onError: (err) => toast.error(`Terminal list error: ${err.message}`),
});
/** Subscription handle for the live terminal list. */
export const terminalListSub = _terminalList.sub;
