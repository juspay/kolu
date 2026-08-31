/**
 * One reconnecting websocket wire feeding `surfaceClient` + module-level
 * `.use(...)` calls for the app's singleton reactive subscriptions.
 *
 * `app` is the SCOPED kolu surface client (`clients.kolu`) — only kolu's own
 * surface bundle, not the whole wire. It exposes:
 *   - `app.cells / .collections / .streams / .events` — bound `.use(policy)`
 *     hooks (drop `source` / `mutate` / `valueSource` / `keyToInput`)
 *   - `app.rpc` — kolu's scoped member FACE (tags `surface/kolu/<member>/<verb>`);
 *     surface-managed procedures resolve through it.
 *
 * The raw procedures at the ROOT of the wire (`server/info`, `daemon/restart`,
 * the five `hosts/*` verbs) are not surface members, so they get their typed
 * face from `./rpc/rootProcedures` — exported here as `client`, read
 * `client.server.info(...)` / `client.hosts.add(...)` exactly as before. The
 * root `terminal.*` / `git.*` namespaces were DELETED at W1.R7; terminal/git
 * mutations now go through `activePadiRpc.*` (padiSurface procedures).
 *
 * TOP-LEVEL AWAIT: `connectSurfaces` is async under Effect (the dial is an
 * effect — surface-app break 1), and every export below is derived from the
 * connection it returns. Awaiting it HERE, once, keeps every consumer's import
 * synchronous-looking: an importer of this module simply evaluates after the
 * wire exists, instead of each of the ~40 call sites learning that `padiMap`
 * might not be there yet. The dial itself does not block on the socket OPENING
 * (the link constructs the socket and retries in its own fiber), so this is a
 * microtask, not a network wait.
 *
 * The `preferences` accessor below collapses what used to be a hand-rolled
 * `usePreferences` module into a module-level subscription — every consumer reads
 * the same singleton without per-component lookups. The per-host `recentRepos` /
 * `recentAgents` / `savedSession` readouts moved to `./hostScope/activeWire` (W9),
 * where they WINDOW the active host's RETAINED wire subs (see the note near
 * `preferences` below); they are no longer defined in this module.
 */

import type { UnaryEffect } from "@kolu/surface/client";
import type { WatchableWire } from "@kolu/surface/link";
import type { WireDiagnostics } from "@kolu/surface/links/websocket";
import type { SurfaceClient, SurfaceFace } from "@kolu/surface/solid";
import { surfaceWsUrl } from "@kolu/surface-app";
import { connectSurfaces } from "@kolu/surface-app/solid";
import { connectSurfaceMap } from "@kolu/surface-map/client";
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
  type ViewerMode,
} from "kolu-common/surface";
import {
  type ConnectionInfo,
  type HostKey,
  LOCAL_HOST,
  type padiEntrySurface,
  koluNonSiblingGroups,
  padiHostMap,
} from "kolu-common/surfacesWithPadi";
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
} from "solid-js";
import { Effect } from "effect";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { groundActiveHost } from "./host/groundActive.ts";
import { hostReconcileTarget } from "./host/hostReconcile.ts";
import { hostLabel } from "./host/hostChipTone.ts";
import { persistedPref } from "./persistedPref.ts";
import { rootProcedures } from "./rpc/rootProcedures.ts";
import { runAction } from "./runAction.ts";
import { recordProbeSettled, recordWireRetired } from "./wireProbes.ts";

