import { type HostKey, hostKeysEqual } from "kolu-common/hostKey";
import { exitConductorMode } from "../conductor/useConductorMode";
import { activeHost, setActiveHost } from "../wire";

export function selectHostTab(host: HostKey): void {
  exitConductorMode();
  if (!hostKeysEqual(activeHost(), host)) setActiveHost(host);
}
