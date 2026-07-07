/** Pure, side-effect-free presentation for the kaval daemon + ws transport — the
 *  tables and projections the rail, the dialog, and the canvas all read.
 *
 *  Deliberately imports NOTHING with a module-load side effect (no `../wire`, which
 *  opens the PartySocket; no `createRoot`): only types and the pure `compactDelta`
 *  ladder. `useDaemonStatus.ts` (the wire-coupled subscription + accessors)
 *  re-exports every symbol here, so existing importers are unchanged — but the
 *  presentation is now testable on its own, which is what lets `kavalDot`'s
 *  transport-liveness floor be pinned by a unit test without standing up a socket. */

import type { DaemonState } from "@kolu/padi/surface";
import type { WsStatus } from "../rpc/rpc";
import { compactDelta } from "../time/duration";

/** A daemon state's coarse tone — the warming-up/up/down bucket every display
 *  site shares. `restarting` and `connecting` are both `warming` (transient,
 *  coming up), declared once here rather than re-collapsed at each dot map. */
export type DaemonTone = "ok" | "warming" | "down";

/** The single source of truth for "what does daemon state X mean visually."
 *  One row per state, keyed by `DaemonState`, so a new state is a compile-forced
 *  row instead of N independent edits across the dialog, rail, and gate. Every
 *  presentation a consumer needs is derived from this table: the dot class from
 *  `tone` (via {@link toneDot}), the dialog/rail label from `label`, the App.tsx
 *  warming-canvas message from `canvasLabel`, and the DegradedCanvas narrowing
 *  from `down`. The table is client-only — the tones, labels, and Tailwind
 *  classes are projections of the state, not part of the wire
 *  `DaemonStatusSchema`. */
export const DAEMON_STATE_PRESENTATION: Record<
  DaemonState,
  { tone: DaemonTone; label: string; canvasLabel: string; down: boolean }
> = {
  connecting: {
    tone: "warming",
    label: "starting…",
    canvasLabel: "Connecting…",
    down: false,
  },
  connected: {
    tone: "ok",
    label: "running",
    canvasLabel: "Connected",
    down: false,
  },
  restarting: {
    tone: "warming",
    label: "restarting…",
    canvasLabel: "Restarting kaval…",
    down: false,
  },
  degraded: {
    tone: "down",
    label: "stopped (session preserved)",
    canvasLabel: "Stopped",
    down: true,
  },
  dead: {
    tone: "down",
    label: "not running",
    canvasLabel: "Not running",
    down: true,
  },
};

/** A tone → status-dot class. The one place `warming`==`animate-pulse` etc. is
 *  spelled, so the dot is derived from {@link DAEMON_STATE_PRESENTATION}'s tone
 *  rather than re-tabulated per display. */
export const toneDot: Record<DaemonTone, string> = {
  ok: "bg-ok",
  warming: "bg-warning animate-pulse",
  down: "bg-danger",
};

/** The grey "we don't know" tone — used before the first daemon-status yield AND
 *  whenever the transport delivering that status is not live (see {@link kavalDot}).
 *  Distinct from `down` (`bg-danger`, "the daemon is dead"): grey means "unknown",
 *  not "dead", so a dead link never masquerades as a definite verdict. */
export const DAEMON_UNKNOWN_DOT = "bg-fg-3/50";

/** The `kaval` status dot's tone class, FLOORED on transport liveness — the
 *  client-side sibling of `<HostStatusPip>`'s green-floored-on-`health().live`.
 *
 *  `live` is the watchdog-backed liveness of the ws that delivers `daemonStatus`.
 *  When it is `false` (transport down, or silently half-open) the retained daemon
 *  state is STALE — the channel that would refresh it is dead — so the dot reads the
 *  grey "unknown" tone, NEVER a definite `bg-ok` "running" painted off a value the
 *  dead channel can no longer confirm (the #1568 green-dot class, relocated to the
 *  rail). A known state can only REFINE the tone WITHIN a live link; it can never
 *  claim a verdict over a dead one. Mirrors the pre-first-yield grey: unknown is
 *  unknown whether the cause is "no frame yet" or "the link died". */
