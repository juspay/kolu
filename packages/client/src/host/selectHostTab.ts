/** Select a host tab — the ONE verb behind every tab-row pick.
 *
 *  Two things happen together, and they have to: the host becomes the active
 *  one, and the `◆ Conductor` entry sitting at the end of the same row is
 *  deselected. Spelling that at each call site is how the row comes to have two
 *  selected entries — a chip picked while the conversation is on screen would
 *  switch the canvas underneath and leave the chat covering it.
 *
 *  The already-active host is NOT a no-op here: clicking the tab you are
 *  already on, while looking at the conductor, is exactly how a person asks
 *  to go back to it. What stays guarded is the WRITE — re-writing `activeHost`
 *  with a new-reference-but-equal key would re-notify every
 *  `useEntry(activeHost)` consumer for nothing. */

import { type HostKey, hostKeysEqual } from "kolu-common/hostKey";
import { exitConductorMode } from "../conductor/useConductorMode";
import { activeHost, setActiveHost } from "../wire";

export function selectHostTab(host: HostKey): void {
  exitConductorMode();
  if (!hostKeysEqual(activeHost(), host)) setActiveHost(host);
}
