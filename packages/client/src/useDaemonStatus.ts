/**
 * The live status of this host's pty-host daemon (kaval), as the server's
 * supervisor endpoint reports it on the `daemonStatus` surface collection.
 *
 * A module-level singleton subscription (one local host, keyed `"local"`),
 * consumed by the ChromeBar's KAVAL rail column and App.tsx's DegradedCanvas
 * gate — so the UI can tell "the daemon is down" apart from "you have no
 * terminals" (B2, the empty-canvas-lie fix).
 */

import type { DaemonState, DaemonStatus } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { app } from "./wire";

/** The one host today; R-2's ssh hosts add more keys to the same collection. */
export const LOCAL_HOST = "local";

/** A daemon state's coarse tone — the warming-up/up/down bucket every display
 *  site shares. `restarting` and `connecting` are both `warming` (transient,
 *  coming up), declared once here rather than re-collapsed at each dot map. */
type DaemonTone = "ok" | "warming" | "down";

/** The single source of truth for "what does daemon state X mean visually."
 *  One row per state, keyed by `DaemonState`, so a new state is a compile-forced
 *  row instead of N independent edits across the dialog, rail, and gate. Every
 *  presentation a consumer needs is derived from this table: the dot class from
 *  `tone` (via {@link toneDot}), the dialog/rail label from `label`, and the
 *  DegradedCanvas narrowing from `down`. The table is client-only — the tones,
 *  labels, and Tailwind classes are projections of the state, not part of the
 *  wire `DaemonStatusSchema`. */
export const DAEMON_STATE_PRESENTATION: Record<
  DaemonState,
  { tone: DaemonTone; label: string; down: boolean }
> = {
  connecting: { tone: "warming", label: "starting…", down: false },
  connected: { tone: "ok", label: "running", down: false },
  restarting: { tone: "warming", label: "restarting…", down: false },
  degraded: { tone: "down", label: "stopped (session preserved)", down: true },
  dead: { tone: "down", label: "not running", down: true },
};

/** A tone → status-dot class. The one place `warming`==`animate-pulse` etc. is
 *  spelled, so the dot is derived from {@link DAEMON_STATE_PRESENTATION}'s tone
 *  rather than re-tabulated per display. */
export const toneDot: Record<DaemonTone, string> = {
  ok: "bg-ok",
  warming: "bg-warning animate-pulse",
  down: "bg-danger",
};

const sub = app.collections.daemonStatus.use({
  keys: () => [LOCAL_HOST],
  onError: (err) => toast.error(`Daemon status error: ${err.message}`),
});

/** The local daemon's status, or undefined before the first server yield. */
export function localDaemonStatus(): DaemonStatus | undefined {
  return sub.byKey(LOCAL_HOST)?.();
}

/** True until the daemon-status stream has produced its FIRST value — i.e. the
 *  status is genuinely unknown, not "up". The canvas gates on this so a `dead`
 *  boot never flashes the normal empty workspace before the first status lands
 *  (#1034): if `daemonDown()` (false while pending) drove the gate alone and the
 *  session cell resolved to zero terminals first, the empty-state would paint and
 *  then snap to DegradedCanvas. `pending` is undefined before `byKey` has a
 *  subscription, which is itself the pre-first-value state, so treat that as
 *  pending too. */
export function daemonStatusPending(): boolean {
  return sub.byKey(LOCAL_HOST)?.pending() ?? true;
}

/** The single projection of "is the daemon down, and which kind" — `dead`
 *  (never came up) or `degraded` (died mid-session), or `undefined` when it's
 *  up (or still loading, so a brief load never flashes the degraded surface).
 *  Drives the DegradedCanvas gate AND its `state` prop, so the down-sub-union
 *  is named in one place rather than re-derived by an inline ternary. */
export function downState(): "dead" | "degraded" | undefined {
  const state = localDaemonStatus()?.state;
  if (!state) return undefined;
  // The down-sub-union is whichever states the presentation table marks `down`.
  // Today that is exactly `dead`/`degraded`; the cast holds because no non-down
  // state is flagged `down`, and keeping the narrow return type means a future
  // `down` state must be added to this union deliberately, not silently widened.
  return DAEMON_STATE_PRESENTATION[state].down
    ? (state as "dead" | "degraded")
    : undefined;
}

/** True when the daemon is down. The DegradedCanvas gate. */
export function daemonDown(): boolean {
  return downState() !== undefined;
}
