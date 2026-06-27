/** Pure, side-effect-free presentation for the kaval daemon + ws transport — the
 *  tables and projections the rail, the dialog, and the canvas all read.
 *
 *  Deliberately imports NOTHING with a module-load side effect (no `../wire`, which
 *  opens the PartySocket; no `createRoot`): only types and the pure `compactDelta`
 *  ladder. `useDaemonStatus.ts` (the wire-coupled subscription + accessors)
 *  re-exports every symbol here, so existing importers are unchanged — but the
 *  presentation is now testable on its own, which is what lets `kavalDot`'s
 *  transport-liveness floor be pinned by a unit test without standing up a socket. */

import type { DaemonState } from "kolu-common/surface";
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
 *  WS-status→tone mapping lives, so the `srv` liveness dot (desktop rail) and the
 *  mobile connection dot read ONE receptacle instead of two byte-identical maps. */
export const wsTone: Record<WsStatus, DaemonTone> = {
  connecting: "warming",
  open: "ok",
  closed: "down",
};

/** A WebSocket status → its status-dot class, via {@link wsTone} + {@link
 *  toneDot}. Both the desktop rail's `srv` dot and the mobile chrome dot resolve
 *  through this single helper, so a connection-tone change is made once. */
export const wsDot = (status: WsStatus): string => toneDot[wsTone[status]];

/** Is a daemon state in the transient "warming" bucket — `connecting` (boot) or
 *  `restarting` (a supervised restart in flight)? Derived from the presentation
 *  table so the warming set is named ONCE: both the module-singleton gate
 *  (`daemonWarming`) and the param-taking restart-button predicate
 *  (`restartInFlight` in `useDaemonRestart`) project from it, so they can't drift
 *  on what counts as "coming up", and a future warming state is covered for free. */
export function isWarming(state: DaemonState | undefined): boolean {
  return state ? DAEMON_STATE_PRESENTATION[state].tone === "warming" : false;
}