// The dial URL, derived once from the page's own origin — `surfaceWsUrl` owns
// both halves (the `https:` → `wss:` swap and the surface path), so no leg of
// kolu spells either by hand.
const wsBaseUrl = surfaceWsUrl(window.location.origin);

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
// reconnecting wire with the half-open watchdog wired in." kolu plugs into it
// like drishti does, instead of re-assembling `createSurfaceSocket` →
// `createLiveSignal` → `surfaceClients` by hand: it owns the wire + the `pid`
// echo (which threads the last-observed server `processId` back as a query param on
// every (re)connect, so a stale tab reconnecting to a RESTARTED server is recognized
// at the handshake), the always-on half-open watchdog (probing `system/live` at the
// first sibling's TAG on the very dispatch it reconnects — the probe channel is
// provably the reconnected channel), and the per-sibling clients. It derives the
// combined `RpcGroup` from `surfaces` itself, so no contract is passed.
//
// No `restartCloseCode` here — the stale-close vocabulary now lives in the LINK
// (surface-app hands it `isStaleProcessClose`), which stops its own retry schedule
// and reports the terminal `WireStatus` `"retired"`; there is no consumer action
// left to hand out, so `rpc.ts` no longer retires the socket by hand either. The
// watchdog lives HERE (one wire, one watchdog), which is why `rpc.ts`'s
// `createServerLifecycle` runs with `heartbeat: false`. `siblingKey` is auto-picked
// (`Object.keys(surfaces)[0]`) — every sibling answers `system/live`, so the choice
// is immaterial.
//
// kolu feeds the padi-LESS sibling set (`surfaces` = { kolu, surfaceApp }) — padi is no
// longer a single sibling but a keyed MAP of remote surfaces (`padiMap` below), dialled
// over a SCOPED slice of `conn.transport`. `kolu` stays the first sibling (the
// watchdog's `system/live` probe channel).
const conn = await connectSurfaces({
  surfaces,
  url: wsBaseUrl,
  // The two tag namespaces kolu multiplexes on this ONE wire but does NOT reach
  // through `clients.<key>`: the padi HOST MAP (dialled below via
  // `connectSurfaceMap(padiHostMap, conn.transport)`) and kolu's hand-written ROOT
  // procedures (reached via `rootProcedures(conn.transport.dispatch)`). Under Effect
  // RPC the flat client resolves a call's payload/success SCHEMAS by looking its tag
  // up in the group the wire was built over, so a tag absent from that group cannot
  // be dispatched at all — the wire would connect and then fail every `surface/padi/*`
  // and `hosts/*` call. This is the client twin of kolu-server's `servedGroup`
  // (`server/src/surface.ts`), assembled from the same two sources.
  //
  // Read from `koluNonSiblingGroups` rather than hand-listed here: the SAME two
  // values `koluWireGroup` merges for the serve and for `kolu-rpc`, so a third half
  // added there reaches this tab too. Hand-listed, it would not — and the tab is the
  // end that fails silently, since a tag absent from the dialled group cannot be
  // dispatched at all.
  //
  // No cast on either half. `RpcGroup` is INVARIANT in its element union, so the
  // hand-written, precisely-typed `koluRootGroup` is not assignable to an erased
  // `RpcGroup<Rpc.Any>` even though every element IS an `Rpc.Any` — but the seam
  // takes that erasure on itself (as `mergeDisjointGroups`, which it feeds, does),
  // so the precisely-typed half goes in as it is.
  extraGroups: Object.values(koluNonSiblingGroups),
  // The root app cells (koluSurface / surfaceApp) declare origin-FREE `toast` policies;
  // route them through the ONE interpreter (design §A/m4).
  onClientError: (p, e) => interpretClientError(p as ClientErrorPolicy, e),
  // TUNING only in the observability sense (kolu#2101 J2) — the cadence stays the
  // framework's. The watchdog's verdicts were reported to a `console.warn` and to
  // nothing else, so "the wire answered a probe 4s ago" — the fact that separates
  // a genuinely live wire from one merely reporting `open` — could not be copied
  // into a bug report. Recorded in a leaf module the diagnostic snapshot reads.
  heartbeat: { onProbeSettled: recordProbeSettled },
  // REQUIRED: what happens when the server retires this tab. kolu's user-facing
  // recovery already rides the same wire's terminal status — `rpc.ts`'s lifecycle
  // reads it as a definitive `restarted` and the transport overlay offers the
  // reload — so what this adds is the RECORD: a wall-clock stamp in the leaf
  // module the diagnostic snapshot reads, which is what a bug report needs and
  // what neither the overlay nor the console carried. There is deliberately no
  // second reload path here; two things reloading the page is worse than one.
  retired: recordWireRetired,
});
const { link } = conn;

// The `pid` echo is no longer wired from here (nor exported for `rpc.ts` to
// feed). `connectSurfaces` probes the framework-reserved `system/identity` on
// every open and feeds the echo its URL thunk appends, so the stale-tab handshake
// holds without any app step — which is what it takes for it to hold in EVERY app
// rather than in the apps that remembered (olai#61 is what forgetting looks like).

