/** Select a host tab — the ONE verb behind every tab-row pick.
 *
 *  Two things happen together, and they have to: the host becomes the active
 *  one, and the `◆ Conductor` tab at the head of the same row is
 *  deselected. Spelling that at each call site is how the row comes to have two
 *  selected entries — a chip picked while the conversation is on screen would
 *  switch the canvas underneath and leave the chat covering it.
 *
 *  The already-active host is NOT a no-op here: clicking the tab you are
 *  already on, while looking at the conductor, is exactly how a person asks
 *  to go back to it. What stays guarded is the WRITE — re-writing `activeHost`
 *  with a new-reference-but-equal key would re-notify every
 *  `useEntry(activeHost)` consumer for nothing.
 *
 *  The guard is the SETTER's updater form, not a read of `activeHost`: this
 *  verb is called from effect callbacks (`useDeepLinks`, `useAttention`'s
 *  jump, the conductor's open-tile), and an effect callback is a strict-read
 *  window — reading the signal here would report STRICT_READ_UNTRACKED at
 *  every one of those call sites. An updater is handed the current value
 *  without reading the signal, and returning that same value is an equal
 *  write, which notifies nobody. */

import { type HostKey, hostKeysEqual } from "kolu-common/hostKey";
import { exitConductorMode } from "../conductor/useConductorMode";
import { setActiveHost } from "../wire";

export function selectHostTab(host: HostKey): void {
  exitConductorMode();
  setActiveHost((current) => (hostKeysEqual(current, host) ? current : host));
}
