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

import type { DaemonStatus } from "@kolu/padi/surface";
import { LOCAL_HOST } from "kolu-common/contract";
import type { PadiLink } from "kolu-common/surface";
import { createEffect, createMemo, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { useBindingScopedSub } from "../binding/bindings";
import { createSharedRoot } from "../createSharedRoot";
import { persistedPref } from "../persistedPref";
import { app } from "../wire";
import {
  connectionToPadiLink,
  DAEMON_STATE_PRESENTATION,
  liveDownStateWithPadiLink,
  liveWarmingWithPadiLink,
} from "./daemonPresentation";
import { announceReattach } from "./reattachAnnounce";

// Re-export the pure presentation so existing `from "./useDaemonStatus"` imports
// (the rail, the kaval dialog, App.tsx's canvas, useDaemonRestart) keep resolving
// here even though the tables physically moved to a wire-free module.
export {
  connectionToPadiLink,
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

// W4 "the switch": the daemon-status collection AND the per-host binding readiness
// re-key off the ACTIVE binding. `useBindingScopedSub` re-opens each sub against the
// new host on a switch and disposes the old one (no leak across the swap), so
// `localDaemonStatus()`/`padiLinkState()` follow the tab to whichever host it views.
// The `daemonStatus` collection rides padi (W1.R7); "the binding is (re)connecting"
// now rides the padi `connection` cell (the framework mirror cell, per host) — the
// replacement for the retired single-host `kolu.padiLink` cell, which could not carry
// N bound hosts. Each is an app-lifetime shared root (read as `sub()()`).
const daemonStatusSub = useBindingScopedSub((b) =>
  b.clients.padi.collections.daemonStatus.use({
    keys: () => [LOCAL_HOST],
    onError: (err) => toast.error(`Daemon status error: ${err.message}`),
  }),
);
const connectionSub = useBindingScopedSub((b) =>
  b.clients.padi.cells.connection.use({
    onError: (err) => toast.error(`padi link status error: ${err.message}`),
  }),
);

/** The active host's local daemon status, or undefined before the first server yield. */
export function localDaemonStatus(): DaemonStatus | undefined {
  return daemonStatusSub()().byKey(LOCAL_HOST)?.();
}

/** The active binding's live binding-to-padi state, or `undefined` before the first
 *  yield (treated as not-`connected` — the honest "coming up" — by the canvas folds).
 *  Sourced from the padi `connection` cell (the mirror the re-serve adds, per host), so
 *  a padi drop on THIS host shows an honest connecting/degraded state, never a frozen
 *  re-served kaval `daemonStatus` (#1034). A reactive accessor; read it inside a
 *  tracking scope. */
export function padiLinkState(): PadiLink | undefined {
  const state = connectionSub()().value()?.state;
  return state === undefined ? undefined : connectionToPadiLink(state);
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
  return daemonStatusSub()().byKey(LOCAL_HOST)?.pending() ?? true;
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
    padiLinkState(),
    localDaemonStatus()?.state,
    daemonTransportLive(),
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
    padiLinkState(),
    localDaemonStatus()?.state,
    daemonTransportLive(),
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
  const [reattachAnnouncedAt, setReattachAnnouncedAt] = persistedPref<number>({
    name: "kolu.kaval.reattachAnnouncedAt",
    fallback: 0,
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`non-numeric: ${raw}`);
      return n;
    },
    // Surface a corrupt mark rather than resetting it silently. Resetting to `0`
    // is benign — at worst the next adoption re-announces once — so a console
    // warning is the right level (no user-facing toast for a recoverable reset).
    onInvalid: (err, raw) =>
      console.warn(
        `[kaval] reattachAnnouncedAt corrupt (${raw}); resetting to 0:`,
        err,
      ),
  });
  createEffect(() => {
    // The glue (`announceReattach`) commits the proven adoptedAt as the new
    // high-water mark BEFORE toasting, so a re-run on the same snapshot is silent
    // — both halves are unit-tested in `reattachAnnounce.test.ts`.
    announceReattach(
      localDaemonStatus(),
      reattachAnnouncedAt(),
      setReattachAnnouncedAt,
      (count) =>
        toast.info(`${count} terminal${count === 1 ? "" : "s"} reattached`),
    );
  });
});
