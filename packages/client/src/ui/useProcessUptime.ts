/**
 * Live boot-time readouts for the identity rail's uptime — kolu-server's own and the
 * bound padi's — off the server-authored `processStartedAt` koluSurface cell (one
 * singleton subscription every consumer shares, same shape as `useMemoryUsage.ts`).
 *
 * kaval's boot time is NOT here: it already rides `daemonStatus.startedAt` (see
 * `../kaval/useDaemonStatus`), which the Kaval dialog reads for its own uptime. This
 * module carries only the two processes that lacked one — kolu-server and padi.
 *
 * The consumer renders `getClockNow()() − startedAt` as the live uptime (the shared
 * app clock ticks it each second). Honesty (#1034): `server` reads `null` until the
 * first server yield (the `0` sentinel) and `padi` reads `null` whenever padi is
 * unbound — both the honest "unknown" the dialogs gate out, never a bogus uptime
 * climbing off a made-up boot time.
 */

import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { app } from "../wire";

// HOST-SCOPING: `processStartedAt` is a koluSurface (host-INDEPENDENT-TODAY) cell —
// `server` is genuinely host-independent (kolu-server's own boot time, one process for
// the whole browser tab). `padi` rides the LEGACY single-bind `padiSession` (hardcoded to
// the unremovable LOCAL default under always-map — see `server/src/index.ts`'s
// `startDaemonInventorySampler` call, `boundHost: null`), so `padiStartedAt()` describes
// the LOCAL padi's uptime always, never the ACTIVE (possibly remote) host's — a
// padi/server-side gap (no per-host "padi's own boot time" wire member exists yet), out
// of this fix's file scope. See the classification table in `PadiInfoDialog.tsx`.
//
// THE LIVE-SUBSCRIPTION FIX: same class as `useMemoryUsage.ts`'s `sub` — a bare
// module-const `.use()` is the "ownerless" path `createKeyedSubscriptionCache` documents,
// torn down a microtask after load with no owner to keep its listener count above zero.
// Wrapped in an app-lifetime `createRoot` so it survives for the session (the
// `useDaemonStatus.ts`/`useHostInventory.ts` idiom).
const sub = createRoot(() =>
  app.cells.processStartedAt.use({
    onError: (err) => toast.error(`Uptime readout error: ${err.message}`),
  }),
);

/** kolu-server's boot time (ms epoch), or `null` before the first server yield (the
 *  `0` seed maps to `null` so a consumer never renders `now − 0` as an uptime). The
 *  KoluInfoDialog renders `now − this` as the server's uptime. */
export function serverStartedAt(): number | null {
  const t = sub.value()?.server;
  return t ? t : null;
}

/** The bound padi's boot time (ms epoch), or `null` while padi is unbound / before the
 *  first yield — the PadiInfoDialog renders `now − this` as padi's uptime, mirroring
 *  the Kaval dialog's uptime off kaval's `startedAt`. */
export function padiStartedAt(): number | null {
  return sub.value()?.padi ?? null;
}