/** The watchable wire under every client here — status observability plus the
 *  imperative `forceReconnect()`. Handed to `rpc.ts`'s `createServerLifecycle`
 *  (which derives connecting/connected/restarted from its status stream). The
 *  raw socket is no longer reachable: the link owns the dial, the retry
 *  schedule and the terminal-close classifier (PLAN D5). */
export const wire: WatchableWire = link.wire;

/** What the LINK knows about its own dialing — the last 20 attempts with their
 *  timestamps, close codes and outcomes, plus the re-dial EPOCH (kolu#2101 J1).
 *
 *  Deliberately NOT part of {@link wire}: `WatchableWire` is hand-implemented by
 *  tests and consumers, and only a factory-built link can produce this. It is the
 *  one place the swallowed dial — `"ended-without-open"`, invisible to the client,
 *  to the console AND to the server's log, because the server never saw a
 *  connection — leaves a trace, which is why the diagnostic snapshot reads it. */
export const wireDiagnostics: WireDiagnostics = link.diagnostics;

// Expose for e2e tests: the reconnect regression test (#410) drives the wire
// directly. Same pattern as __xterm on the terminal container — harmless in
// production, just an attribute on window.
//
// It is `forceReconnect()`, not the old partysocket `close()`/`reconnect()`
// pair: under Effect the link owns its own retry schedule, so "close and stay
// closed until told otherwise" no longer exists as a transport state. The
// harness in `packages/tests/step_definitions/reconnect_steps.ts` drives THIS
// hook: it severs the live socket with `forceReconnect()` and PROVES the
// severance happened — an `onStatus` recorder armed before the call must catch
// the status leaving "open", so a drop that severed nothing fails the step
// instead of passing unconditionally — then waits for the link's own re-dial to
// bring the wire back to "open".
(window as Window & { __koluWire?: WatchableWire }).__koluWire = wire;

// kolu serves TWO sibling surfaces over one transport (kolu#1197) — plus the
// server-added `padi` sibling; `connectSurfaces` scopes each per-key client by
// splicing the sibling key into every TAG, so its primitives resolve at the wire
// tag `surface/<key>/<member>/<verb>` that `implementSurfaces` serves.
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
 *  `surfaceApp.cells.buildInfo.use({ authority: "server" })`) and, through its
 *  tag-scoped face, the FRAMEWORK-RESERVED `system/identity` restart probe
 *  (`probeSurfaceIdentity(surfaceApp.rpc)` — the `surfaceApp` key is consumed by
 *  the scope, so it does NOT reappear in the path). Handed to
 *  `<SurfaceAppProvider controlPlane=...>` + `createServerLifecycle`. */
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

/** kolu's ROOT (non-surface) procedures over the combined wire —
 *  `client.server.info(...)`, `client.daemon.restart(...)`,
 *  `client.hosts.add(...)`. The `terminal.*` / `git.*` roots were deleted at
 *  W1.R7; those mutations go through `activePadiRpc.*`.
 *
 *  Built over `conn.transport.dispatch` — the branded combined dispatch the
 *  watchdog also probes — so a root call and a surface call ride the one wire
 *  by construction. Sibling-surface members are reached through the bound faces
 *  (`app.cells.*`, `surfaceApp.*`), never through here: the flat dispatch has no
 *  nested `surface.<key>` shape to walk any more (D1/D2). */
export const client = rootProcedures(conn.transport.dispatch);

/** Read one unary verb off a surface's structural member FACE, failing LOUDLY if
 *  the surface does not carry it.
 *
 *  `SurfaceFace` is deliberately un-typed per member (D2: precision lives in the
 *  bound `.cells`/`.procedures` faces, and a second precise mapped type over the
 *  same spec is the union blowup D2 exists to avoid), so a consumer reaching a
 *  member through it narrows by hand. A missing member means the face was built from a
 *  different surface than the caller thinks: a framework/wiring bug, so it
 *  throws at wire-up rather than answering `undefined` at call time. */
function unaryMember<I, O>(
  face: SurfaceFace,
  member: string,
  verb: string,
): UnaryEffect<I, O, never> {
  const ref = face.surface[member]?.[verb];
  if (typeof ref !== "function") {
    throw new Error(
      `wire: this surface carries no \`${member}.${verb}\` member — the face was built from the wrong surface.`,
    );
  }
  return ref as UnaryEffect<I, O, never>;
}

