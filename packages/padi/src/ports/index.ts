/**
 * Port detection — osfacts scan + host-wide sampler cadence.
 *
 * Not port-forwarding (`@kolu/port-forward` is its own package). This subdir is
 * "which TCP listeners belong to which terminal subtrees?": the OS ask
 * (`scan.ts`) and the 5 s / nudge poll (`sampler.ts`) that feed the
 * terminalWorkspace ports channel.
 */

export {
  createPortSampler,
  nudgeFloorMs,
  PORT_SCAN_INTERVAL_MS,
  type PortSampler,
  type PortScanTarget,
} from "./sampler.ts";
export {
  addressBind,
  osfactsBinPath,
  PORT_SCAN_COMMAND_TIMEOUT_MS,
  PortScanError,
  type ProcessRow,
  partitionSubtrees,
  portScanSupported,
  scanSubtreePorts,
  unreadablePolicy,
} from "./scan.ts";