export function kavalDot(
  state: DaemonState | undefined,
  live: boolean,
): string {
  if (!live || !state) return DAEMON_UNKNOWN_DOT;
  return toneDot[DAEMON_STATE_PRESENTATION[state].tone];
}

/** Compact human uptime from a millisecond delta — `45s`, `12m`, `3h 20m`,
 *  `2d 4h`. The one uptime projection for the one daemon: the rail (passing
 *  `clockNow() - startedAt`) and the kaval dialog (`Date.now() - startedAt`)
 *  both call this, so a format tweak reaches both surfaces at once. Renders the
 *  dual-unit form of the shared {@link compactDelta} ladder (the sub-tier where
 *  one exists), so the sec/min/hr/day thresholds stay defined in one place. */
export function formatUptime(ms: number): string {
  const { value, unit, sub } = compactDelta(ms);
  return sub ? `${value}${unit} ${sub.value}${sub.unit}` : `${value}${unit}`;
}

/** A WebSocket transport status → its coarse tone — `connecting` is transient
 *  (warming, pulses), `open` is healthy, `closed` is down. The one place the
 *  WS-status→tone mapping lives. MODULE-PRIVATE: it feeds only the (also private)
 *  {@link wsDot}; the `srv`/mobile dots paint through {@link serverDot}, so the
 *  unfloored lifecycle-only tone has no external spelling. */
const wsTone: Record<WsStatus, DaemonTone> = {
  connecting: "warming",
  open: "ok",
  closed: "down",
};

/** A WebSocket status → its status-dot class, via {@link wsTone} + {@link toneDot}.
 *  MODULE-PRIVATE: it is half-open-BLIND (open→green with no liveness input), so the
 *  ONLY public connection-dot path is {@link serverDot}, which floors its green on
 *  the watchdog fact. Un-exported so the unfloored open→green can't be re-minted at a
 *  future call site (the same seam-closing as `createSurfaceHealthRegistry`). */
const wsDot = (status: WsStatus): string => toneDot[wsTone[status]];

/** The `srv`/mobile **server-connection** dot's tone, FLOORED on the watchdog-backed
 *  transport `live` — the connection-dot sibling of {@link kavalDot}, and the
 *  canonical #1568 "paint the connection dot from the FACT, not a narrower signal."
 *
 *  `status` is the open/close-only oRPC lifecycle (`WsStatus`), which is half-open
 *  BLIND: a silently dead socket fires no `close`, so the lifecycle reads `open`
 *  while the half-open watchdog (the SAME socket's `health().live`) has already
 *  flipped `live` false at its probe timeout — it forces the reconnect the lifecycle
 *  only sees AFTERWARD. So a bare `wsDot` would paint a definite green "connected"
 *  over a link the fact already knows is dead. When the lifecycle says `open` but the
 *  fact says not-`live`, paint the reconnecting (warming) tone instead — never green
 *  over a half-open the watchdog caught. A genuine `closed`/`connecting` keeps its own
 *  honest down/warming tone (the floor only withholds the `open`→green claim). */
export function serverDot(status: WsStatus, live: boolean): string {
  if (status === "open" && !live) return toneDot.warming;
  return wsDot(status);
}

/** Is a daemon state in the transient "warming" bucket — `connecting` (boot) or
 *  `restarting` (a supervised restart in flight)? Derived from the presentation
 *  table so the warming set is named ONCE. MODULE-PRIVATE: the transport-liveness-
 *  floored {@link liveWarming} wraps it, and is what every consumer reads (the
 *  canvas via `daemonWarming`, the ⌘T lockout, the restart-button predicate), so the
 *  unfloored predicate has no external spelling; a future warming state is covered
 *  for free. */
function isWarming(state: DaemonState | undefined): boolean {
  return state ? DAEMON_STATE_PRESENTATION[state].tone === "warming" : false;
}

