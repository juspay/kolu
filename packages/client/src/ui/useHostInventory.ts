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
import { type DaemonScan, daemonScanCause } from "../host/daemonScan";
import { daemonChannelLive } from "../kaval/useDaemonStatus";
import { activeHost, padiMap } from "../wire";

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

/** The bound host's daemon-scan liveness as a DISCRIMINATED CAUSE (#1793) — the ONE fold
 *  the "Running daemons" section reads, so a NOT-live scan names WHY (connecting vs a hard
 *  `failed(cause)` host vs a too-old padi) instead of guessing "connecting". A total fold
 *  over the active host's typed entry state ({@link daemonScanCause}) × whether a real
 *  frame has landed:
 *
 *   - `bindLive` is kolu's honest bind-liveness fact (browser transport ∧ the active
 *     entry's own connection, `daemonChannelLive`) — so a dead entry's frozen re-served
 *     inventory is never read as live, REMOTE ssh flap or LOCAL `daemon.restart` drain
 *     alike (#1568, W4 daemon-rail unification: one fact, every host). It gates only the
 *     `connected` arm's live-vs-too-old call.
 *   - `framePresent`: a live padi ALWAYS reports ITSELF (`withSelfPadi` seeds its own
 *     active row even at T+0), so "no active padi row" is the tell that no real frame has
 *     landed — distinct from a genuine zero (which can't happen). Without it a
 *     just-connected bind's seeded-empty `{ kavals: [], padis: [] }` would read as a
 *     definite "No running daemons" (#1034). */
export function boundHostScan(): DaemonScan {
  return daemonScanCause(padiMap.entry(activeHost()).state(), {
    bindLive: daemonChannelLive(),
    framePresent: boundHostPadis().some((p) => p.active),
  });
}

/** Whether the bound host's inventory is a TRUSTWORTHY live reading the dialog may render
 *  as a definite answer — derived from the single {@link boundHostScan} fold so the floor
 *  consumers (the Padi socket row, the kaval converge nudge) and the section's copy can't
 *  drift on what "live" means. */
export function boundHostInventoryLive(): boolean {
  return boundHostScan().kind === "live";
}

/** The BOUND padi kolu is using (`active`), or `undefined` before the first scan. The
 *  Padi dialog reads its `socket` for the socket detail row under a LOCAL binding (under
 *  a remote binding the socket is a path on the ssh host, so the dialog names the host
 *  instead). */
export function activePadi(): RunningPadi | undefined {
  return boundHostPadis().find((p) => p.active);
}
