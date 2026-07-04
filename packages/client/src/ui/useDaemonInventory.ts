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

import type { RunningKaval, RunningPadi } from "kolu-common/surface";
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

/** The `padiSurface` version the RUNNING active padi serves — the bound padi's honest
 *  `hello.surfaceVersion`, or `null` when padi is unbound / before the first sample (an
 *  honest "—", never the binder's build constant). Read by the Padi dialog + rail chip's
 *  "contract v<x.y>" readout, mirroring how Kaval sources its own contract version. */
export function activePadiSurfaceVersion(): string | null {
  return activePadi()?.surfaceVersion ?? null;
}
