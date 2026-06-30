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

import { connectSurfaces } from "@kolu/surface-app/solid";
import type { contract } from "kolu-common/contract";
import {
  DEFAULT_PREFERENCES,
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

// `connectSurfaces` is the receptacle for "multiple sibling surfaces over one
// reconnecting socket with the half-open watchdog wired in." kolu plugs into it
// like pulam-web/drishti do, instead of re-assembling `createSurfaceSocket` →
// `createLiveSignal` → `surfaceClients` by hand: it owns the socket + the `pid`
// echo (which threads the last-observed server `processId` back as a query param on
// every (re)connect, so a stale tab reconnecting to a RESTARTED server is recognized
// at the handshake), the always-on half-open watchdog (probing `system.live` over
// the first sibling's slice of the combined link it builds — the probe channel is
// provably the reconnected channel), and the per-sibling clients. We pass the
// combined `typeof contract` so `conn.link` is fully typed.
//
// No `retireOnStaleClose`/`restartCloseCode` here — kolu's lifecycle (`rpc.ts`)
// owns this socket and retires it through `onStaleRestart`. The watchdog lives HERE
// (one socket, one watchdog), which is why `rpc.ts`'s `createServerLifecycle` runs
// with `heartbeat: false`. `siblingKey` is auto-picked (`Object.keys(surfaces)[0]`)
// — every sibling answers `system.live`, so the choice is immaterial.
//
// Both type args are explicit (`<combined contract, surfaces map>`): TypeScript has
// no partial inference, so once `C` is given for the typed `conn.link`, `E` must be
// given too or it would fall back to its loose default and untype `conn.clients`.
const conn = connectSurfaces<typeof contract, typeof surfaces>({
  surfaces,
  url: wsBaseUrl,
});
const { ws, echo } = conn;

/** Stash the latest observed server `processId` for the next reconnect's `pid`
 *  echo — fed by `rpc.ts`'s lifecycle `onProcessId`. It's null until the first
 *  probe, so the very first connect omits the param. */
export const rememberServerProcessId = echo.remember;
export { ws };

// Expose for e2e tests: the reconnect regression test (#410) needs to
// drop and restore the socket directly. Same pattern as __xterm on the
// terminal container. Harmless in production — just an attribute on window.
(window as Window & { __koluWs?: PartySocket }).__koluWs = ws;

// The single combined oRPC link `connectSurfaces` built (`{ surface: { kolu,
// surfaceApp, terminalWorkspace }, server, terminal, git }`) — the raw oRPC
// procedures (`terminal`, `git`, `server`) live at its root (kolu's ROOT-level
// multiplexed procedures, the reason kolu needs the combined link back from the
// seam); the three sibling surfaces live under `surface.<key>`. Typed off
// `typeof contract`, so `client` below is fully typed.
const link = conn.link;

// kolu serves THREE sibling surfaces over one transport (kolu#1197); `connectSurfaces`
// scopes each per-key client to its slice (`{ surface: link.surface[key] }`) so its
// primitives resolve at the wire path `/surface/<key>/<prim>/<verb>` that
// `implementSurfaces` serves.
//
// kolu deliberately does NOT fold these siblings via `surfaceClientsHealth` (the
// Leak-D multi-surface fact) — it ignores `conn.health`. kolu surfaces subscription
// failure PER CELL, colocated — each `.use({ onError })` below raises its own
// `toast.error` next to the state it owns (preferences / activityFeed / session /
// terminalList) — which is the house style (`.claude/rules/toast-conventions.md`:
// "colocated, not centralized"). A single global "is the app healthy?" gate is the
// wrong shape for a terminal workspace, where one degraded cell must not blank the
// canvas. The fold ships for a consumer whose control plane WANTS one answer:
// drishti folds its admin + surface-app siblings with `surfaceClientsHealth` (its
// `MultiHostApp` control-plane strip); `surfaceClient.health.test.ts` pins the fold.
const clients = conn.clients;

/** kolu's OWN surface client — `app.cells.preferences.use(...)`,
 *  `app.collections.authored.use(...)`, `app.streams.gitStatus.use(...)`,
 *  etc. Every existing `app.*` call site reaches kolu's own primitives. */
export const app = clients.kolu;

/** surface-app's surface client — the build-identity `buildInfo` cell (read via
 *  `surfaceApp.cells.buildInfo.use({ authority: "server" })`) and the
 *  `identity.info` restart probe (`surfaceApp.rpc.surface.identity.info({})` —
 *  the `surfaceApp` key is consumed by the scope, so it does NOT reappear in the
 *  path). Handed to `<SurfaceAppProvider controlPlane=...>` + `createServerLifecycle`. */
export const surfaceApp = clients.surfaceApp;

/** The GENERIC `@kolu/terminal-workspace` surface client — kolu reads the
 *  per-terminal `awareness` collection here
 *  (`workspace.collections.snapshots.use(...)`) and joins each value with the
 *  matching `kolu.authored` record in `useTerminalMetadata`. This is the SAME
 *  surface `pulam` serves, so R9 (remote awareness) becomes a pure backing-swap
 *  behind this one collection — no second client read path to migrate. */
export const workspace = clients.terminalWorkspace;

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
