/**
 * The live status of this host's pty-host daemon (kaval), as the server's
 * supervisor endpoint reports it on the `daemonStatus` surface collection.
 *
 * A module-level singleton subscription (one local host, keyed `"local"`),
 * consumed by the ChromeBar's KAVAL rail column and App.tsx's DegradedCanvas
 * gate — so the UI can tell "the daemon is down" apart from "you have no
 * terminals" (B2, the empty-canvas-lie fix).
 */

import type { DaemonStatus } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { app } from "./wire";

/** The one host today; R-2's ssh hosts add more keys to the same collection. */
export const LOCAL_HOST = "local";

const sub = app.collections.daemonStatus.use({
  keys: () => [LOCAL_HOST],
  onError: (err) => toast.error(`Daemon status error: ${err.message}`),
});

/** The local daemon's status, or undefined before the first server yield. */
export function localDaemonStatus(): DaemonStatus | undefined {
  return sub.byKey(LOCAL_HOST)?.();
}

/** The single projection of "is the daemon down, and which kind" — `dead`
 *  (never came up) or `degraded` (died mid-session), or `undefined` when it's
 *  up (or still loading, so a brief load never flashes the degraded surface).
 *  Drives the DegradedCanvas gate AND its `state` prop, so the down-sub-union
 *  is named in one place rather than re-derived by an inline ternary. */
export function downState(): "dead" | "degraded" | undefined {
  const state = localDaemonStatus()?.state;
  return state === "dead" || state === "degraded" ? state : undefined;
}

/** True when the daemon is down. The DegradedCanvas gate. */
export function daemonDown(): boolean {
  return downState() !== undefined;
}
