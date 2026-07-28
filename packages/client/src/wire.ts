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
 * `activePadiRpc.*` (padiSurface procedures). None of these are on `app.rpc`.
 *
 * The `preferences` accessor below collapses what used to be a hand-rolled
 * `usePreferences` module into a module-level subscription — every consumer reads
 * the same singleton without per-component lookups. The per-host `recentRepos` /
 * `recentAgents` / `savedSession` readouts moved to `./hostScope/activeWire` (W9),
 * where they WINDOW the active host's RETAINED wire subs (see the note near
 * `preferences` below); they are no longer defined in this module.
 */

import { connectSurfaces } from "@kolu/surface-app/solid";
import { connectSurfaceMap } from "@kolu/surface-map/client";
import type { contract } from "kolu-common/contract";
import {
  decodeHostKey,
  encodeHostKey,
  hostKeysInclude,
} from "kolu-common/hostKey";
import {
  type ClientErrorPolicy,
  DEFAULT_PREFERENCES,
  type Preferences,
  type PreferencesPatch,
  surfaces,
} from "kolu-common/surface";
import {
  type ConnectionInfo,
  type HostKey,
  LOCAL_HOST,
  padiHostMap,
} from "kolu-common/surfacesWithPadi";
import type { WebSocket as PartySocket } from "partysocket";
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
} from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { groundActiveHost } from "./host/groundActive.ts";
import { hostReconcileTarget } from "./host/hostReconcile.ts";
import { hostLabel } from "./host/hostChipTone.ts";
import { persistedPref } from "./persistedPref.ts";

const { protocol, host } = window.location;
const wsBaseUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

/** The ONE kolu client-error interpreter (SR11, fork-A) — the single place kolu's
 *  app-owned {@link ClientErrorPolicy} arms are rendered. Registered at BOTH seams
 *  (`connectSurfaces` for the root app cells — origin-free; `connectSurfaceMap` for the
 *  padi map — origin `{ key }` injected per entry), so a spec-declared `client.onError`
 *  policy reaches app code on a subscription failure without any use-site `onError`. It
 *  REPLACES the hand-rolled `surfaceSubError` (createHostWire) and `onHostMembershipError`
 *  (this module) — both folded in.
 *
 *  Arms:
 *   - `toast`     — plain `${label} error: ${msg}` (root app cells + membership);
 *   - `hostToast` — `Host ${hostLabel(origin.key)} ${label} error: ${msg}` (urgency,
 *     and — the 4C ruling — daemonStatus, whose chip now gains host attribution and
 *     whose background failure becomes a host-named toast);
 *   - `scopedSub` — the retained per-host sub split: the GROUNDED-active host toasts
 *     `${label}: ${msg}`; a background host logs (never dropped). Activeness is the
 *     GROUNDED enc-compare (`groundedActiveHost()` vs `origin.key`, both encoded — never
 *     raw `activeHost`, never ref identity), matching the retained-scope contract.
 *
 *  m6 dedup: every toast carries a deterministic `{ id }` keyed on `kind:label:host`, so
 *  daemonStatus — opened at TWO subscriptions per host (createHostWire + the chip) —
 *  collapses its identical `Host X daemon status error` to ONE (solid-sonner updates the
 *  existing toast in place) instead of stacking two. */
export function interpretClientError(
  p: ClientErrorPolicy,
  err: Error,
  origin?: { key: HostKey },
): void {
  const originEnc = origin ? encodeHostKey(origin.key) : "";
  const id = `${p.kind}:${p.label}:${originEnc}`;
  // `hostToast` and `scopedSub` ride ONLY origin-bearing (map-entry) members — a
  // root-surface member is typed to the origin-free `toast` arm (F8). So a missing
  // origin in either is an IMPOSSIBLE state (origin injection regressed): FAIL LOUD
  // rather than silently emit an unattributed toast / a `for ?` background line
  // (caught-error-must-not-collapse). `originEnc` then equals `encodeHostKey(origin.key)`.
  const requireOrigin = (): HostKey => {
    if (!origin)
      throw new Error(
        `interpretClientError: ${p.kind} "${p.label}" reached with no origin — ` +
          "it is declared on a map-entry member; origin injection must have regressed.",
      );
    return origin.key;
  };
  match(p)
    .with({ kind: "toast" }, (t) => {
      toast.error(`${t.label} error: ${err.message}`, { id });
    })
    .with({ kind: "hostToast" }, (t) => {
      toast.error(
        `Host ${hostLabel(requireOrigin())} ${t.label} error: ${err.message}`,
        { id },
      );
    })
    .with({ kind: "scopedSub" }, (t) => {
      requireOrigin();
      const g = groundedActiveHost();
      const active = g !== null && encodeHostKey(g) === originEnc;
      if (active) toast.error(`${t.label}: ${err.message}`, { id });
      else
        console.error(
          `createHostWire: background ${t.label} for ${originEnc}: ${err.message}`,
        );
    })
    .exhaustive();
}

