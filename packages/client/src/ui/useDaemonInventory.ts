import type {
  PadiConvergence,
  RunningKaval,
  RunningPadi,
} from "kolu-common/surface";
import { createRoot } from "solid-js";
import { daemonTransportLive } from "../kaval/useDaemonStatus";
import { app } from "../wire";

const sub = createRoot(() => app.cells.daemonInventory.use());

/** The ssh host kolu-server's padi is bound to (`KOLU_PADI_HOST`), or `null`
 *  for a LOCAL binding / before the first enumeration. */
export function daemonScanBoundHost(): string | null {
  if (!daemonTransportLive()) return null;
  const binding = sub.value()?.binding;
  return binding?.kind === "remote" ? binding.host : null;
}

/** kolu-server's scan of the machine it itself runs on — every running kaval
 *  there, none marked active. Non-empty only under a remote binding. */
export function localScanKavals(): readonly RunningKaval[] {
  const binding = sub.value()?.binding;
  return binding?.kind === "remote" ? binding.localScan.kavals : [];
}

/** The same scan for padi daemons. Non-empty only under a remote binding. */
export function localScanPadis(): readonly RunningPadi[] {
  const binding = sub.value()?.binding;
  return binding?.kind === "remote" ? binding.localScan.padis : [];
}

/** The bound padi's standing convergence anomaly (adopted-stale build /
 *  contract skew / drain- or link-failure), or `null` when converged. Remote
 *  arm only, and `null` over a dead transport. */
export function boundPadiConvergence(): PadiConvergence | null {
  if (!daemonTransportLive()) return null;
  return sub.value()?.boundPadi?.convergence ?? null;
}
