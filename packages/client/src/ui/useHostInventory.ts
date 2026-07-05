/**
 * The BOUND host's running kaval + padi daemons — the "Running daemons" list the
 * Kaval + Padi info dialogs show for the machine kolu-server is bound to.
 *
 * These ride padiSurface's `hostInventory` cell (padi scans its OWN host and serves
 * the result), re-served straight to this client — so the list describes the bound
 * host identically whether kolu-server reaches padi locally or over ssh. That is the
 * whole point of the member: before it, the dialog could only show the machine
 * kolu-server runs on, never the machine you're actually using when bound remotely.
 *
 * kolu-server's OWN machine (a leak diagnostic under a remote binding) is a SEPARATE
 * list — koluSurface's `daemonInventory.localScan`, in `./useDaemonInventory`.
 */

import type { RunningKaval, RunningPadi } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { padi } from "../wire";

const sub = padi.cells.hostInventory.use({
  onError: (err) => toast.error(`Host inventory error: ${err.message}`),
});

/** Every running kaval daemon on the BOUND host, each marked `active` when that host's
 *  padi owns it (empty before the first scan). */
export function boundHostKavals(): RunningKaval[] {
  return sub.value()?.kavals ?? [];
}

/** Every running padi daemon on the BOUND host, each marked `active` when it is the one
 *  kolu is bound to (empty before the first scan). */
export function boundHostPadis(): RunningPadi[] {
  return sub.value()?.padis ?? [];
}

/** The BOUND padi kolu is using (`active`), or `undefined` before the first scan. The
 *  Padi dialog reads its `socket` for the socket detail row under a LOCAL binding (under
 *  a remote binding the socket is a path on the ssh host, so the dialog names the host
 *  instead). */
export function activePadi(): RunningPadi | undefined {
  return boundHostPadis().find((p) => p.active);
}