// `connectSurfaces` is the receptacle for "multiple sibling surfaces over one
// reconnecting socket with the half-open watchdog wired in." kolu plugs into it
// like drishti does, instead of re-assembling `createSurfaceSocket` →
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
  // The root app cells (koluSurface / surfaceApp) declare origin-FREE `toast` policies;
  // route them through the ONE interpreter (design §A/m4).
  onClientError: (p, e) => interpretClientError(p as ClientErrorPolicy, e),
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
// failure PER MEMBER: each cell/collection DECLARES its `client.onError` policy on the
// spec (`toast` for the root cells; `hostToast`/`scopedSub` for the padi map's per-host
// members), and the ONE `interpretClientError` (registered at both `connectSurfaces` and
// `connectSurfaceMap` above) renders it next to the state it owns — the house style
// (`.claude/rules/toast-conventions.md`: "colocated, not centralized"), now DECLARED once
// per member rather than hand-wired at every `.use()`.
// A single global "is the app healthy?" gate is the wrong shape for a terminal
// workspace, where one degraded cell must not blank the canvas. The fold ships for a
// consumer whose control plane WANTS one answer:
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
//    (a reactive lens that re-keys on switch). The map is dialled over `conn`'s BRANDED
//    transport handle: `connectSurfaceMap` slices the sibling BY `padiHostMap.name`
//    ("padi", declared on the map — PR3, no stringly key here) and recovers the parent
//    `connectSurfaces` watchdog `live` by construction (the handle is unforgeable), so
//    every chip floors on the real socket — there is no raw `{ live }` seam to pass a
//    green-over-dead accessor through.
export const padiMap = connectSurfaceMap(padiHostMap, conn.transport, {
  // The padi map's per-entry members (identity/urgency/status/…/daemonStatus) and its
  // membership `entries` collection declare their policies on the spec; route them all
  // through the ONE interpreter, with the per-key `origin` the map injects for entry
  // members (`entries` fires origin-free). This folds in the old `surfaceSubError`
  // (createHostWire) and `onHostMembershipError` (deleted here).
  onClientError: (p, e, origin) =>
    interpretClientError(p as ClientErrorPolicy, e, origin),
});

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

/** Convenience alias — the FULL combined link. `client.server.info(...)` /
 *  `client.daemon.restart(...)` reach the only raw oRPC procedures left at the
 *  link root (the `terminal.*` / `git.*` roots were deleted at W1.R7 — those
 *  mutations go through `activePadiRpc.*`);
 *  `client.surface.kolu.preferences.patch(...)` /
 *  `client.surface.surfaceApp.identity.info(...)` reach the sibling surfaces.
 *  (Note: the surface-bound `.use(...)` hooks come off `app`/`surfaceApp`, which
 *  wrap a SCOPED slice of this same link.) */
export const client = link;

// Preferences (host-INDEPENDENT) rides the ONE app-scope reader below, beside the
// host-membership authority — there is NO import-time module-const subscription (the
// sharing-by-convention singleton this PR deletes). Its `preferences()` /
// `updatePreferences()` accessors are defined just after that `createRoot`.

