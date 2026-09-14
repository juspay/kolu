/**
 * The ACTIVE host's listeners — every TCP listener padi's scanner sees on the
 * machine the inspected terminal lives on, including servers that detached
 * from every terminal.
 *
 * A HOOK, called inside its readers' own owners (the Ports section, the
 * printed-URL card), not an app-lifetime subscription: the reading carries a
 * command line per listener, and the re-serve path (an ssh leg for a remote host)
 * need not carry it while neither reader is on screen. It re-keys when the active
 * host switches. `unknown` until the cell's first frame lands: a reading that has
 * not arrived is "we have not looked", and every reader has an honest arm for it.
 */

import {
  type HostListeners,
  UNKNOWN_HOST_LISTENERS,
} from "kolu-common/surface";
import { activeHost, padiMap } from "../wire";

export function useHostListeners(): () => HostListeners {
  const sub = padiMap.useEntry(activeHost).cells.hostListeners.use();
  return () => sub.value() ?? UNKNOWN_HOST_LISTENERS;
}
