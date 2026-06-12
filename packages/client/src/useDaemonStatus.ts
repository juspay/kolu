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

/** True when the daemon is down — dead (never came up) or degraded (died
 *  mid-session). The DegradedCanvas gate. Undefined status (still loading) is
 *  NOT down, so a brief load never flashes the degraded surface. */
export function daemonDown(): boolean {
  const state = localDaemonStatus()?.state;
  return state === "dead" || state === "degraded";
}
