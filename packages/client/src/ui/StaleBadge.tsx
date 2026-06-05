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
import type { Component } from "solid-js";
import type { KoluBuildInfo } from "kolu-common/surface";

/** True when this browser's build provably differs from the server's. Reads the
 *  surface-app model — must be called under `<SurfaceAppProvider>`. Gate the chip
 *  on this: `<Show when={clientStale()}><StaleBadge /></Show>`. */
export const clientStale = (): boolean =>
  useSurfaceApp<KoluBuildInfo>().stale();

/** The compact `≠ srv` warning chip — kolu's own chrome. */
export const StaleBadge: Component = () => (
  <span class="self-center rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning">
    ≠ srv
  </span>
);