// ── The app-scope reader for the HOST-INDEPENDENT + membership readouts ──────
//
// The per-HOST wire subscriptions — activityFeed, saved session, the terminal-list keys,
// the `terminals` metadata collection, and daemon status — moved OUT of here at W9: they
// now live in the RETAINED per-host `scopedByEntry` owner (`hostScope/createHostWire`),
// read through `activeScope().wire.*` by the facades in `./hostScope/activeWire`, so a
// switch-BACK has no resubscribe and no pending window (the ~1s canvas rebuild W7's K1 left
// behind). The Code tab's per-host reads got the SAME retention, in a PARALLEL owner
// (`right-panel/hostCodeTab`) — not a `createHostWire` sibling, because its inputs read
// view-selection state downstream of this module; see its header. What STAYS in this
// app-lifetime `createRoot` is the state that is NOT per-host-retained:
//   - `preferences` — HOST-INDEPENDENT (no host to capture);
//   - `members` — the ONE `entries` membership authority (shared by the reconcile below and
//     HostSelectorStrip via the base-client ref-count);
//   - `connection` — the ACTIVE host's link-health cell (W6), via `useEntry(activeHost)`,
//     deliberately kept ACTIVE-HOST ONLY, not retained: a background host's connect
//     narration is not something to hold warm;
//   - the host-membership reconcile + `rpc` (`active.rpc` off `useEntry(activeHost)`, a
//     point client that re-keys freely).
//
// `connection` and `rpc` (both off `useEntry(activeHost)`) are deliberately ACTIVE-HOST-ONLY
// — cheap to re-open, and the keyed lens re-keys on switch (to narrate the newly-active host)
// AND on a same-key re-add (a new `membershipId`). A single `createRoot` at module init is their app-lifetime
// owner — never disposed.
const hostScoped = createRoot(() => {
  const active = padiMap.useEntry(activeHost);
  // The membership authority — shared by the host-membership reconcile (further down) and
  // HostSelectorStrip (deduped via the base-client ref-count). The active host's connection
  // cell re-arms itself off `active`'s `membershipId` re-key (below), not this membership read.
  const members = padiMap.entries.use();
  // FAIL-FAST invariant guard (juspay/kolu#1766): `LOCAL_HOST` is the server's unremovable
  // seed[0] (`server/index.ts`), so once membership has LOADED (a non-empty snapshot) it MUST
  // contain local. Both `groundedActiveHost` (scans uniformly → `null` if local is absent) and
  // `hostReconcileTarget` (short-circuits local → never bounces it) trust that invariant, so a
  // violation would silently strand `activeScope()` at `undefined` (a blank canvas) with no
  // toast, warn, or error — the exact silent-degradation the repo's fail-fast rule forbids.
  // Surface it LOUDLY instead. Empty membership is the honest pre-snapshot warming window, NOT
  // a violation, so it is excluded. Dev-gated (the diagnostic is compiled out of production, as
  // with `scopedByEntry`'s non-member warn) — the real fix for a real violation is server-side.
  if (process.env.NODE_ENV !== "production") {
    createEffect(() => {
      const keys = members.keys();
      if (keys.length > 0 && !hostKeysInclude([...keys], LOCAL_HOST)) {
        console.error(
          "[wire] INVARIANT VIOLATION: membership loaded but LOCAL_HOST is absent — the " +
            "local host is the unremovable seed and must always be a member. groundedActiveHost " +
            "will read null and the reconcile will not bounce local, so the per-host scope stays " +
            "undefined (blank canvas) with no other signal. This is a server-side pool bug.",
        );
      }
    });
  }
  // The ACTIVE host's link health (W6 — "the honest connect"): its `phase`
  // (probing/provisioning/connecting/…) + live `log` tail drive the connect overlay so a cold
  // remote provision narrates its real phase instead of a mute "Connecting…".
  //
  // SR9 — ONE connection authority. This is NO LONGER a second `connection` cell
  // subscription (that cell is gone). It is the FINE `connection` payload the host map
  // publishes on the ENTRY — the SAME `active.state()` the dot reads — so the dot and the
  // word derive from ONE subscription and can never disagree (the drishti#102 divergence
  // has no encoding left). `useEntry` already re-keys the entry on a host switch AND a
  // same-key re-add (a new `membershipId`), so this read rebuilds by construction (PR3).
  // Active-host-only falls out for free: only the active entry's state is read here.
  //
  // Read off the UP arms only. A `failed` entry carries no `connection` field at all
  // (see `@kolu/surface-map`'s `FailureEvidence`), so a failed host answers `undefined`
  // here and its readers go to `failedEpisode`/`evidence` instead.
  const connection = (): ConnectionInfo | undefined =>
    match(active.state())
      .with({ kind: "warming" }, { kind: "connected" }, (s) => s.connection)
      // Spelled EXHAUSTIVELY, not `.otherwise()`: a future arm that DOES carry a live
      // word must state its policy here rather than silently answering "no connection".
      // This is the read that narrated the wrong thing for a year.
      .with({ kind: "failed" }, { kind: "not-a-member" }, () => undefined)
      .exhaustive();
  // Preferences is HOST-INDEPENDENT (no host to capture), but it rides this ONE app-scope
  // owner rather than a bare import-time module-const sub — the sharing-by-convention
  // singleton the map redesign deletes. One `.use()` here; every `preferences()` reader
  // folds onto it (the base-client dedup would share it even if opened per-consumer, but
  // imperative module-level readers like useTips have no reactive owner of their own).
  // Authority (`local`), the coalesce window (#1041), and the error policy now ride the
  // `preferences` cell's `client` DECLARATION (kolu-common/surface) — routed through the
  // ONE interpreter — so this use-site is bare.
  const preferences = app.cells.preferences.use();
  // Host-membership reconcile: if the ACTIVE host leaves the pool — the user ✕'d their own
  // guest chip, or the server auto-retired it on re-serve-pump death (`pool.remove`) —
  // `useEntry(activeHost)` does NOT re-key on its own, so the tab would be stranded on a
  // dead host (every `activePadiRpc` call throws `MAP_KEY_UNKNOWN`, canvas frozen,
  // no chip lit). Mirror the terminal auto-switch at the host level: once a membership
  // snapshot has landed, a departed active host falls back to the unremovable LOCAL default,
  // LOUDLY (the server-driven auto-retire is otherwise silent). The `entries` sub dedups
  // with the selector strip's via the base-client ref-count.
  // Both whole-collection `entries` consumers (this sub + HostSelectorStrip's strip) now open
  // BARE — the membership error policy (`Host membership error: …`) rides the map's
  // `entriesClient` declaration and routes through the ONE `interpretClientError`; the
  // interpreter's `{ id }` dedup (kind:label:host) collapses an identical membership toast to
  // one regardless of which consumer's sub fired it. (`members` is defined ABOVE — shared
  // with the connection re-arm.)
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
  // The pool membership, exposed as a plain accessor so the host-switcher
  // palette group can list hosts off the SAME `members` authority this block
  // holds — no second `entries` subscription in the command layer.
  const hostKeys = (): HostKey[] => [...members.keys()];
  return {
    connection,
    preferences,
    requestActivateOnJoin: setPendingJoin,
    hostKeys,
    procedures: active.procedures,
    streams: active.streams,
  };
});

