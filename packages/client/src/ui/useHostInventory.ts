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
import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { activePadiLink, daemonChannelLive } from "../kaval/useDaemonStatus";
import { activeHost, padiMap } from "../wire";
import { hostInventoryLive } from "./hostInventoryLive";

// A host-scoped standing readout — rides `useEntry(activeHost)` under an app-scope
// `createRoot` (module-lifetime), so it re-keys when the active host switches.
const sub = createRoot(() =>
  padiMap.useEntry(activeHost).cells.hostInventory.use({
    onError: (err: Error) =>
      toast.error(`Host inventory error: ${err.message}`),
  }),
);

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

/** Whether the bound host's inventory is a TRUSTWORTHY live reading the dialog may render
 *  as a definite answer — the conjunction of (a) the bound padi being LIVE and (b) it
 *  having reported a real frame (its own active padi row). Not (a): a dropped ssh link /
 *  drain window leaves the re-served cell STALE (held populated) — reading it as live
 *  would show a dead padi's list as current (#1034); the bind-liveness fact excludes it.
 *  Not (b): a just-connected bind before its first frame is the seeded empty default. So
 *  the dialogs read "unavailable" for BOTH, never "No running daemons" (a masquerade).
 *  See {@link hostInventoryLive}. */
export function boundHostInventoryLive(): boolean {
  return hostInventoryLive({
    // kolu's honest bind-liveness fact for the ACTIVE host's inventory (this cell rides
    // `useEntry(activeHost)`): the browser transport ∧ the active entry's own connection
    // (`daemonChannelLive` — so a dead REMOTE entry's frozen re-served inventory is not read
    // as live, the #1568 leg the dot floors on) ∧ — for a LOCAL active host — koluSurface's
    // directly-served `padiLink` (`activePadiLink` no-ops this leg for a REMOTE active host, so
    // a local-padi drop can't read a healthy remote's inventory as "unavailable"; re-run #6).
    bindLive: daemonChannelLive() && activePadiLink() === "connected",
    padis: boundHostPadis(),
  });
}

/** The BOUND padi kolu is using (`active`), or `undefined` before the first scan. The
 *  Padi dialog reads its `socket` for the socket detail row under a LOCAL binding (under
 *  a remote binding the socket is a path on the ssh host, so the dialog names the host
 *  instead). */
export function activePadi(): RunningPadi | undefined {
  return boundHostPadis().find((p) => p.active);
}
