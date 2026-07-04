/**
 * The host-daemon inventory for the Kaval + Padi info dialogs — one singleton
 * subscription every consumer shares, off the server-authored `daemonInventory`
 * koluSurface cell (same shape as `useMemoryUsage.ts` / `useProcessUptime.ts`).
 *
 * The cell enumerates EVERY running kaval + padi on this host (read-only, server-side)
 * and marks which one kolu's bound padi owns — so a LEAKED post-upgrade daemon, once
 * only surfaced by a `kaval-tui: more than one kaval daemon is running` CLI error, is
 * listed in the UI. Honesty (#1034): a field the server couldn't read is `null` here,
 * rendered "—" by the dialogs — never a fabricated value.
 */

import type {
  PadiConvergence,
  RunningKaval,
  RunningPadi,
} from "kolu-common/surface";
import { toast } from "solid-sonner";
import { app } from "../wire";

const sub = app.cells.daemonInventory.use({
  onError: (err) => toast.error(`Daemon inventory error: ${err.message}`),
});

/** Every running kaval daemon on this host, each marked `active` when kolu's bound
 *  padi owns it (empty before the first server enumeration). */
export function runningKavals(): RunningKaval[] {
  return sub.value()?.kavals ?? [];
}

/** Every running padi daemon on this host, each marked `active` when kolu-server is
 *  bound to it (empty before the first server enumeration). */
export function runningPadis(): RunningPadi[] {
  return sub.value()?.padis ?? [];
}

/** The ssh host kolu-server's padi is bound to (`KOLU_PADI_HOST`), or `null` for a
 *  LOCAL binding / before the first enumeration. When non-null, this inventory is a scan
 *  of THIS machine — NOT the bound host — so the dialogs label + separate it from the
 *  bound-kaval identity (which rides padiSurface and reflects the REMOTE host). */
export function daemonScanBoundHost(): string | null {
  return sub.value()?.boundHost ?? null;
}

/** The padi kolu-server is bound to (`active`), or `undefined` before the first
 *  enumeration / while unbound. The Padi dialog reads its `surfaceVersion` /
 *  `buildCommit` / `socket` for the header + detail rows, mirroring how the Kaval
 *  dialog sources those from the active daemon's status. */
export function activePadi(): RunningPadi | undefined {
  return runningPadis().find((p) => p.active);
}

/** The `padiSurface` version the BOUND padi serves — its honest `hello.surfaceVersion`,
 *  or `null` while unbound / before the first sample (an honest "—", never the binder's
 *  build constant). Reads the bound-session readout (`boundPadi`), NOT the local-scan
 *  `active` row, so it's correct over ssh too (a remote binding has no local active padi).
 *  Read by the Padi dialog + rail chip's "contract v<x.y>" readout. */
export function activePadiSurfaceVersion(): string | null {
  return sub.value()?.boundPadi?.surfaceVersion ?? null;
}

/** The BOUND padi's honest navigable git build commit off its `hello`, or `null` while
 *  unbound / a survivor predating the field. Like {@link activePadiSurfaceVersion}, reads
 *  the bound-session readout so the Padi dialog's build-commit row works over ssh (no
 *  local active padi under a remote binding). */
export function boundPadiBuildCommit(): string | null {
  return sub.value()?.boundPadi?.buildCommit ?? null;
}

/** The BOUND padi's STANDING convergence anomaly (adopted-stale build / contract skew /
 *  drain-failure / link-failure), or `null` when converged/healthy. The Padi dialog reads
 *  it to show a degraded bind as a visible banner (running vs expected build, the reason) —
 *  the whole point of the dialog: nothing swallowed behind the scenes. Remote arm only; the
 *  local arm reports `null` today (see `BoundPadi.padiConvergence`). */
export function boundPadiConvergence(): PadiConvergence | null {
  return sub.value()?.boundPadi?.convergence ?? null;
}
