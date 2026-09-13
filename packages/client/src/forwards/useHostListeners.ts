/**
 * The ACTIVE host's listeners — every TCP listener padi's scanner sees on the
 * machine the inspected terminal lives on, including servers that detached
 * from every terminal.
 *
 * One app-lifetime subscription, re-keyed when the active host switches, read by
 * the Ports section and the printed-URL card alike. `unknown` until the cell's
 * first frame lands: a reading that has not arrived is "we have not looked", and
 * every reader already has an honest arm for that.
 */

import {
  type HostListeners,
  UNKNOWN_HOST_LISTENERS,
} from "kolu-common/surface";
import { createRoot } from "solid-js";
import { activeHost, padiMap } from "../wire";

const sub = createRoot(() =>
  padiMap.useEntry(activeHost).cells.hostListeners.use(),
);

export function activeHostListeners(): HostListeners {
  return sub.value() ?? UNKNOWN_HOST_LISTENERS;
}
