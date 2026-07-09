/** Accessor for the active host's expected kaval identity — the build padi would
 *  spawn on restart. Host-first chrome keeps the dual-daemon slot icon+dot only;
 *  update detail rides each host-chip Kaval tooltip and {@link KavalInfoDialog}.
 *  Session-preserving Restart-kaval lives in that dialog (`RestartKavalButton`).
 *
 *  The derivation ({@link kavalStale}) is a read-site join of two raw facts —
 *  `expected` (padi's `status.expectedKaval`) and `reported` (the connected
 *  daemon's `daemonStatus.identity`) — never stored, never folded into the
 *  client-vs-server `≠ srv` signal (which stays the commit comparison). */

import type { PadiStatus } from "@kolu/padi/surface";
import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { activeHost, padiMap } from "../wire";

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
 *  Named once here so the active-host dialog's running-vs-expected commit links
 *  and "what changed" history link join the surface path through one accessor. */
export const expectedKaval = (): PadiStatus["expectedKaval"] =>
  padiStatus.value()?.expectedKaval;