/** Register add-a-host intent: activate `host` as the active host once it appears in the pool
 *  membership — the race-free replacement for a bare `setActiveHost` in the add-host `.then`.
 *  Feeds the pending signal the ONE reconcile effect consumes (`hostReconcileTarget`'s
 *  join-activation arm), so there is no second `setActiveHost` writer to reason about. */
export const requestActivateOnJoin = hostScoped.requestActivateOnJoin;

/** The current pool membership as a plain accessor — reads the `members`
 *  authority `hostScoped` already holds, so the host-switcher palette group can
 *  list hosts without opening a second `entries` subscription. */
export const hostKeys = hostScoped.hostKeys;

/** The ACTIVE host GROUNDED against live membership — the accessor the per-host SCOPE
 *  (`hostScope/hostScopes` → `scopedByEntry`) reads instead of raw `activeHost`: the
 *  active host IFF a current member (`hostKeys`), else `null`. Fuses the per-tab INTENT
 *  (`activeHost`) with the membership authority (`hostKeys`) through the pure
 *  {@link groundActiveHost}, which owns the WHY (the boot-window false positive it closes,
 *  and why `null` — not a local substitute). Feeding THIS, not raw `activeHost`, to
 *  `scopedByEntry` makes "kolu hands the per-host world an ungrounded active host"
 *  unconstructible; `activeHost` itself stays the non-null intent every other readout
 *  (`useEntry`, `foldState`, `padiMap.entry`) keys on.
 *
 *  A `createMemo` (the repo's multi-consumer-derivation rule): `scopedByEntry` reads it from
 *  several reactive contexts (`activeScope`, each per-key `isActive`, `activated`), and
 *  `groundActiveHost` returns either `activeHost()`'s stable reference or `null` — so a
 *  membership change that doesn't alter the grounded host recomputes only this cheap memo and
 *  stops, instead of fanning every consumer out on unrelated pool churn. In its own app-lifetime
 *  `createRoot`, like `localDaemonStatus`. */
