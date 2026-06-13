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
import { app, client } from "./wire";

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
  return state === "dead" || state === "degraded" ? state : undefined;
}

/** True when the daemon is down. The DegradedCanvas gate. */
export function daemonDown(): boolean {
  return downState() !== undefined;
}

/** Is the connected daemon a build behind the server's expected kaval build?
 *  The currency check, derived at the read site (never stored): a `connected`
 *  daemon whose `identity.staleKey` differs from the server's `expectedStaleKey`.
 *  Only reachable once B3 adopts a survivor across a deploy — a fresh boot always
 *  matches — and only when both build ids are present (dev sets neither). */
export function updatePending(
  status: DaemonStatus | undefined = localDaemonStatus(),
): boolean {
  if (status?.state !== "connected") return false;
  const have = status.identity?.staleKey;
  const want = status.expectedStaleKey;
  return have !== undefined && want !== undefined && have !== want;
}

/** Trigger a supervised daemon restart over `daemon.restart`. Recoverable by
 *  construction: the server captures the session before the recycle, so a failed
 *  respawn leaves the restore card, never an empty canvas. Concurrent triggers
 *  coalesce onto one recycle (the spine serializes). */
export async function restartKaval(): Promise<void> {
  const id = toast.loading("Restarting kaval…");
  try {
    await client.daemon.restart({ hostId: LOCAL_HOST });
    toast.success("kaval restarted — terminals reconnecting", { id });
  } catch (err) {
    toast.error(`Failed to restart kaval: ${(err as Error).message}`, { id });
  }
}
