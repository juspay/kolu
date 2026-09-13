/**
 * Port detection — one host-wide osfacts scan + its sampler cadence.
 *
 * Not port-forwarding (`@kolu/port-forward` is its own package). This subdir
 * answers two questions from one pass: "which TCP listeners does each terminal's
 * subtree hold?" (each terminal's `ports` channel) and "which listeners are on
 * this host at all?" (padi's `hostListeners` cell). `scan.ts` is the OS ask and
 * its folds; `sampler.ts` is the 5 s / nudge poll that publishes both.
 */

export {
  addressBind,
  osfactsBinPath,
  partitionSubtrees,
  PortScanError,
  type ProcessRow,
  PORT_SCAN_COMMAND_TIMEOUT_MS,
  portScanSupported,
  type PortScan,
  scanPorts,
  unreadablePolicy,
} from "./scan.ts";
export {
  createPortSampler,
  nudgeFloorMs,
  PORT_SCAN_INTERVAL_MS,
  type PortSampler,
  type PortScanTarget,
} from "./sampler.ts";
