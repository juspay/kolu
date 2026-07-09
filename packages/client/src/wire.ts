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
 * The only raw oRPC procedures left at the ROOT of the full combined link
 * (exported as `client`) are `server` + `daemon` — `client.server.info(...)`,
 * `client.daemon.restart(...)`. The root `terminal.*` / `git.*` namespaces were
 * DELETED at W1.R7; terminal/git mutations now go through
 * `activePadiRpc.surface.*` (padiSurface). None of these are on `app.rpc`.
 *
 * The `preferences` / `recentRepos` / `savedSession` accessors below
 * collapse what used to be hand-rolled `usePreferences` / `useActivityFeed`
 * / `useSavedSession` modules into module-level subscriptions — every
 * consumer reads the same singleton without per-component lookups.
 */

import type {
  padiSurface,
  RecentAgent,
  RecentRepo,
  SavedSession,
} from "@kolu/padi/surface";
import { unenrolledStreamCall } from "@kolu/surface/client";
import {
  createReactiveSubscription,
  type Subscription,
} from "@kolu/surface/solid";
import { connectSurfaces } from "@kolu/surface-app/solid";
import { connectSurfaceMap } from "@kolu/surface-map/client";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "kolu-common/contract";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type PreferencesPatch,
  surfaces,
  type TerminalId,
} from "kolu-common/surface";
import {
  type ConnectionInfo,
  type HostKey,
  LOCAL_HOST,
  padiHostMap,
} from "kolu-common/surfacesWithPadi";
import type { WebSocket as PartySocket } from "partysocket";
import { createEffect, createRoot, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { hostReconcileTarget } from "./host/hostReconcile.ts";
import { persistedPref } from "./persistedPref.ts";

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
//
// `C` and `E` are INDEPENDENT: `conn.clients` types off `E`, `conn.link` off `C`.
// kolu feeds the padi-LESS sibling set (`surfaces` = { kolu, surfaceApp }) — padi is no
// longer a single sibling but a keyed MAP of remote surfaces (`padiMap` below), dialled
// over a SCOPED slice of `conn.link`. `kolu` stays the first sibling (the watchdog's
// `system.live` probe channel).
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
// surfaceApp }, server, daemon }`) — the only raw oRPC procedures left at its root
// are `server` + `daemon` (kolu's ROOT-level multiplexed procedures, the reason
// kolu needs the combined link back from the seam; the `terminal`/`git` roots were
// deleted at W1.R7); the sibling surfaces live under `surface.<key>`. Typed off
// `typeof contract`, so `client` below is fully typed.
const link = conn.link;

// kolu serves TWO sibling surfaces over one transport (kolu#1197) — plus the
// server-added `padi` sibling; `connectSurfaces` scopes each per-key client to its
// slice (`{ surface: link.surface[key] }`) so its primitives resolve at the wire
// path `/surface/<key>/<prim>/<verb>` that `implementSurfaces` serves.
//
// kolu deliberately does NOT fold these siblings via `surfaceClientsHealth` (the
// Leak-D multi-surface fact) — it ignores `conn.health`. kolu surfaces subscription
// failure PER CELL, colocated — each `.use({ onError })` below raises its own
// `toast.error` next to the state it owns (preferences / activityFeed / session /
// terminal list) — which is the house style (`.claude/rules/toast-conventions.md`:
// "colocated, not centralized"). A single global "is the app healthy?" gate is the
// wrong shape for a terminal workspace, where one degraded cell must not blank the
// canvas. The fold ships for a consumer whose control plane WANTS one answer:
// drishti folds its admin + surface-app siblings with `surfaceClientsHealth` (its
// `MultiHostApp` control-plane strip); `surfaceClient.health.test.ts` pins the fold.
const clients = conn.clients;

/** kolu's OWN surface client — `app.cells.preferences.use(...)`,
 *  `app.cells.processMemory.use(...)`, and `app.cells.padiLink.use(...)` (kolu-server's
 *  live view of its binding to padi). Those cells are all koluSurface owns now; the
 *  terminal record, urgency, daemon status, session, activity feed, and the
 *  `terminalExit` event ride `padi.*`. */
export const app = clients.kolu;

/** surface-app's surface client — the build-identity `buildInfo` cell (read via
 *  `surfaceApp.cells.buildInfo.use({ authority: "server" })`) and the
 *  `identity.info` restart probe (`surfaceApp.rpc.surface.identity.info({})` —
 *  the `surfaceApp` key is consumed by the scope, so it does NOT reappear in the
 *  path). Handed to `<SurfaceAppProvider controlPlane=...>` + `createServerLifecycle`. */
export const surfaceApp = clients.surfaceApp;

// ── The padi MAP — a keyed map of remote surfaces: ONE entry surface (`padiSurface`)
//    served N times, keyed by host. `padi` is no longer a single client — every host's
//    padi rides `padiMap.entry(host)` (a pure point lens) or `padiMap.useEntry(activeHost)`
//    (a reactive lens that re-keys on switch). The map is dialled over the `padi` SIBLING
//    of `conn`'s BRANDED transport handle: `connectSurfaceMap` slices `padi` from it and
//    recovers the parent `connectSurfaces` watchdog `live` by construction (the handle is
//    unforgeable), so every chip floors on the real socket — there is no raw `{ live }`
//    seam to pass a green-over-dead accessor through.
export const padiMap = connectSurfaceMap(padiHostMap, conn.transport, "padi");

/** The ONE membership-error handler for `padiMap.entries` — shared by BOTH whole-collection
 *  consumers (this module's reconcile sub + `HostSelectorStrip`'s strip) so a membership-stream
 *  failure toasts once, not twice. The whole-collection dedup slot now supports a per-consumer
 *  `onError` REGISTRY (`surfaceClient.ts`), so two distinct handlers — or a bare `.use()` racing
 *  ahead of this one — would each still fire independently regardless of registration order;
 *  sharing this one reference is a choice for a single toast, not a requirement to avoid a
 *  crash. */
export const onHostMembershipError = (err: Error): void => {
  toast.error(`Host membership error: ${err.message}`);
};

/** The per-tab ACTIVE host — which host's padi surface THIS browser tab views. Backed by
 *  `sessionStorage` (per-tab, never shared across tabs). The persisted value is the
 *  CANONICAL wire string (`encodeHostKey`/`decodeHostKey` — NOT the default
 *  `JSON.stringify`, which would write `{"kind":"local"}` instead of `"local"`),
 *  defaulting to the unremovable LOCAL default. Switching it re-keys every
 *  `useEntry(activeHost)` readout — the canvas live-switches, no reload. */
export const [activeHost, setActiveHost] = persistedPref<HostKey>({
  name: "kolu-active-host",
  fallback: LOCAL_HOST,
  parse: (raw) => decodeHostKey(raw),
  serialize: encodeHostKey,
  storage: sessionStorage,
  // Surface a corrupt/invalid stored host rather than silently collapsing to the local
  // default — otherwise "the stored active host was garbage" reads identically to "this tab
  // has always been local." Resetting to LOCAL_HOST is benign, so a warn is the right level
  // (matches useDaemonStatus's reattachAnnouncedAt pref). caught-error-must-not-collapse.
  onInvalid: (err, raw) =>
    console.warn(
      `[wire] stored active-host "${raw}" is invalid; resetting to the local default:`,
      err,
    ),
});

/** The active-host PROCEDURE client, typed as the concrete padi contract client (the
 *  generic map types `entry(k).rpc` as `unknown`, so the one concrete cast lives HERE).
 *  Kept for the (currently hypothetical) FIXED-host caller — one that must reach a
 *  host other than whichever is active. Every real call site instead wants
 *  `activePadiRpc` below, which fuses this with `activeHost()` so it never has to be
 *  spelled out. */
type PadiRpc = ContractRouterClient<
  typeof padiSurface.contract,
  ClientRetryPluginContext
>;
export const padiRpcOf = (host: HostKey): PadiRpc =>
  padiMap.entry(host).rpc as PadiRpc;

/** Convenience alias — the FULL combined link. `client.server.info(...)` /
 *  `client.daemon.restart(...)` reach the only raw oRPC procedures left at the
 *  link root (the `terminal.*` / `git.*` roots were deleted at W1.R7 — those
 *  mutations go through `activePadiRpc.surface.*`);
 *  `client.surface.kolu.preferences.patch(...)` /
 *  `client.surface.surfaceApp.identity.info(...)` reach the sibling surfaces.
 *  (Note: the surface-bound `.use(...)` hooks come off `app`/`surfaceApp`, which
 *  wrap a SCOPED slice of this same link.) */
export const client = link;

// Preferences (host-INDEPENDENT) rides the ONE app-scope reader below, beside the
// host-scoped readouts — there is NO import-time module-const subscription (the
// sharing-by-convention singleton this PR deletes). Its `preferences()` /
// `updatePreferences()` accessors are defined just after that `createRoot`.

// ── The ONE app-scope reader for standing readouts ──────────────────────
//
// activityFeed, saved-session, and the terminal-list keys are per-HOST facts — they ride
// `padiMap.useEntry(activeHost)`, so switching the active host must RE-KEY them (the
// canvas live-switches, no reload). `useEntry` demands a reactive owner and re-keys on
// switch (disposing the old host's subs, rebuilding the new host's synchronously); a
// single `createRoot` at module init IS that owner — app-lifetime, never disposed. This
// is the "one deliberate app-scope reader": import-time module-const subs are GONE (a
// const built from `entry(activeHost())` would read the host ONCE at import and never
// re-key — the boot-host-capture hazard). kolu's own host-INDEPENDENT `preferences`
// (above) stays a plain kolu sub — it has no host to capture.
//
// WHY INLINE (do not extract): this owner reads `padiMap`/`activeHost` (defined above)
// AND its readouts are re-exported below beside them, so lifting it into a separate
// `useActiveHostSurface.ts` would make that module import wire.ts and wire.ts import it
// back — a manufactured import cycle. One app-scope owner beside its dependencies IS the
// intent; a module split buys nothing here and only re-introduces the cycle.
const hostScoped = createRoot(() => {
  const active = padiMap.useEntry(activeHost);
  const activityFeed = active.cells.activityFeed.use({
    onError: (err: Error) =>
      toast.error(`Activity feed subscription error: ${err.message}`),
  });
  const session = active.cells.session.use({
    onError: (err: Error) =>
      toast.error(`Saved-session subscription error: ${err.message}`),
  });
  // The ACTIVE host's link-health cell (W6 — "the honest connect"): its `phase`
  // (copying/building/connecting/…) + live `log` tail drive the connect overlay so a
  // cold remote provision narrates its real phase instead of a mute "Connecting…".
  // Re-keys with the entry on host switch, like the readouts above.
  const connection = active.cells.connection.use({
    onError: (err: Error) =>
      toast.error(`Connection subscription error: ${err.message}`),
  });
  // The terminal-list keys stream carries STREAM_RETRY via `unenrolledStreamCall` (the
  // #1591 health carve-out — a re-attach must never flicker the health gate). It is a
  // `createReactiveSubscription` keyed on `activeHost`, so a host switch tears down the old
  // host's keys stream and opens the NEW host's — re-keying in lockstep with the
  // activityFeed/session readouts above (which re-key through the reactive entry). A plain
  // `createSubscription` here would read `activeHost()` ONCE at init and strand the keys
  // stream on the boot host, so the switched-to host's terminals never render (the
  // boot-host-capture hazard). Each id is shaped `{ id }` so `.map(t => t.id)` consumers
  // stay unchanged; between switches the stream resets to pending (not stale boot-host ids).
  const terminalKeys = createReactiveSubscription(
    activeHost,
    (host, signal) =>
      unenrolledStreamCall(padiRpcOf(host).surface.terminals.keys, undefined, {
        signal,
      }),
    { onError: (err) => toast.error(`Terminal list error: ${err.message}`) },
  );
  // Preferences is HOST-INDEPENDENT (no host to capture), but it rides this ONE app-scope
  // owner rather than a bare import-time module-const sub — the sharing-by-convention
  // singleton the map redesign deletes. One `.use()` here; every `preferences()` reader
  // folds onto it (the base-client dedup would share it even if opened per-consumer, but
  // imperative module-level readers like useTips have no reactive owner of their own).
  const preferences = app.cells.preferences.use({
    authority: "local",
    initial: DEFAULT_PREFERENCES,
    // Debounce window for size writes that opt in via `{ coalesce: true }` (#1041): the
    // rightPanel splitter fires a patch per drag frame; discrete toggles flush immediately.
    coalesceMs: 150,
    // Covers subscription drops + coalesced-flush failures.
    onError: (err: Error) => toast.error(`Preferences error: ${err.message}`),
  });
  // Host-membership reconcile: if the ACTIVE host leaves the pool — the user ✕'d their own
  // guest chip, or the server auto-retired it on re-serve-pump death (`pool.remove`) —
  // `useEntry(activeHost)` does NOT re-key on its own, so the tab would be stranded on a
  // dead host (every `activePadiRpc` call throws `MAP_KEY_UNKNOWN`, canvas frozen,
  // no chip lit). Mirror the terminal auto-switch at the host level: once a membership
  // snapshot has landed, a departed active host falls back to the unremovable LOCAL default,
  // LOUDLY (the server-driven auto-retire is otherwise silent). The `entries` sub dedups
  // with the selector strip's via the base-client ref-count.
  // Both whole-collection `entries` consumers (this sub + HostSelectorStrip's strip) bake the
  // SAME `onHostMembershipError` reference into the shared dedup slot's per-consumer registry,
  // so a membership-stream failure surfaces once (not twice) regardless of which consumer
  // registers first — each registered handler now fires independently either way, so sharing
  // this reference is just to avoid a duplicate toast, never to dodge a crash.
  const members = padiMap.entries.use({ onError: onHostMembershipError });
  // Pending add-a-host intent: the host the user just added, to activate the frame it JOINS
  // membership. `hosts.add` resolves BEFORE the `entries` stream delivers the new member, so a
  // bare `setActiveHost` in the add `.then` reads as a departed host to the reconcile below and
  // is bounced to local (adding an N+1th host always landed on local). Feeding the intent INTO
  // the one reconcile decision — rather than a second effect racing it — keeps a single
  // `setActiveHost` writer here. `requestActivateOnJoin` (exported) is just this setter.
  const [pendingJoin, setPendingJoin] = createSignal<HostKey | null>(null);
  // THE ONE active-host effect — enacts `hostReconcileTarget` for BOTH the join-activation and
  // the departed-bounce (see its doc). One writer, one ordering to reason about.
  createEffect(() => {
    const action = hostReconcileTarget(
      members.keys(),
      activeHost(),
      pendingJoin(),
      LOCAL_HOST,
    );
    if (action === null) return;
    if (action.kind === "activate-joined") {
      setPendingJoin(null); // consume the intent — the added host is now active
      setActiveHost(action.target);
      return;
    }
    const departed = activeHost();
    setActiveHost(action.target);
    toast.warning(
      `Host "${encodeHostKey(departed)}" left the pool — switched to the local host`,
    );
  });
  return {
    activityFeed,
    session,
    connection,
    terminalKeys,
    preferences,
    requestActivateOnJoin: setPendingJoin,
    rpc: active.rpc,
  };
});

/** Register add-a-host intent: activate `host` as the active host once it appears in the pool
 *  membership — the race-free replacement for a bare `setActiveHost` in the add-host `.then`.
 *  Feeds the pending signal the ONE reconcile effect consumes (`hostReconcileTarget`'s
 *  join-activation arm), so there is no second `setActiveHost` writer to reason about. */
export const requestActivateOnJoin = hostScoped.requestActivateOnJoin;

/** The FUSED active-host procedure client — `padiMap.useEntry(activeHost).rpc`,
 *  built once inside the app-scope `hostScoped` owner above (the `useEntry` reactive
 *  lens already re-keys on switch; its `rpc` reads the CURRENT key per call, so this
 *  single client always routes to whichever host is active). Every lifecycle / chrome
 *  / screen / fs / git / session procedure call site should read
 *  `activePadiRpc.surface.<ns>.<verb>(...)` instead of re-deriving the host by hand via
 *  `padiRpcOf(activeHost())`. */
export const activePadiRpc: PadiRpc = hostScoped.rpc as PadiRpc;

/** The ACTIVE host's link-health cell value (`phase` + `log` tail), or `undefined`
 *  before its first frame. Drives the connect overlay's copying/building narration. */
export const connectionInfo = (): ConnectionInfo | undefined =>
  hostScoped.connection.value();

export const recentRepos = (): RecentRepo[] =>
  hostScoped.activityFeed.value()?.recentRepos ?? [];
export const recentAgents = (): RecentAgent[] =>
  hostScoped.activityFeed.value()?.recentAgents ?? [];

/** Local-store accessor for user preferences — authoritative after the first server yield. */
export const preferences = (): Preferences =>
  hostScoped.preferences.value() ?? DEFAULT_PREFERENCES;

/** Patch user preferences; reports failures via `toast`. Pass `{ coalesce: true }` for
 *  high-frequency writes (panel-size drags) to trailing-debounce the server round-trip —
 *  see the cell's `coalesceMs`. */
export function updatePreferences(
  patch: PreferencesPatch,
  opts?: { coalesce?: boolean },
): void {
  void hostScoped.preferences
    .patch(patch, opts)
    .catch((err: Error) =>
      toast.error(`Failed to save preferences: ${err.message}`),
    );
}

/** The persisted saved-session for the active host, or null when none exists / no yield
 *  yet. Re-keys when the active host switches. */
export const savedSession = (): SavedSession | null =>
  hostScoped.session.value() ?? null;
export const savedSessionSub = hostScoped.session.sub;

/** Subscription handle for the live terminal list of the active host — `{ id }` rows in
 *  server order, derived from padi's `terminals` collection keys. Consumers read
 *  `.map(t => t.id)` / `.pending()` exactly as they did the retired `terminalList` cell. */
export const terminalListSub: Subscription<{ id: TerminalId }[]> =
  Object.assign(() => hostScoped.terminalKeys()?.map((id) => ({ id })), {
    pending: hostScoped.terminalKeys.pending,
    error: hostScoped.terminalKeys.error,
    // Forwarded, not dropped: `terminalKeys` is a `createReactiveSubscription`, which
    // always populates `complete` — omitting it here would silently strand a consumer
    // that checks it (there is none today, but the field-audit rule is "populate what
    // the source has," not "only what today's readers use").
    complete: hostScoped.terminalKeys.complete,
  });