/** {@link isWarming}, FLOORED on transport liveness — the same floor `kavalDot`
 *  applies to the dot. A daemon-state claim ("the daemon is coming up") only holds
 *  over a LIVE link: when `live` is false (transport dead / silently half-open) the
 *  retained state is stale, so a known "warming" state may only REFINE the verdict
 *  WITHIN a live link, never assert "restarting…/connecting…" over a dead channel.
 *  Every consumer of "is the daemon warming" reads the floor through THIS one
 *  function — most via `daemonWarming()` (the App canvas, the ⌘T terminal-creation
 *  lockout `refuseIfWarming`, the command-palette gate), and `restartInFlight`
 *  (the Restart-kaval button gate) by calling `liveWarming` directly with the same
 *  `(state, daemonTransportLive())` pair, so its warming arm stays exactly
 *  `daemonWarming()`'s body. The floor is therefore applied ONCE here, and no
 *  consumer can read an unfloored warming verdict. */
export function liveWarming(
  state: DaemonState | undefined,
  live: boolean,
): boolean {
  return live && isWarming(state);
}

/** The daemon's down sub-state ("dead"/"degraded"), FLOORED on transport
 *  liveness — the down twin of {@link liveWarming}. "The daemon is down" is a claim
 *  the dead channel can't confirm, so when `live` is false this reads `undefined`
 *  ("unknown"), never a stale "dead"/"degraded" that would paint DegradedCanvas over
 *  a link we can't see through. The post-grace transport overlay owns the disconnect
 *  messaging instead; a known down-state may only refine the canvas WITHIN a live
 *  link. (Unknown ≠ down — same distinction `DAEMON_UNKNOWN_DOT` draws for the dot.) */
export function liveDownState(
  state: DaemonState | undefined,
  live: boolean,
): "dead" | "degraded" | undefined {
  if (!live || !state) return undefined;
  return DAEMON_STATE_PRESENTATION[state].down
    ? (state as "dead" | "degraded")
    : undefined;
}

// ── The active-entry leg: the SECOND floor on the (host-scoped) kaval daemonStatus ──
//
// W4 scopes `daemonStatus` to `useEntry(activeHost)`. For a REMOTE active host the
// browser↔kolu-server ws (`transportLive`) can be up while the leg that actually delivers
// that host's status — the server→remote link (the entry's own `EntryStatus`, projected
// from its session's connection state, {@link @kolu/surface-remote's serveHostMap}) — is
// dead/(re)establishing. On that flap the re-served `daemonStatus` FREEZES stale at
// whatever it last read, so a rail floored only on `transportLive` paints a green
// "running" kaval dot over a dead/warming daemon, contradicting the (honestly red/warming)
// host chip — the #1568 green-over-dead class `foldState` floors on the chip, relocated to
// the rail. This leg closes it: the daemonStatus channel is live only when the active
// entry is itself `connected`.
//
// This is the SAME leg the LOCAL host's `daemon.restart` drain rides — the local session
// is a `pool` member exactly like a remote one (`serveHostMap` attaches its `onState` no
// differently), so a local padi drain ALSO drops the entry out of `connected` for the
// whole drain window. There is no separate "local padi link" leg to fold any more (W4
// daemon-rail unification, retiring the host-gated `localPadiLinkOnly`/`activePadiLink`
// detour this file used to carry): every host — local or remote — floors on exactly this
// one channel-liveness fact, computed the same way, with no host parameter anywhere in
// this module.

/** The daemonStatus channel's TRUE liveness: the ws transport (`transportLive`) AND the
 *  active host entry's own connection (`entryConnected`). Every kaval-rail read of the
 *  ACTIVE host's daemon state floors on THIS, not `transportLive` alone, so a dead/warming
 *  entry — local (a padi drain) or remote (an ssh flap) alike — reads "unknown", never a
 *  green "running" over a frozen re-served status. Pure so the leg is pinnable without a
 *  socket, like {@link kavalDot}. */
export function channelLive(
  transportLive: boolean,
  entryConnected: boolean,
): boolean {
  return transportLive && entryConnected;
}
