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

import { toast } from "solid-sonner";
import { bindingScoped } from "../binding/bindings";
import { createSharedRoot } from "../createSharedRoot";

// W4 "the switch": `bindingScoped` re-keys the sub onto the ACTIVE host's socket, so
// the uptime rail never reads a boot-binding socket that a switch-away retired
// (closed). The `processStartedAt` cell is kolu-server's own host-independent
// surface, served on every per-host socket; only the socket is per-binding.
// `createSharedRoot` gives `bindingScoped` its app-lifetime reactive owner.
const uptime = createSharedRoot(() =>
  bindingScoped((b) =>
    b.clients.kolu.cells.processStartedAt.use({
      onError: (err) => toast.error(`Uptime readout error: ${err.message}`),
    }),
  ),
);
const sub = () => uptime()();

/** kolu-server's boot time (ms epoch), or `null` before the first server yield (the
 *  `0` seed maps to `null` so a consumer never renders `now − 0` as an uptime). The
 *  KoluInfoDialog renders `now − this` as the server's uptime. */
export function serverStartedAt(): number | null {
  const t = sub().value()?.server;
  return t ? t : null;
}

/** The bound padi's boot time (ms epoch), or `null` while padi is unbound / before the
 *  first yield — the PadiInfoDialog renders `now − this` as padi's uptime, mirroring
 *  the Kaval dialog's uptime off kaval's `startedAt`. */
export function padiStartedAt(): number | null {
  return sub().value()?.padi ?? null;
}
