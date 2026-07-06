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
import { subErrorToast, useBindingScopedSub } from "../binding/bindings";
import { daemonTransportLive, padiLinkState } from "../kaval/useDaemonStatus";
import { hostInventoryLive } from "./hostInventoryLive";

// W4 "the switch": `hostInventory` is a PADI cell — it describes the BOUND host, so
// it is genuinely per-host and MUST follow the active binding (an unfixed
// module-level `padi.cells.hostInventory.use(...)` pinned the boot host's inventory
// AND, after a switch-away, its now-closed socket). `bindingScoped` re-keys it onto
// the active host; `createSharedRoot` gives it an app-lifetime reactive owner.
const hostInventory = useBindingScopedSub((b) =>
  b.clients.padi.cells.hostInventory.use({
    onError: subErrorToast("Host inventory error"),
  }),
);
const sub = () => hostInventory();

/** Every running kaval daemon on the BOUND host, each marked `active` when that host's
 *  padi owns it (empty before the first scan). */
export function boundHostKavals(): RunningKaval[] {
  return sub().value()?.kavals ?? [];
}

/** Every running padi daemon on the BOUND host, each marked `active` when it is the one
 *  kolu is bound to (empty before the first scan). */
export function boundHostPadis(): RunningPadi[] {
  return sub().value()?.padis ?? [];
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
    // kolu's honest bind-liveness fact: the browser transport ∧ koluSurface's
    // directly-served `padiLink` (the re-served surface's own health is held stale
    // across a drop, so it can't be the tell — see `useDaemonStatus`).
    bindLive: daemonTransportLive() && padiLinkState() === "connected",
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
