/**
 * The one-click "Restart kaval" action (B3.2 — supervised restart).
 *
 * A module-level singleton so the two affordances that trigger it — the kaval
 * rail dialog (a running or degraded daemon) and the DegradedCanvas (a dead one)
 * — share one in-flight guard and one toast. The handler is deliberately thin:
 * it fires the `daemon.restart` RPC and reports the outcome. The server does the
 * session-preserving work (snapshot → drain → recycle); the restore itself is
 * the existing card, which reappears once the fresh daemon is connected and the
 * canvas is honestly empty with the preserved session. The daemon's live
 * `restarting`→`connected` state rides the `daemonStatus` surface, so the rail
 * and canvas reflect progress without this hook tracking it.
 */

import type { DaemonStatus } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { client } from "./wire";

const [restarting, setRestarting] = createSignal(false);

/** True from the click until the restart RPC settles — gates the buttons so a
 *  double-click can't fire a second recycle (the server coalesces too, but this
 *  closes the visible click window immediately, before the surface state flips). */
export const daemonRestarting = restarting;

/** The one "a restart is underway, disable the button" predicate, read by every
 *  affordance that triggers `restartDaemon`. It is in flight while the local
 *  click is being serviced (`daemonRestarting`) OR while the daemon surface is
 *  mid-transition (`restarting`/`connecting`) — the latter arm catches a restart
 *  another client kicked off, which the local signal can't see. Both the kaval
 *  dialog and the DegradedCanvas disable on this, so the two buttons can't
 *  disagree on what counts as in flight. */
export function restartInFlight(status: DaemonStatus | undefined): boolean {
  return (
    daemonRestarting() ||
    status?.state === "restarting" ||
    status?.state === "connecting"
  );
}

/** Restart the local kaval daemon, preserving the session. Safe to call from
 *  multiple affordances; re-entrant calls while one is in flight are ignored. */
export async function restartDaemon(): Promise<void> {
  if (restarting()) return;
  setRestarting(true);
  const id = toast.loading("Restarting kaval…");
  try {
    await client.daemon.restart({});
    toast.success("kaval restarted — your session is offered for restore", {
      id,
    });
  } catch (err) {
    toast.error(`Couldn’t restart kaval: ${(err as Error).message}`, { id });
  } finally {
    setRestarting(false);
  }
}
