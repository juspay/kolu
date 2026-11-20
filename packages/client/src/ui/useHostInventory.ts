import type { RunningKaval, RunningPadi } from "kolu-common/surface";
import { createRoot } from "solid-js";
import { type DaemonScan, daemonScanCause } from "../host/daemonScan";
import { daemonChannelLive } from "../kaval/useDaemonStatus";
import { activeHost, padiMap } from "../wire";

const sub = createRoot(() =>
  padiMap.useEntry(activeHost).cells.hostInventory.use(),
);

/** Every running kaval daemon on the BOUND host, each marked `active` when that host's
 *  padi owns it (empty before the first scan). */
export function boundHostKavals(): readonly RunningKaval[] {
  return sub.value()?.kavals ?? [];
}

/** Every running padi daemon on the BOUND host, each marked `active` when it is the one
 *  kolu is bound to (empty before the first scan). */
export function boundHostPadis(): readonly RunningPadi[] {
  return sub.value()?.padis ?? [];
}

/** The bound host's daemon-scan liveness as a discriminated cause — a total
 *  fold over the active host's entry state and whether a real frame has landed
 *  (a live padi always reports itself, so an absent active padi row means no
 *  frame rather than a genuine zero). */
export function boundHostScan(): DaemonScan {
  return daemonScanCause(padiMap.entry(activeHost()).state(), {
    bindLive: daemonChannelLive(),
    framePresent: boundHostPadis().some((p) => p.active),
  });
}

/** Whether the bound host's inventory is a trustworthy live reading, derived
 *  from the single {@link boundHostScan} fold. */
export function boundHostInventoryLive(): boolean {
  return boundHostScan().kind === "live";
}

/** The bound padi kolu is using (`active`), or `undefined` before the first
 *  scan. */
export function activePadi(): RunningPadi | undefined {
  return boundHostPadis().find((p) => p.active);
}
