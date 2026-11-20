import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import type { Component } from "solid-js";
import { daemonTransportLive } from "../kaval/useDaemonStatus";

/** True when this browser's build provably differs from the server's. Must be
 *  called under `<SurfaceAppProvider>`. Reads `false` over a dead transport. */
export const clientStale = (): boolean => {
  const stale = useSurfaceApp<KoluBuildInfo>().stale();
  return daemonTransportLive() && stale;
};

/** The server's build (version, commit) while the transport is live, and
 *  `undefined` over a dead one — a retained build never outlives the
 *  connection it was read over. Must be called under `<SurfaceAppProvider>`. */
export const liveServerBuild = () => {
  const server = useSurfaceApp<KoluBuildInfo>().server();
  return daemonTransportLive() ? server : undefined;
};

/** The compact `≠ srv` warning chip — kolu's own chrome. */
export const StaleBadge: Component = () => (
  <span class="self-center rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning">
    ≠ srv
  </span>
);
