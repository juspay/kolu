import {
  type HostListeners,
  UNKNOWN_HOST_LISTENERS,
} from "kolu-common/surface";
import { activeHost, padiMap } from "../wire";

export function useHostListeners(): () => HostListeners {
  const sub = padiMap.useEntry(activeHost).cells.hostListeners.use();
  return () => sub.value() ?? UNKNOWN_HOST_LISTENERS;
}