export const groundedActiveHost: Accessor<HostKey | null> = createRoot(() =>
  createMemo(() => groundActiveHost(activeHost(), hostKeys())),
);

/** The ACTIVE host as its ENCODED key — the string the attention mirror, the
 *  marks store and every pip binder are keyed by.
 *
 *  One memo, not the `() => encodeHostKey(activeHost())` thunk five call sites
 *  each wrote inline: passed into a per-row memo, that thunk re-encodes the host
 *  inside EVERY row's binder on every reactive tick — a pure function of one
 *  signal, recomputed per row per frame. It also gave five surfaces five
 *  independently-derived spellings of the one key those surfaces must agree on.
 *  A memo returns the same string reference until the host actually changes, so
 *  a row's pip memo stops re-running just because something else ticked. */
export const encActiveHost: Accessor<string> = createRoot(() =>
  createMemo(() => encodeHostKey(activeHost())),
);

/** The FUSED active-host procedure client — `padiMap.useEntry(activeHost).procedures`,
 *  built once inside the app-scope `hostScoped` owner above (the `useEntry` reactive
 *  lens already re-keys on switch; its `procedures` face reads the CURRENT key per
 *  call, so this single client always routes to whichever host is active). Every
 *  lifecycle / chrome / screen / fs / git / session procedure call site should read
 *  `activePadiRpc.<ns>.<verb>(...)` instead of re-deriving the host by hand via
 *  `padiMap.entry(activeHost()).procedures`. */
export const activePadiRpc = hostScoped.procedures;

/** The FUSED active-host STREAM face — `padiMap.useEntry(activeHost).streams`,
 *  built once inside `hostScoped` (re-keys on switch like `activePadiRpc`). The
 *  home for the DELIBERATELY UN-ENROLLED stream reaches (`.streams.<key>.unenrolled`
 *  → `unenrolledStreamCall`): the terminal re-attach (#1591) and the code tab's
 *  change pulses, whose transient re-subscribes must NOT flicker padi's `health()`
 *  gate, so they take the raw ref rather than the enrolling `.use()`. Every OTHER
 *  (enrolled) per-host stream rides `activeScope().wire` / `entry.streams.<key>.use`;
 *  this accessor is only the carve-out reach. */
export const activePadiStreams = hostScoped.streams;

/** The ACTIVE host's link-health value (`phase` + `log` tail), or `undefined` before its
 *  first frame. Drives the connect overlay's probing/provisioning narration. Already floored on
 *  the map's transport liveness at the ONE floor — `active.state()` runs through surface-map's
 *  `floorOnLiveness`, which drops the fine `connection` word (as well as demoting the dot) when
 *  our link to the publisher is dead/half-open, so a frozen `probing`/`provisioning` phase stops
 *  asserting a live phase (#1568). No client-side re-floor: the word inherits the SAME liveness
 *  decision as the dot by construction, so the two can never disagree. */
export const connectionInfo = (): ConnectionInfo | undefined =>
  hostScoped.connection();

// The per-host wire-view facades — recentRepos / recentAgents / savedSession /
// savedSessionSub / terminalListSub — WINDOW the active host's RETAINED wire
// subscriptions (`activeScope().wire`, W9). They live in `./hostScope/activeWire.ts`,
// NOT here: they depend on `activeScope` (`./hostScope/hostScopes`), which depends on
// THIS module (`padiMap`/`activeHost`), so defining them here would close a
// `wire → hostScopes → wire` import cycle (`biome`'s `noImportCycles`). That leaf module
// imports both and is imported by neither, keeping the graph acyclic. Consumers import
// those facades from `./hostScope/activeWire`, not from here.

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
