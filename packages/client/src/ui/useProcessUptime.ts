/**
 * Live boot-time readout for the identity rail's uptime — kolu-server's OWN, off the
 * server-authored `processStartedAt` koluSurface cell (one singleton subscription
 * every consumer shares, same shape as `useMemoryUsage.ts`).
 *
 * padi's boot time is NOT here (W4 "the switch" moved it OFF this host-independent
 * koluSurface cell): it now rides padi's own per-host `identity` cell —
 * `useHostInventory.ts`'s `activePadiStartedAt()`, which re-keys on `activeHost` and
 * reprojects padi's RAW boot epoch through the entry's `clock.toLocal` (padi's clock,
 * not the browser's). kaval's boot time is likewise NOT here: it rides
 * `daemonStatus.startedAt` (see `../kaval/useDaemonStatus`). This module carries only
 * the ONE process that has no per-host wire member of its own — kolu-server.
 *
 * The consumer renders `getClockNow()() − startedAt` as the live uptime (the shared
 * app clock ticks it each second). Honesty (#1034): `server` reads `null` until the
 * first server yield (the `0` sentinel) — the honest "unknown" the dialog gates out,
 * never a bogus uptime climbing off a made-up boot time.
 */

import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { app } from "../wire";

// `server` is genuinely host-independent (kolu-server's own boot time, one process
// for the whole browser tab) — `processStartedAt` stays a plain koluSurface cell.
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