/** Publish the browser's raw OS light/dark reading into kolu's server-wide
 *  `viewerMode` cell.
 *
 *  A bare WRITE, not a bound `app.cells.viewerMode.use(...)`: this browser only
 *  ever writes the reading (the server owns the `colorScheme` leg of the
 *  resolution), so a standing subscription on a cell nothing here reads would be
 *  pure wire cost. */
export const setViewerMode: UnaryEffect<ViewerMode, void, never> = unaryMember(
  app.rpc,
  "viewerMode",
  "set",
);

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
//   - the host-membership reconcile + `procedures` / `streams` (off `useEntry(activeHost)`,
//     point faces that re-key freely).
//
// `connection`, `procedures` and `streams` (all off `useEntry(activeHost)`) are deliberately
// ACTIVE-HOST-ONLY — cheap to re-open, and the keyed lens re-keys on switch (to narrate the
// newly-active host) AND on a same-key re-add (a new `membershipId`). A single `createRoot` at
// module init is their app-lifetime owner — never disposed.
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
      //
      // `unobservable` answers `undefined` for the strongest reason of the three: the arm
      // carries no `connection` field AT ALL, because our link to the publisher is dead and
      // a frozen `probing`/`provisioning` word would keep narrating work that stopped being
      // live. The floor used to express this by clearing a field on a `warming` value; the
      // arm expresses it by not having one.
      .with(
        { kind: "failed" },
        { kind: "unobservable" },
        { kind: "not-a-member" },
        () => undefined,
      )
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
 *  `padiMap.entry(activeHost()).procedures`.
 *
 *  `activePadiRpc.<ns>.<verb>(input)` hands back a lazy `Effect` carrying the
 *  member's declared error union plus the framework's `SurfaceCallFailure`. That
 *  is what lets the business logic in `terminal/`, `host/`, `kaval/`, `forwards/`
 *  and `right-panel/` be DESCRIBED rather than executed — a call can be caught by
 *  `_tag`, raced, bounded, superseded, and torn down by the interruption of the
 *  owner that launched it. Nothing runs until a UI edge runs it, and in this
 *  package that edge is `runAction` (`./runAction`), never a bare run here. */
export const activePadiRpc = hostScoped.procedures;

/** The same procedure face for a SPECIFIC host — the twin of
 *  {@link activePadiRpc} for the callers that already hold a `HostKey` and must
 *  not route to whichever host happens to be active (the per-host scope's
 *  active-tile report, which belongs to the host that owns the scope).
 *
 *  `padiMap.entry(k)` is the pure, owner-free point lens, so this is safe to call
 *  outside a reactive owner — exactly as `padiMap.entry(host).procedures` is. */
export function padiRpcOf(host: HostKey): PadiRpcFace {
  return padiMap.entry(host).procedures;
}

/** The declared padi procedures, as the framework's own narrow mapped type over
 *  the entry spec — the same one `Entry.procedures` is typed by, so a wrong verb
 *  is a compile error and the two faces cannot come to describe different
 *  members. Named only so {@link padiRpcOf}'s return reads as one thing. */
type PadiRpcFace = SurfaceClient<typeof padiEntrySurface.spec>["procedures"];

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
 *  `floorOnLiveness`, which moves the entry to the word-less `unobservable` arm when our link to
 *  the publisher is dead/half-open, so a frozen `probing`/`provisioning` phase stops asserting a
 *  live phase (#1568). No client-side re-floor: the word inherits the SAME liveness decision as
 *  the dot by construction, so the two can never disagree. */
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
 *  see the cell's `coalesceMs`.
 *
 *  Fire-and-forget, deliberately. A DECLARED procedure is now an `Effect` a
 *  caller composes (`activePadiRpc.<ns>.<verb>`), but a cell's `patch` is a
 *  framework PRIMITIVE rather than a declared member, and it is not a program
 *  anyone composes: nothing races it, nothing supersedes it, and its coalescing
 *  is the cell's own. So this stays a write plus a toast on failure — the report
 *  IS the whole error policy, and there is nothing here for interruption to
 *  reach. */
export function updatePreferences(
  patch: PreferencesPatch,
  opts?: { coalesce?: boolean },
): void {
  runAction(
    "save preferences",
    Effect.catch(hostScoped.preferences.patch(patch, opts), (err) =>
      Effect.sync(() =>
        toast.error(
          `Failed to save preferences: ${err instanceof Error ? err.message : String(err)}`,
        ),
      ),
    ),
  );
}
