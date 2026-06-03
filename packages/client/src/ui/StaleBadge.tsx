/** The `≠ srv` chip and its staleness derivation — the single source of "this
 *  browser's bundle is out of sync with the server", reused by the desktop
 *  `IdentityRail` and the mobile chrome (`MobileTileView` handle +
 *  `MobileChromeSheet`) so the signal looks and means the same everywhere.
 *
 *  `clientStale()` is true only when both the server commit and this build's
 *  baked-in `__KOLU_COMMIT__` are clean refs and differ (see `commitRef`), so a
 *  dev / dirty build never false-positives into a perpetual warning. */

import type { Component } from "solid-js";
import { serverInfo } from "../rpc/rpc";
import { clientIsStale } from "./commitRef";

/** True when this browser's build commit provably differs from the server's.
 *  Gate the chip on this: `<Show when={clientStale()}><StaleBadge /></Show>`. */
export const clientStale = (): boolean =>
  clientIsStale(serverInfo()?.commit, __KOLU_COMMIT__);

/** The compact `≠ srv` warning chip. */
export const StaleBadge: Component = () => (
  <span class="self-center rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning">
    ≠ srv
  </span>
);
