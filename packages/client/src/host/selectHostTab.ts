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
 *  write, which notifies nobody.
 *
 *  That updater reaches the PERSISTED setter either way, so a click on the
 *  already-active tab writes the same host string to `sessionStorage` where
 *  the read-guard would have returned first. Nothing observes that write:
 *
 *   - the signal write is equal, so it notifies no reader;
 *   - this pref passes no `sync` (`wire.ts`'s `activeHost`), so
 *     `makePersisted` announces it to nobody;
 *   - `setItem` with a value identical to the stored one returns before
 *     mutating the map (HTML Standard), so no `storage` event is fired —
 *     and `sessionStorage` is per browser tab, so it has no other page to
 *     tell in the first place. */

import { type HostKey, hostKeysEqual } from "kolu-common/hostKey";
import { flush } from "solid-js";
import { exitConductorMode } from "../conductor/useConductorMode";
import { setActiveHost } from "../wire";

export function selectHostTab(host: HostKey): void {
  exitConductorMode();
  setActiveHost((current) => (hostKeysEqual(current, host) ? current : host));
}

/** LAND the host switch just made, for a handler that switches and then runs a
 *  verb which resolves the ACTIVE host's scope in the same step (a palette
 *  fleet row, the Conductor's open-tile, the attention jump, the
 *  notification-click router).
 *
 *  A Solid 2 write is STAGED until the next flush, and outside a flush every
 *  reader — memos included — is served the committed value. The active-host
 *  scope is a chain of those (`activeHost → activated → index → activeScope`,
 *  `surface-map`'s `scopedByEntry`), so a landing verb in the same handler
 *  resolves the host being LEFT: `store.activate` writes the foreign id into
 *  the departing host's focus, visit trail and `chrome.setActive` report, and a
 *  metadata-gated landing (`useDockFocus`) cannot find the id at all and toasts
 *  "Terminal no longer exists". On Solid 1 that chain recomputed before the
 *  setter returned, which is the behaviour this restores.
 *
 *  Call it ONLY from an imperative boundary (a DOM event handler, an OS
 *  notification click): `flush()` throws inside an action or a tracked-effect
 *  callback. A caller that switches from an EFFECT must instead act on the
 *  settle, the way `useDeepLinks` gates on "the active host IS the route's
 *  host".
 *
 *  While a flush is already running, `flush()` returns without doing anything.
 *  The one caller that can land there is a notification click handled during
 *  the first render, before any host scope exists; it finds nothing to land
 *  on, exactly as on master. */
export function landHostSwitch(): void {
  flush();
}
