/**
 * One PartySocket connection feeding `surfaceClient` + module-level
 * `.use(...)` calls for the app's singleton reactive subscriptions.
 *
 * `app` is the SCOPED kolu surface client (`clients.kolu`) — only kolu's own
 * surface bundle, not the full link. It exposes:
 *   - `app.cells / .collections / .streams / .events` — bound `.use(policy)`
 *     hooks (drop `source` / `mutate` / `valueSource` / `keyToInput`)
 *   - `app.rpc` — the scoped link slice (`{ surface: link.surface.kolu }`);
 *     surface-managed procedures resolve through it.
 *
 * Raw oRPC procedures (`terminal`, `git`, `server`) live at the ROOT of the
 * full combined link, exported as `client` — `client.terminal.create(...)`,
 * `client.git.worktreeCreate(...)`, `client.server.info(...)`. They are NOT
 * on `app.rpc`.
 *
 * The `preferences` / `recentRepos` / `savedSession` accessors below
 * collapse what used to be hand-rolled `usePreferences` / `useActivityFeed`
 * / `useSavedSession` modules into module-level subscriptions — every
 * consumer reads the same singleton without per-component lookups.
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { surfaceClients } from "@kolu/surface/solid";
import { createSurfaceSocket } from "@kolu/surface-app/connect";
import type { contract } from "kolu-common/contract";
import {
  DEFAULT_PREFERENCES,
  type KnownHost,
  type Preferences,
  type PreferencesPatch,
  type RecentAgent,
  type RecentRepo,
  type SavedSession,
  surfaces,
} from "kolu-common/surface";
import type { WebSocket as PartySocket } from "partysocket";
import { toast } from "solid-sonner";

const { protocol, host } = window.location;
const wsBaseUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

// The server mints a fresh `processId` per boot. `createSurfaceSocket` owns the
// `pid` echo: it threads the last-observed id back as a query param on every
// (re)connect so a stale tab reconnecting to a RESTARTED server is recognized at
// the handshake — the server closes the socket with `STALE_PROCESS_CLOSE_CODE`
// rather than letting dead-terminal subscriptions replay and storm its logs. The
// library owns the URL thunk + the `new PartySocket(...)` (see
// `@kolu/surface-app/connect`); `rpc.ts` feeds each observed id into the echo via
// `rememberServerProcessId`. No `restartCloseCode` self-retire here — kolu's
// lifecycle (`rpc.ts`) owns this socket and retires it through `onStaleRestart`.
const { ws, echo } = createSurfaceSocket({ url: wsBaseUrl });

/** Stash the latest observed server `processId` for the next reconnect's `pid`
 *  echo — fed by `rpc.ts`'s lifecycle `onProcessId`. It's null until the first
 *  probe, so the very first connect omits the param. */
export const rememberServerProcessId = echo.remember;
export { ws };

// Expose for e2e tests: the reconnect regression test (#410) needs to
// drop and restore the socket directly. Same pattern as __xterm on the
// terminal container. Harmless in production — just an attribute on window.
(window as Window & { __koluWs?: PartySocket }).__koluWs = ws;

// The single combined oRPC link over the one transport. The contract is the
// combined one (`{ surface: { kolu, surfaceApp }, server, terminal, git }`) — the
// raw oRPC procedures (`terminal`, `git`, `server`) live at its root; the two
// sibling surfaces live under `surface.<key>`.
const link = websocketLink<typeof contract>(ws as unknown as WebSocket);

// kolu serves TWO sibling surfaces over one transport (kolu#1197). Build one
// client per sibling over the single combined link, each scoped to its key's
// slice (`{ surface: link.surface[key] }`) so its primitives resolve at the wire
// path `/surface/<key>/<prim>/<verb>` that `implementSurfaces` serves.
const clients = surfaceClients(link, surfaces);

/** kolu's OWN surface client — `app.cells.preferences.use(...)`,
 *  `app.collections.terminalMetadata.use(...)`, `app.streams.gitStatus.use(...)`,
 *  etc. Every existing `app.*` call site reaches kolu's own primitives. */
export const app = clients.kolu;

/** surface-app's surface client — the build-identity `buildInfo` cell (read via
 *  `surfaceApp.cells.buildInfo.use({ authority: "server" })`) and the
 *  `identity.info` restart probe (`surfaceApp.rpc.surface.identity.info({})` —
 *  the `surfaceApp` key is consumed by the scope, so it does NOT reappear in the
 *  path). Handed to `<SurfaceAppProvider controlPlane=...>` + `createServerLifecycle`. */
export const surfaceApp = clients.surfaceApp;

/** Convenience alias — the FULL combined link. `client.terminal.create(...)`,
 *  `client.git.worktreeCreate(...)`, `client.server.info(...)` reach the raw oRPC
 *  procedures at the link root; `client.surface.kolu.preferences.patch(...)` /
 *  `client.surface.surfaceApp.identity.info(...)` reach the sibling surfaces.
 *  (Note: the surface-bound `.use(...)` hooks come off `app`/`surfaceApp`, which
 *  wrap a SCOPED slice of this same link.) */
export const client = link;

// ── Module-level singleton subscriptions ───────────────────────────────

const _preferences = app.cells.preferences.use({
  authority: "local",
  initial: DEFAULT_PREFERENCES,
  // Debounce window for size writes that opt in via `{ coalesce: true }`. The
  // rightPanel splitter's `onSizesChange` fires a patch per frame during a drag
  // (and re-fires on Corvu panel re-registration), which storms the server.
  // Coalescing is per-write, so discrete toggles (colorScheme, scrollLock) keep
  // flushing immediately and survive a quick reload. See #1041.
  coalesceMs: 150,
  // Covers both subscription drops and coalesced-flush failures — a coalesced
  // write's `mutate` failure surfaces here, not on `patch`'s returned promise.
  onError: (err) => toast.error(`Preferences error: ${err.message}`),
});

/** Local-store accessor for user preferences — authoritative after the
 *  first server yield. */
export const preferences = (): Preferences =>
  _preferences.value() ?? DEFAULT_PREFERENCES;

/** Streaming subscription handle. Use this when callers need
 *  `.pending()` / `.error()` (e.g. boot gating) rather than the value. */
export const preferencesSub = _preferences.sub;

/** Patch user preferences; reports failures via `toast`. Pass
 *  `{ coalesce: true }` for high-frequency writes (panel-size drags) to
 *  trailing-debounce the server round-trip — see the cell's `coalesceMs`. */
export function updatePreferences(
  patch: PreferencesPatch,
  opts?: { coalesce?: boolean },
): void {
  void _preferences
    .patch(patch, opts)
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

// Remote hosts kolu recognises (KOLU_HOSTS_JSON + ~/.ssh/config) — offered in
// the "Connect to host…" palette so the user picks instead of retyping (P3).
const _knownHosts = app.cells.knownHosts.use({
  onError: (err) =>
    toast.error(`Known-hosts subscription error: ${err.message}`),
});
export const knownHosts = (): KnownHost[] => _knownHosts.value() ?? [];

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
