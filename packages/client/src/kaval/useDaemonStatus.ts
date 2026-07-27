/**
 * The live status of this host's pty-host daemon (kaval), as the server's
 * supervisor endpoint reports it on the `daemonStatus` surface collection.
 *
 * The `daemonStatus` collection rides the active host's RETAINED per-host wire
 * owner (`activeScope().wire.daemonStatus`, W9 — opened once per host in
 * `hostScope/createHostWire`, held across switch-away); this module reads
 * through that window, keyed `"local"` for the active host's kaval. Consumed by
 * the ChromeBar's KAVAL rail column and App.tsx's DegradedCanvas gate — so the
 * UI can tell "the daemon is down" apart from "you have no terminals" (B2, the
 * empty-canvas-lie fix).
 *
 * The PURE presentation (tables + projections — `DAEMON_STATE_PRESENTATION`,
 * `kavalPresencePresentation`, `serverDot`, `toneDot`, `formatUptime`, …) lives in the
 * side-effect-free `./daemonPresentation`, re-exported here so existing call
 * sites are unchanged. This module owns only the wire-coupled bits: the
 * accessors/windows over that retained per-host subscription.
 */

import {
  type DaemonStatus,
  encodeHostLocation,
  LOCAL_LOCATION,
} from "@kolu/padi/surface";
import type { EntryState } from "@kolu/surface-map";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { PadiLink } from "kolu-common/surface";
import type {
  ConnectionInfo,
  EntryFailedCause,
  PadiEntryFailure,
} from "kolu-common/surfacesWithPadi";
import { createEffect, createMemo, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import type { LogLine } from "../ui/logTailChrome";
import { activeScope } from "../hostScope/hostScopes";
import { persistedPref } from "../persistedPref";
import { activeHost, app, padiMap } from "../wire";
import {
  channelLive,
  type DaemonDownState,
  type KavalPresence,
  liveDownState,
  liveWarming,
  toKavalPresence,
} from "./daemonPresentation";
import { announceReattach } from "./reattachAnnounce";

// Re-export the pure presentation so existing `from "./useDaemonStatus"` imports
// (the rail, the kaval dialog, App.tsx's canvas, useDaemonRestart) keep resolving
// here even though the tables physically moved to a wire-free module.
export {
  DAEMON_STATE_PRESENTATION,
  DAEMON_UNKNOWN_DOT,
  type DaemonDownState,
  type DaemonTone,
  formatUptime,
  liveDownState,
  liveWarming,
  serverDot,
} from "./daemonPresentation";

// ONE shared, app-lifetime memo of the liveness boolean. `app.health()` is a plain
// accessor (not a memo) that re-folds the WHOLE registry — walking every enrolled
// sub, allocating a fresh `SubHealth[]` — on each read, and reading `.live` tracks
// every sub's `pending()`/`error()`. The ~dozen status-paint sites that floor on
// this fact would otherwise each re-fold per render AND re-render on every enrolled
// subscription's churn (a terminal create re-subscribing, a gitStatus blip), not
// just on a real liveness flip. Folding once behind a `===`-diffed memo collapses
// both: consumers track only the boolean and re-paint only when `live` actually
// changes. The `createSharedRoot` idiom is the same app-lifetime singleton
// `getClockNow` / the stale-ticker use (solidjs.md "memos for multi-consumer
// derivations").
const sharedDaemonTransportLive = createSharedRoot(() =>
  createMemo(() => app.health().live),
);

/** The watchdog-backed liveness of the ws transport that delivers `daemonStatus`
 *  — `app.health().live` (kolu serves its own surface with no mirror/`liveWhen`
 *  cell, so this is exactly the half-open-aware socket liveness, default-on via
 *  `connectSurfaces`). The kaval rail floors its dot AND its uptime on THIS (see
 *  {@link kavalPresencePresentation}): when the link is dead or silently half-open, the retained
 *  daemon state is STALE — the channel that would refresh it is gone — so the
 *  column must read "unknown", never a definite "running" + an uptime climbing off
 *  the local clock. A reactive accessor (a shared memo); read it inside a tracking
 *  scope. */
export function daemonTransportLive(): boolean {
  return sharedDaemonTransportLive()();
}

/** The active host entry's own connection — the SECOND leg of the daemonStatus delivery
 *  path (see {@link channelLive}). `daemonStatus` rides the active host's RETAINED per-host
 *  entry (`activeScope().wire.daemonStatus`, W9), so for a
 *  REMOTE host the server→remote link is part of the channel that refreshes it, a leg the
 *  ws (`daemonTransportLive`) alone doesn't reflect. When the active entry is not
 *  `connected` (ssh flap/warming/failed) the re-served status is FROZEN stale. For
 *  LOCAL_HOST this is the SAME leg a `daemon.restart` drain drops out of `connected` (the
 *  local session is a `pool` member like any other) — there is no separate local leg any
 *  more (W4 daemon-rail unification). A reactive accessor; read it inside a tracking
 *  scope. */
function activeEntryConnected(): boolean {
  return padiMap.entry(activeHost()).state().kind === "connected";
}

/** The padi map's entry-state type — the discriminated `(connected | warming | failed |
 *  not-a-member)` value `padiMap.entry(host).state()` returns. The CANONICAL spelling: the
 *  `Conn` parameter is pinned to {@link ConnectionInfo} (`padiHostMap`'s
 *  `connection: ConnectionInfoSchema`, what `.state()` actually carries — not the `unknown`
 *  default), and daemonScan.ts / HostDaemonChips.tsx import THIS rather than re-spelling
 *  `EntryState<PadiEntryFailure>` inline. Lives here beside {@link activeEntryState}, the
 *  reader that already owns the padi map's typing. */
export type PadiEntry = EntryState<PadiEntryFailure, ConnectionInfo>;

/** The ACTIVE host entry's FULL connection state — the typed discriminant
 *  (`warming`/`connected`/`failed`/`not-a-member`) plus, on `failed`, the typed
 *  {@link PadiEntryFailure} value. `canvasModeResolver` keys its facts on this
 *  ONE read: the `failed` arm drives the host-down card's cause-typed copy, while a
 *  REMOTE host merely still `warming` (source evaluation + remote-store build, which projects to the `warming`
 *  entry status, see `@kolu/surface-map`'s `server.ts`) accrues against the generous remote
 *  boot-deadline cell — never the LOCAL 30s ceiling (see `bootDeadline.ts`'s ceiling table).
 *  A reactive accessor; read it inside a tracking scope. */
export function activeEntryState(): PadiEntry {
  return padiMap.entry(activeHost()).state();
}

/** THE failed episode, as ONE value — every surface that shows a host's failure reads it
 *  through here, so they cannot disagree about what "no evidence" means.
 *
 *  `cause`, `reason` and the retained output tail are three fields of ONE `EntryStatus`
 *  (`padiMap.entry(host).state()`), so they are unpacked together, under one guard, by one
 *  reader — never two accessors with two policies over the same value, which is exactly how
 *  the tail came to be dropped unread while the reason was shown (`HostDownCanvas.tsx`'s
 *  header tells that story). The two consumers today are the host-down card (App.tsx's `host-failed` arm) and the
 *  host-diagnostics popover (the only failure surface reachable for a host WITHOUT switching
 *  to it).
 *
 *  `log` is NON-OPTIONAL because it reads `entry.evidence` — a field of the failure record
 *  rather than the live `connection` payload, so "we cannot see the output" is not a state
 *  this arm can be in, and `[]` keeps its one meaning (the failure genuinely produced no
 *  output). See `@kolu/surface-map`'s `FailureEvidence` for why the tail lives there.
 *
 *  Takes the entry rather than reading the active one, because the popover asks about a host
 *  that is NOT the active one. `undefined` when the entry is in any other state — the caller
 *  decides whether that is a normal absence (the popover) or unrepresentable (the card's
 *  arm, which throws). The session carries the tail FORWARD into its `failed` arm (see
 *  `surface-remote/session.ts`'s `setDown`), so these are the lines of the episode that
 *  actually gave up. */
export function failedEpisode(entry: PadiEntry):
  | {
      cause: EntryFailedCause;
      reason: string;
      log: readonly LogLine[];
    }
  | undefined {
  if (entry.kind !== "failed") return undefined;
  return {
    cause: entry.failure.cause,
    reason: entry.failure.reason,
    log: entry.evidence,
  };
}

/** True while the ACTIVE host is the unremovable LOCAL default — it selects the boot
 *  deadline's ceiling CLASS (local = 30s, mirroring the LOCAL session's own connect watchdog;
 *  a remote accrues against the generous provisioning/handshake cells instead, since a fresh
 *  remote padi legitimately takes longer than 30s — ssh provisioning) and routes
 *  the daemon-leg escape (a hung LOCAL kaval → the byte-identical down/dead card). A reactive
 *  accessor; read it inside a tracking scope. */
export function isActiveHostLocal(): boolean {
  return activeHost().kind === "local";
}

/** The full liveness of the channel delivering THIS host's `daemonStatus`:
 *  {@link daemonTransportLive} AND {@link activeEntryConnected}. Every kaval-rail consumer
 *  that paints the ACTIVE host's daemon state — the dot, the running label, the uptime, and
 *  `downState`/`daemonWarming`/`daemonConnected` — floors on THIS (not the ws leg alone), so
 *  a dead remote host reads "unknown"/not-connected, never a green "running" over a frozen
 *  re-served status. A reactive accessor; read it inside a tracking scope. */
export function daemonChannelLive(): boolean {
  return channelLive(daemonTransportLive(), activeEntryConnected());
}

// The daemon-liveness collection rides padi now (W1.R7 — padi supervises its
// kaval, so it serves `daemonStatus`; it left koluSurface). Transport liveness
// (`daemonTransportLive`, `app.health().live`) is unchanged: padi and kolu are
// siblings over the ONE socket, so the ws that delivers this is the same one
// `app.health()` watches.
//
// The `daemonStatus` collection now RIDES the active host's RETAINED per-host owner
// (`activeScope().wire.daemonStatus`, W9) — opened once per host in `createHostWire` and
// held across switch-away — instead of a `useEntry(activeHost)` re-key under an app-scope
// `createRoot` here, which reopened it from PENDING on every switch. That pending window
// was a direct cause of the ~1s switch-back rebuild: `daemonStatusPending()` flipped true,
// so `resolveCanvasMode` left `workspace` and `App.tsx`'s `<Switch>` unmounted the canvas
// arm. Retained, a switch-BACK reads the held status with `pending()` already false, so the
// canvas never leaves `workspace`. This accessor is the WINDOW onto whichever host is
// active — the active host's LOCAL kaval status cell, `undefined` (⇒ pending) before its
// first frame OR during the removal race (no active host to read this tick).
const localDaemonEntry = () =>
  activeScope()?.wire.daemonStatus.byKey(encodeHostLocation(LOCAL_LOCATION));

/** Reproject a `DaemonStatus`'s `startedAt` from the serving host's clock onto THIS
 *  browser's clock (via `padiMap.entry(host).clock.toLocal`) — the foreign-clock fence
 *  applied once at ingestion so uptime (`now − startedAt`) never mixes two clocks. A
 *  non-numeric `startedAt` (or an absent status) passes through untouched; a null offset
 *  (host warming) collapses to `0`, which the dialogs already gate as "unknown". The ONE
 *  reprojection body shared by both `localDaemonStatus` here and `HostDaemonChips`'s
 *  per-host `daemon` memo — memoization stays at each call site (each reads its own
 *  `host` during memo eval, so reactivity is preserved). */
export function reprojectDaemonStatus(
  host: HostKey,
  status: DaemonStatus | undefined,
): DaemonStatus | undefined {
  if (status === undefined || typeof status.startedAt !== "number")
    return status;
  const local = padiMap.entry(host).clock.toLocal(status.startedAt);
  return { ...status, startedAt: local ?? 0 };
}

/** The local daemon's status, or undefined before the first server yield. The daemon's
 *  `startedAt` is stamped on the ACTIVE host's padi (which serves `daemonStatus`), so it
 *  is reprojected onto THIS browser's clock at THIS ingestion boundary — the Kaval/Padi
 *  dialogs render `now − startedAt` uptime, and a raw remote epoch would mix two clocks
 *  (the foreign-clock fence, applied once here, not per-dialog). A null offset (host
 *  warming) ⇒ `startedAt` 0, which the dialogs already gate as "unknown".
 *
 *  Memoized — ONE reprojection per `daemonStatus` (or clock) change shared by every
 *  consumer, rather than a fresh `{...status}` spread minted on each of the several
 *  reads a dialog does per render. Shares ONE {@link reprojectDaemonStatus} body with
 *  `HostDaemonChips`'s per-host `daemon` memo, so the repo has a single reprojection
 *  concept rather than two identical bodies kept in sync by hand. A memo is already a
 *  callable accessor, so this IS `localDaemonStatus` — no pass-through wrapper. Module-
 *  lifetime root like `sharedDaemonTransportLive` above. */
export const localDaemonStatus = createRoot(() =>
  createMemo((): DaemonStatus | undefined =>
    reprojectDaemonStatus(activeHost(), localDaemonEntry()?.()),
  ),
);

// kolu-server's live view of its binding to the local padi, off koluSurface's server-
// authored `padiLink` cell. koluSurface is served DIRECTLY by kolu-server, so this value
// is never held STALE by the re-serve value-fold that freezes padi's OWN members
// (including the kaval `daemonStatus` above) while padi is unbound. DISPLAY-ONLY (the
// Identity Rail's Padi chip) — the down/warming canvas fold no longer folds this in; it
// floors uniformly on `daemonChannelLive` instead (W4 daemon-rail unification). Same
// singleton `app.cells.X.use(...)` pattern as `processMemory` (ui/useMemoryUsage.ts).
//
// HOST-SCOPING: this describes kolu-server's binding to the LEGACY single-bind
// `padiSession` — hardcoded to the unremovable LOCAL default under always-map
// (`boundHost: null`, `server/src/index.ts`) — so it is HOST-INDEPENDENT-TODAY, not by
// design: there is no per-host "padi link" wire member for a `padiMap` entry yet (a
// padi/server-side gap, out of this fix's file scope). See the classification table in
// `PadiInfoDialog.tsx`.
//
// THE LIVE-SUBSCRIPTION FIX: a bare module-const `.use()` is the base client's
// `createKeyedSubscriptionCache` "ownerless" path — it acquires-then-releases the shared
// slot in the SAME tick (no ambient Solid owner to hold a listener), so the underlying
// subscription tears down a microtask later, before the first real (network) value can
// land. Every reader then sees a permanently-`undefined` value FOREVER — the exact "padi
// status unknown" symptom (`PadiInfoDialog`'s status pill derives from the presence fold
// off this `padiLink`, so a never-arriving link leaves it permanently "unknown"). Wrapped
// in an app-lifetime `createRoot` (the `sub`/hostInventory idiom
// above) so the subscription survives for the session.
const padiLinkSub = createRoot(() => app.cells.padiLink.use());

/** kolu-server's live binding-to-padi state, or `undefined` before the first server
 *  yield. DISPLAY-ONLY now (the Identity Rail's Padi chip, `padiPresentation.ts`'s
 *  `padiPresencePresentation`/`PADI_LINK_PRESENTATION`): kolu-server's OWN binding to its local padi is a
 *  host-independent fact the rail always shows, regardless of which host tab is active.
 *  It no longer feeds the down/warming canvas fold — that fold floors UNIFORMLY on
 *  {@link daemonChannelLive} for every host, local included (W4 daemon-rail unification;
 *  see `downState`/`daemonWarming`). A reactive accessor; read it inside a tracking
 *  scope. */
export function padiLinkState(): PadiLink | undefined {
  return padiLinkSub.value();
}

/** True until the daemon-status stream has produced its FIRST value — i.e. the
 *  status is genuinely unknown, not "up". The canvas gates on this so a `dead`
 *  boot never flashes the normal empty workspace before the first status lands
 *  (#1034): if `downState()` (undefined while pending) drove the gate alone and
 *  the session cell resolved to zero terminals first, the empty-state would paint
 *  and then snap to DegradedCanvas. `pending` is undefined before `byKey` has a
 *  subscription, which is itself the pre-first-value state, so treat that as
 *  pending too. */
export function daemonStatusPending(): boolean {
  return localDaemonEntry()?.pending() ?? true;
}

// The "stop waiting, tell the truth" canvas ceiling that used to live here
// (`daemonStatusPendingTimedOut` + `LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS`, anchored on
// `createHostWire`'s `daemonPendingAnchorMs`) is GONE (#1763). It could fire only for the
// DAEMON leg and only while `activeScope()` was defined — so a hung membership or session leg
// span the connect overlay forever. The single, outcome-based, per-host boot deadline that
// replaces it lives in `bootDeadline.ts` (with the ceiling table + the exported
// `LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS`), driven by `useCanvasMode`.

/** The ACTIVE host's kaval presence — the ONE named fold of `localDaemonStatus()` +
 *  `daemonChannelLive()` into the client's honest {@link KavalPresence} sum, read by the
 *  command palette's Restart-kaval gate. It is a sibling of `downState`/`daemonWarming`/
 *  `daemonConnected`, which already fold the same `(status, channel-live)` pair for the
 *  active host, and a module-lifetime memo like `localDaemonStatus` / `sharedDaemonTransportLive`
 *  so the fold happens once and stays reactive.
 *
 *  NOTE the KavalInfoDialog does NOT read this — it is PER-HOST (its `presence` prop is folded
 *  at the `HostDaemonChips` call site as `toKavalPresence(kaval.daemon(), kaval.live())` for the
 *  clicked host, which the opener switches the canvas to). What the palette and the dialog SHARE
 *  is the {@link offerRestartVerb} fold — the affordance is a total function of whichever
 *  presence each surface holds — not one memoized value; for the active host the two presences
 *  coincide (same fold, same inputs), so the Restart verb can't disagree between them.
 *  A reactive accessor; read it inside a tracking scope. */
export const activeKavalPresence = createRoot(() =>
  createMemo(
    (): KavalPresence =>
      toKavalPresence(localDaemonStatus(), daemonChannelLive()),
  ),
);

/** The single projection of "is the daemon down, and which kind" — `dead`
 *  (never came up), `degraded` (died mid-session), or `incompatible` (a PROVEN
 *  contract skew, carrying both versions — SK4), or `undefined` when it's up
 *  (or still loading, so a brief load never flashes the degraded surface).
 *  Drives the DegradedCanvas gate AND its `down` prop, so the down-sub-union
 *  is named in one place rather than re-derived by an inline ternary. */
export function downState(): DaemonDownState | undefined {
  // FLOORED on `daemonChannelLive` — the ws transport AND the ACTIVE entry's own
  // connection, for WHICHEVER host is active (local or remote, no special case: a local
  // `daemon.restart` drain drops the LOCAL_HOST entry out of `connected` exactly as a
  // remote ssh flap drops a guest's, W4 daemon-rail unification). When the channel is
  // not live the retained kaval state is stale, so "down" reads `undefined` ("unknown")
  // rather than painting DegradedCanvas off a value the dead channel can't confirm (the
  // post-grace transport overlay owns the disconnect). Critically, this is what lets the
  // WARMING arm win the canvas precedence over a drop: without this floor a stale
  // re-served `degraded` would light DegradedCanvas (which beats warming) instead of the
  // honest "coming up" surface. The down-sub-union is whichever states the presentation
  // table marks `down` (today `dead`/`degraded`/`incompatible` — the last carrying
  // its typed version pair through to the skew card).
  return liveDownState(localDaemonStatus(), daemonChannelLive());
}

/** True while the local daemon is transiently coming up (its state warming, via
 *  `liveWarming` — floored on transport liveness). Before the first status yield the
 *  state is unknown (not warming); `daemonStatusPending()` owns that pre-first-value
 *  gate.
 *
 *  Two consumers share this gate, covering both the visible and the invisible
 *  create paths: the App.tsx canvas reads it to suppress the empty-state welcome
 *  (its enabled Restore / new-terminal affordances) while warming — a restart's
 *  `drain` empties the terminal list, which would otherwise paint EmptyState
 *  while `restarting`; and `useTerminalCrud.handleCreate` reads it to refuse the
 *  keyboard (`Cmd+T`) and command-palette create paths, which stay live over the
 *  neutral warming surface the canvas shows. Without the crud guard a `Cmd+T`
 *  would call `client.terminal.create` against the daemon the recycle is about to
 *  kill (or a momentarily-`current` old connection). Terminal creation must wait
 *  for `connected`. */
export function daemonWarming(): boolean {
  // FLOORED on `daemonChannelLive` — exactly `restartInFlight`'s own
  // `liveWarming(state, daemonChannelLive())` arm (`useDaemonRestart.ts`), and exactly
  // `downState`'s floor above: a "the daemon is coming up" claim only holds over a live
  // channel to the ACTIVE host's daemon (ws transport AND that host's own entry
  // connection). When the channel is dead/half-open — including the whole window of a
  // LOCAL `daemon.restart` drain, which drops the LOCAL_HOST entry out of `connected`
  // exactly as a remote ssh flap drops a guest's (W4 daemon-rail unification; no more
  // host-gated padi-link leg) — this reads false (not "warming"), so the canvas won't
  // paint "Restarting kaval…" over a stale state and `refuseIfWarming` won't lock ⌘T
  // off one either; every consumer inherits the floor from this one source.
  return liveWarming(localDaemonStatus()?.state, daemonChannelLive());
}

/** True ONLY when the local kaval daemon is genuinely CONNECTED — and the client
 *  is therefore the lifecycle authority over its terminals. The inverse of
 *  "warming, down, or not-yet-known": it folds channel liveness in through
 *  {@link daemonWarming} / {@link downState} (both floored on {@link daemonChannelLive}),
 *  so a half-open link or a dropped daemon binding reads NOT-connected, and the
 *  pre-first-yield window ({@link daemonStatusPending}) reads NOT-connected too.
 *
 *  The list-driven reconcile (`useActiveReconcile`) gates its authoritative
 *  promote-on-departure writes on this: during a SUPERVISED transition (a
 *  `recycleKaval` restart holds `restarting`, published BEFORE the drain empties
 *  the terminal list) the departures are the server's doing and are undone by
 *  restore, so the client must NOT react to them with `chrome.setParent(...)`
 *  writes. Only a real user-close happens while this is true. */
export function daemonConnected(): boolean {
  // A POSITIVE, total authority gate (#1793 affordance/authority axis): connected iff the
  // channel is LIVE and the daemon's own state is `connected`. The old negative-space form
  // (`!pending && !warming && downState()===undefined`) had the exact bug this PR removed
  // from `offerRestartVerb`: over a DEAD channel `daemonWarming()` and `downState()` are both
  // liveness-floored to false/undefined, so the conjunction returned `true` — asserting the
  // client is lifecycle authority (`useActiveReconcile` may then issue reconcile writes) over
  // a channel it can't reach. Flooring on `daemonChannelLive()` closes it by construction; a
  // pre-identity `connected` still counts (authority doesn't need identity, only liveness +
  // a connected state).
  return daemonChannelLive() && localDaemonStatus()?.state === "connected";
}

/** Whether the ACTIVE host's terminal LIST can be trusted as a COMPLETE census —
 *  its membership has reconciled, not merely "a first frame arrived". The one
 *  named fact two consumers gate on: `useDeepLinks`'s gone-verdict (a terminal
 *  absent from a non-authoritative list is NOT-YET, never "gone" — #1900) and
 *  `useActiveReconcile`'s promote-on-departure eviction (a departure seen while
 *  the list isn't authoritative is the server's doing, not a user close).
 *
 *  Today it IS `daemonConnected()`, but the NAME states the meaning and this
 *  docstring — not the callers — carries the ordering argument, so the honest
 *  scope of the fact lives in one place:
 *
 *  - The daemon reports `connected` BEFORE boot adoption/reconcile runs
 *    (`ptyHost/index.ts` maps the converge outcome to `adopted` only after the
 *    endpoint is up; `reattach.ts` — "By the time adoption runs the endpoint has
 *    already reported connected"; `daemonStatus.ts` folds the adopted count on
 *    AFTER connect). So `connected` alone does NOT prove the list reconciled.
 *  - What makes it authoritative on the MAIN paths anyway: at BOOT, padi's serve
 *    socket starts listening only after `bootLocalEndpoint` (which adopts)
 *    completes (`daemonMain.ts`), so a browser never observes a pre-adoption
 *    `connected`; and on a SUPERVISED restart, `holdRestarting` masks
 *    capture→reattach as one `restarting` (`surface-daemon-supervisor/restart.ts`),
 *    so the client sees `connected` only once reattach finished.
 *  - RESIDUAL (not covered here — needs a padi-side registry-reconciled marker,
 *    tracked as follow-up #1902): a kaval that HUNG at a padi restart so `converge`
 *    threw (its catch only logs — `ptyHost/index.ts`), then recovered, flips
 *    `connected` before the 2s inventory-reconcile loop re-adopts; and
 *    out-of-band (`kaval-tui`-created) terminals appear the same way. In those
 *    windows this fact reads `true` over a still-stale list, so an absent id reads
 *    authoritative-but-gone and the deep-link gone-verdict fires IMMEDIATELY — a
 *    false gone the 8s backstop does NOT catch (the backstop bounds only the OTHER
 *    case, where this fact stays `false` and the route waits). #1900's primary
 *    boot-gate fix already removes the dominant trigger; closing this last window
 *    honestly needs the #1902 marker.
 *
 *  A reactive accessor; read it inside a tracking scope. */
export function listIsAuthoritative(): boolean {
  return daemonConnected();
}

/** The single warming-refusal gate for terminal creation: if the daemon is
 *  warming, toast the one shared message and report `true` (refused). Both
 *  create paths in `useTerminalCrud` call this so the predicate AND the copy
 *  live once; each caller keeps only its own throw-vs-return decision on the
 *  boolean. */
export function refuseIfWarming(): boolean {
  if (daemonWarming()) {
    toast.warning("Daemon is starting — try again in a moment");
    return true;
  }
  return false;
}

// B3.3: a one-shot "N terminals reattached" confirmation when the boot ADOPTED a
// surviving daemon (a redeploy that didn't change kaval's source — the daemon and
// its PTYs outlived the server restart). Adoption is otherwise invisible: the
// terminals are simply still there, no restore card. The server folds the count +
// a per-adoption timestamp onto the first `connected` daemon status
// (`DaemonStatusSchema.adopted`/`adoptedAt`, kolu's soul); this watches for it and
// toasts once PER ADOPTION.
//
// Dedupe is keyed on `adoptedAt`, PERSISTED to localStorage — not an in-memory
// boolean. The `adopted`/`adoptedAt` snapshot is sticky server-side and replayed
// verbatim to every fresh subscription, so a reconnect after a page reload
// (mobile-Safari evicts a backgrounded tab and reloads on return; a desktop hard
// refresh does the same) re-delivered the SAME adoption. The old module boolean
// reset with the JS context and re-fired the toast on every reload
// (juspay/kolu#1365); the persisted high-water mark survives the reload, so a
// replay of the same `adoptedAt` is silent while a genuinely newer adoption
// announces again. The pure `reattachToAnnounce` owns the truth table
// (unit-tested). The detached `createRoot` owns the effect + persisted signal for
// the app's life (like the module `sub` above), so a consumer's teardown can't
// freeze it.
createRoot(() => {
  // The greatest `adoptedAt` already announced; `0` until the first adoption (every
  // real adoptedAt is an ms epoch, so it clears the fallback). `localDaemonStatus()`
  // re-emits on every transition (the rail ticks uptime, restarting→connected), so
  // the persisted guard — not a one-shot latch — keeps it idempotent.
  const [reattachAnnouncedAt, setReattachAnnouncedAt] = persistedPref<
    Record<string, number>
  >({
    name: "kolu.kaval.reattachAnnouncedAt",
    // A PER-HOST record `{[host]: high-water mark}`, NOT one shared scalar: `adoptedAt` is a raw
    // foreign epoch on the ACTIVE host's OWN clock (deliberately unreprojected — a monotonic
    // dedup key, never compared to the browser), and per-host clocks are not mutually monotonic,
    // so one scalar mark across hosts would let a remote AHEAD-clock toast suppress a genuine
    // later LOCAL re-adoption on switch-back (re-run #6 — the foreign-clock class, storage
    // edition). One localStorage key; the value is host-keyed. Serializes as JSON by default.
    fallback: {},
    parse: (raw) => {
      const v: unknown = JSON.parse(raw);
      if (v === null || typeof v !== "object" || Array.isArray(v))
        throw new Error(`not a per-host record: ${raw}`);
      for (const n of Object.values(v as Record<string, unknown>))
        if (typeof n !== "number" || !Number.isFinite(n))
          throw new Error(`non-numeric mark in ${raw}`);
      return v as Record<string, number>;
    },
    // Surface a corrupt mark rather than resetting it silently. Resetting to `{}` is benign — at
    // worst each host's next adoption re-announces once — so a console warning is the right
    // level (no user-facing toast for a recoverable reset).
    onInvalid: (err, raw) =>
      console.warn(
        `[kaval] reattachAnnouncedAt corrupt (${raw}); resetting to {}:`,
        err,
      ),
  });
  createEffect(() => {
    // The glue (`announceReattach`) commits the proven adoptedAt as the new high-water mark
    // BEFORE toasting, so a re-run on the same snapshot is silent — both halves are unit-tested
    // in `reattachAnnounce.test.ts`. Scoped to the ACTIVE host's OWN mark (per-host clocks are
    // per-host facts — see the record above), captured once per run so the read and the commit
    // target the same host across a mid-effect switch.
    // The record is keyed by the host's CANONICAL string (`encodeHostKey`) — a `HostKey`
    // object can't itself be a `Record` key.
    const host = encodeHostKey(activeHost());
    announceReattach(
      localDaemonStatus(),
      reattachAnnouncedAt()[host] ?? 0,
      (mark) => setReattachAnnouncedAt((prev) => ({ ...prev, [host]: mark })),
      (count) =>
        toast.info(`${count} terminal${count === 1 ? "" : "s"} reattached`),
    );
  });
});
