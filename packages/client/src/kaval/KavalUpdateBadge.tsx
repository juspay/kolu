/** Accessors for "the running kaval daemon is a build behind the kaval the
 *  server would spawn" (B3.4 — currency). Host-first chrome keeps the dual-daemon
 *  slot icon+dot only; update detail rides the Kaval tooltip and
 *  {@link KavalInfoDialog}. Session-preserving Restart-kaval lives in that
 *  dialog (`RestartKavalButton`).
 *
 *  The derivation ({@link kavalStale}) is a read-site join of two raw facts —
 *  `expected` (padi's `status.expectedKaval`) and `reported` (the connected
 *  daemon's `daemonStatus.identity`) — never stored, never folded into the
 *  client-vs-server `≠ srv` signal (which stays the commit comparison). */

import type { PadiStatus } from "@kolu/padi/surface";
import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { activeHost, padiMap } from "../wire";
import { kavalStale } from "./kavalCurrency";
import { daemonChannelLive, localDaemonStatus } from "./useDaemonStatus";

// A module-level standing subscription to padi's `status` cell (the same pattern
// useDaemonStatus uses for the daemonStatus collection). The `expectedKaval` axis
// rides HERE now — it left the surface-app `buildInfo` cell in W1.R7 so a kaval
// read no longer crosses `packages/server`. Read-only; padi seeds it once at boot.
// A host-scoped standing readout — rides `useEntry(activeHost)` under an app-scope
// `createRoot` (module-lifetime), so it re-keys when the active host switches.
const padiStatus = createRoot(() =>
  padiMap.useEntry(activeHost).cells.status.use({
    onError: (err: Error) => toast.error(`Kaval status error: ${err.message}`),
  }),
);

/** The *expected* kaval identity — the build padi would spawn
 *  (`padi.cells.status.expectedKaval`: closure `staleKey` + git `navigableCommit`).
 *  Named once here so every read site (the `kavalUpdatePending` predicate and the
 *  dialog's running-vs-expected commit links + "what changed" history link) joins
 *  the surface path through one accessor. */
export const expectedKaval = (): PadiStatus["expectedKaval"] =>
  padiStatus.value()?.expectedKaval;

/** True when the running kaval daemon is provably a build behind the server's
 *  expected build. Reads padi's `status` cell (`status.expectedKaval`) and the
 *  live `daemonStatus`. Floored on transport liveness: over a dead/half-open
 *  link the retained daemon identity is stale, so the nudge cannot honestly fire. */
export const kavalUpdatePending = (): boolean => {
  const status = localDaemonStatus();
  return kavalStale(
    expectedKaval()?.staleKey,
    status?.identity?.staleKey,
    status?.state,
    daemonChannelLive(),
  );
};
