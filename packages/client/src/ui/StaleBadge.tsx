/** The `≠ srv` chip + kolu's accessor for "this browser's bundle is behind the
 *  server's build", reused by the desktop `IdentityRail` and the mobile chrome
 *  (`MobileTileView` handle + `MobileChromeSheet`) so the signal looks and means
 *  the same everywhere.
 *
 *  The staleness DERIVATION is no longer kolu's — it's `@kolu/surface-app`'s
 *  headless model (`useSurfaceApp().stale()`), driven by `koluBuildInfo`'s
 *  clean-ref-guarded commit comparison (a dev / dirty build never
 *  false-positives). kolu owns only the tailwind CHROME below — surface-app
 *  ships no styled components. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import type { Component } from "solid-js";
import { daemonTransportLive } from "../kaval/useDaemonStatus";

/** True when this browser's build provably differs from the server's. Reads the
 *  surface-app model — must be called under `<SurfaceAppProvider>`. Gate the chip
 *  on this: `<Show when={clientStale()}><StaleBadge /></Show>`.
 *
 *  FLOORED on `daemonTransportLive()` (#1793): the "differs from server" verdict compares
 *  the client build to the SERVER's build, which rides the ws that a dead/half-open
 *  transport freezes stale. Over a dead transport we can't confirm the comparison, so this
 *  reads `false` — no "≠ srv" badge and no reload affordance asserted off a retained server
 *  build. Every consumer (both mobile chromes, the Kolu dialog badge, the rail) inherits the
 *  floor by construction. */
export const clientStale = (): boolean =>
  daemonTransportLive() && useSurfaceApp<KoluBuildInfo>().stale();

/** The compact `≠ srv` warning chip — kolu's own chrome. */
export const StaleBadge: Component = () => (
  <span class="self-center rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning">
    ≠ srv
  </span>
);
