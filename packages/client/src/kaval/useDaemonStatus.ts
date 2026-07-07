/**
 * The live status of this host's pty-host daemon (kaval), as the server's
 * supervisor endpoint reports it on the `daemonStatus` surface collection.
 *
 * A module-level singleton subscription (one local host, keyed `"local"`),
 * consumed by the ChromeBar's KAVAL rail column and App.tsx's DegradedCanvas
 * gate — so the UI can tell "the daemon is down" apart from "you have no
 * terminals" (B2, the empty-canvas-lie fix).
 *
 * The PURE presentation (tables + projections — `DAEMON_STATE_PRESENTATION`,
 * `kavalDot`, `serverDot`, `toneDot`, `formatUptime`, …) lives in the
 * side-effect-free `./daemonPresentation`, re-exported here so existing call
 * sites are unchanged. This module owns only the wire-coupled bits: the live
 * subscription and the accessors over it.
 */

import { type DaemonStatus, LOCAL_HOST_ID } from "@kolu/padi/surface";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { PadiLink } from "kolu-common/surface";
import { createEffect, createMemo, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { persistedPref } from "../persistedPref";
import { activeHost, app, padiMap } from "../wire";
import {
  channelLive,
  DAEMON_STATE_PRESENTATION,
  liveDownStateWithPadiLink,
  liveWarmingWithPadiLink,
  localPadiLinkOnly,
} from "./daemonPresentation";
import { announceReattach } from "./reattachAnnounce";

// Re-export the pure presentation so existing `from "./useDaemonStatus"` imports
// (the rail, the kaval dialog, App.tsx's canvas, useDaemonRestart) keep resolving
// here even though the tables physically moved to a wire-free module.
export {
  DAEMON_STATE_PRESENTATION,
  DAEMON_UNKNOWN_DOT,
  type DaemonTone,
  formatUptime,
  kavalDot,
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
 *  {@link kavalDot}): when the link is dead or silently half-open, the retained
 *  daemon state is STALE — the channel that would refresh it is gone — so the
 *  column must read "unknown", never a definite "running" + an uptime climbing off
 *  the local clock. A reactive accessor (a shared memo); read it inside a tracking
 *  scope. */
export function daemonTransportLive(): boolean {
  return sharedDaemonTransportLive()();
}

/** The active host entry's own connection — the THIRD leg of the daemonStatus delivery
 *  path (see {@link channelLive}). `daemonStatus` rides `useEntry(activeHost)`, so for a
 *  REMOTE host the server→remote ssh link is part of the channel that refreshes it, a leg
 *  neither the ws (`daemonTransportLive`) nor the LOCAL padiLink reflects. When the active
 *  entry is not `connected` (ssh flap/warming/failed) the re-served status is FROZEN stale.
 *  For LOCAL_HOST the entry is connected whenever the local padi is bound (harmless no-op).
 *  A reactive accessor; read it inside a tracking scope. */
function activeEntryConnected(): boolean {
  return padiMap.entry(activeHost()).state().kind === "connected";
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
// A host-scoped standing readout — rides `useEntry(activeHost)` under an app-scope
// `createRoot` (module-lifetime), so it re-keys when the active host switches.
const sub = createRoot(() =>
  padiMap.useEntry(activeHost).collections.daemonStatus.use({
    keys: () => [LOCAL_HOST_ID],
    onError: (err: Error) => toast.error(`Daemon status error: ${err.message}`),
  }),
);

/** The local daemon's status, or undefined before the first server yield. The daemon's
 *  `startedAt` is stamped on the ACTIVE host's padi (which serves `daemonStatus`), so it
 *  is reprojected onto THIS browser's clock at THIS ingestion boundary — the Kaval/Padi
 *  dialogs render `now − startedAt` uptime, and a raw remote epoch would mix two clocks
 *  (the foreign-clock fence, applied once here, not per-dialog). A null offset (host
 *  warming) ⇒ `startedAt` 0, which the dialogs already gate as "unknown". */
export function localDaemonStatus(): DaemonStatus | undefined {
  const status = sub.byKey(LOCAL_HOST_ID)?.();
  if (status === undefined || typeof status.startedAt !== "number")
    return status;
  const local = padiMap.entry(activeHost()).clock.toLocal(status.startedAt);
  return { ...status, startedAt: local ?? 0 };
}

// kolu-server's live view of its binding to the local padi, off koluSurface's server-
// authored `padiLink` cell. koluSurface is served DIRECTLY by kolu-server, so this value
// is never held STALE by the re-serve value-fold that freezes padi's OWN members
// (including the kaval `daemonStatus` above) while padi is unbound. The canvas folds
// this in as the SECOND liveness leg on the re-served daemonStatus, so a padi drop shows
// an honest connecting state instead of a frozen re-served status (#1034). Same singleton
// `app.cells.X.use(...)` pattern as `processMemory` (ui/useMemoryUsage.ts).
const padiLinkSub = app.cells.padiLink.use({
  onError: (err) => toast.error(`padi link status error: ${err.message}`),
});

/** kolu-server's live binding-to-padi state, or `undefined` before the first server
 *  yield (treated as not-`connected` — the honest "coming up" — by the canvas folds). A
 *  reactive accessor; read it inside a tracking scope. */
export function padiLinkState(): PadiLink | undefined {
  return padiLinkSub.value();
}

/** `padiLinkState` GATED to the LOCAL_HOST view. `padiLink` is kolu-server's binding to its
 *  OWN local padi — a host-INDEPENDENT fact — so folding it into the down/warming legs is only
 *  honest when the ACTIVE host IS local. For a REMOTE active host it returns the `"connected"`
 *  sentinel, a no-op in `liveDownStateWithPadiLink`/`liveWarmingWithPadiLink` (which act only
 *  when padiLink !== "connected"), so a LOCAL-padi blip — a spontaneous crash+reconnect, or a
 *  `daemon.restart` drain (`drainBoundPadi` → `renew`), both host-independent — can NEVER
 *  false-warm the canvas or mask a kaval death of the REMOTE host being viewed. For a remote
 *  host the decision falls through to the host-scoped kaval state + `activeEntryConnected`
 *  (daemonChannelLive), which cover a real remote drain via the remote host's OWN daemonStatus
 *  (recycleKaval publishes "restarting" while the remote padi stays up) + its EntryStatus. The
 *  #1034 local-restart-drain coverage for LOCAL_HOST is preserved unchanged (re-run #6). */
export function activePadiLink(): PadiLink | undefined {
  return localPadiLinkOnly(activeHost(), padiLinkState(), LOCAL_HOST);
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
  return sub.byKey(LOCAL_HOST_ID)?.pending() ?? true;
}

/** The single projection of "is the daemon down, and which kind" — `dead`
 *  (never came up) or `degraded` (died mid-session), or `undefined` when it's
 *  up (or still loading, so a brief load never flashes the degraded surface).
 *  Drives the DegradedCanvas gate AND its `state` prop, so the down-sub-union
 *  is named in one place rather than re-derived by an inline ternary. */
export function downState(): "dead" | "degraded" | undefined {
  // FLOORED on BOTH legs of the daemonStatus delivery path via
  // `liveDownStateWithPadiLink`: the browser↔kolu-server ws (`daemonTransportLive`) AND
  // kolu-server's binding to padi (`padiLinkState`). When EITHER is not live the retained
  // kaval state is stale, so "down" reads `undefined` ("unknown") rather than painting
  // DegradedCanvas off a value the dead channel — or the dropped padi binding — can't
  // confirm (the post-grace transport overlay owns the disconnect). Critically, this is
  // what lets the WARMING arm win the canvas precedence over a padi drop: without the
  // padi-link floor a stale re-served `degraded` would light DegradedCanvas (which beats
  // warming) instead of the honest "coming up" surface. The down-sub-union is whichever
  // states the presentation table marks `down` (today exactly `dead`/`degraded`).
  return liveDownStateWithPadiLink(
    activePadiLink(),
    localDaemonStatus()?.state,
    daemonChannelLive(),
  );
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
  // FLOORED on transport liveness via `liveWarmingWithPadiLink`: a "the daemon is coming
  // up" claim only holds over a live browser↔kolu-server link. When that link is
  // dead/half-open this reads false (not "warming"), so the canvas won't paint
  // "Restarting kaval…" and `refuseIfWarming` won't lock ⌘T with a misleading "Daemon is
  // starting" off a stale state — every consumer inherits the floor from this one source.
  //
  // ADDITIONALLY folds `padiLinkState()`: when kolu-server's binding to padi is not
  // `connected` (the re-targeted "restart kaval" DRAINS padi, so the binding drops for
  // the whole drain window) the re-served kaval daemonStatus is frozen — but the padi
  // link itself is honestly (re)connecting, so warming reads TRUE, covering the entire
  // drain window with the neutral coming-up surface instead of a frozen re-served status
  // (#1034).
  return liveWarmingWithPadiLink(
    activePadiLink(),
    localDaemonStatus()?.state,
    daemonChannelLive(),
  );
}

/** True ONLY when the local kaval daemon is genuinely CONNECTED — and the client
 *  is therefore the lifecycle authority over its terminals. The inverse of
 *  "warming, down, or not-yet-known": it folds transport + padi-link liveness in
 *  through {@link daemonWarming} / {@link downState} (both floored on them), so a
 *  half-open link or a dropped padi binding reads NOT-connected, and the
 *  pre-first-yield window ({@link daemonStatusPending}) reads NOT-connected too.
 *
 *  The list-driven reconcile (`useActiveReconcile`) gates its authoritative
 *  promote-on-departure writes on this: during a SUPERVISED transition (a
 *  `recycleKaval` restart holds `restarting`, published BEFORE the drain empties
 *  the terminal list) the departures are the server's doing and are undone by
 *  restore, so the client must NOT react to them with `chrome.setParent(...)`
 *  writes. Only a real user-close happens while this is true. */
export function daemonConnected(): boolean {
  return (
    !daemonStatusPending() && !daemonWarming() && downState() === undefined
  );
}

/** The warming-canvas message for the current daemon state — the verbier,
 *  capitalized `canvasLabel` projection the App.tsx warming arm renders (e.g.
 *  "Restarting kaval…" / "Connecting…"). Projects from the presentation table
 *  like every other consumer (so a new warming state's copy lands in one place),
 *  and defaults to the boot-`connecting` copy before the first status yield —
 *  the canvas only shows this while `daemonWarming()`, so the default is moot in
 *  practice but keeps the read total without a non-null assertion. */
export function warmingCanvasLabel(): string {
  const state = localDaemonStatus()?.state;
  return DAEMON_STATE_PRESENTATION[state ?? "connecting"].canvasLabel;
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
    const host = activeHost();
    announceReattach(
      localDaemonStatus(),
      reattachAnnouncedAt()[host] ?? 0,
      (mark) => setReattachAnnouncedAt((prev) => ({ ...prev, [host]: mark })),
      (count) =>
        toast.info(`${count} terminal${count === 1 ? "" : "s"} reattached`),
    );
  });
});
