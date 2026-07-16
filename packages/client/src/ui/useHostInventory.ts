/**
 * The BOUND host's running kaval + padi daemons — the "Running daemons" list the
 * Kaval + Padi info dialogs show for the machine kolu-server is bound to — AND (W4
 * "the switch") the ACTIVE host's own padi identity (build commit / surfaceVersion /
 * boot time).
 *
 * `hostInventory` rides padiSurface's `hostInventory` cell (padi scans its OWN host
 * and serves the result), re-served straight to this client — so the list describes
 * the bound host identically whether kolu-server reaches padi locally or over ssh.
 * That is the whole point of the member: before it, the dialog could only show the
 * machine kolu-server runs on, never the machine you're actually using when bound
 * remotely.
 *
 * `identity` rides padiSurface's `identity` cell (padi is the SOLE authority on its
 * own build commit/surfaceVersion/boot time — the per-host twin of its control-core
 * `hello`). Before this cell existed, the dialog's commit/version/uptime rode the
 * single legacy bind (`daemonInventory.boundPadi` / koluSurface's `processStartedAt`),
 * which only ever described whichever ONE padi kolu-server happened to be bound to —
 * a wrong-host lie the instant a REMOTE host was active. Both readouts re-key when
 * the active host switches (`useEntry(activeHost)`).
 *
 * kolu-server's OWN machine (a leak diagnostic under a remote binding) is a SEPARATE
 * list — koluSurface's `daemonInventory.localScan`, in `./useDaemonInventory`.
 */

import type { RunningKaval, RunningPadi } from "kolu-common/surface";
import { createRoot } from "solid-js";
import { daemonChannelLive } from "../kaval/useDaemonStatus";
import { activeHost, padiMap } from "../wire";
import { hostInventoryLive } from "./hostInventoryLive";

// A host-scoped standing readout — rides `useEntry(activeHost)` under an app-scope
// `createRoot` (module-lifetime), so it re-keys when the active host switches.
const sub = createRoot(() =>
  padiMap.useEntry(activeHost).cells.hostInventory.use(),
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
    // (`daemonChannelLive` — so a dead entry's frozen re-served inventory is not read as
    // live, whether that entry is a REMOTE ssh flap or a LOCAL `daemon.restart` drain — the
    // #1568 leg the dot floors on, W4 daemon-rail unification: one fact, every host).
    bindLive: daemonChannelLive(),
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
