/**
 * The app's reactive surfaces — surface-app's build-identity surface served as a
 * SIBLING of the app's OWN live surface, multiplexed over one transport. They
 * are NOT merged: surface-app is already a complete surface (its `buildInfo`
 * cell + `identity.info` restart probe), so the app serves it under the
 * `surfaceApp` key alongside its own `app` surface (the live `serverStats`
 * cell). One transport, two independent surfaces, each namespaced by its key —
 * this is the composition the example exists to show.
 */

import { defineSurface } from "@kolu/surface/define";
import { composeSurfaceContracts } from "@kolu/surface/server";
import {
  defineBuildInfo,
  surfaceAppSurfaceWith,
} from "@kolu/surface-app/surface";
import { z } from "zod";

/** The example EXTENDS the default `{ commit }` build identity with a `bootId`
 *  axis that the server only learns *asynchronously at boot* — standing in for
 *  kolu's pty-host `system.version`, which settles over an in-process link after
 *  the cell is already seeded. This is the interface in action: drishti takes
 *  the default `{ commit }`, the example (like kolu) adds an axis, both ride the
 *  same fragment. isStale omitted: the library default IS the clean-ref commit
 *  comparison, which is exactly what we want; bootId is informational (rendered
 *  in the rail), not a staleness axis. */
export const buildInfo = defineBuildInfo({
  schema: z.object({ commit: z.string(), bootId: z.string() }),
  default: { commit: "", bootId: "" },
});
export type ExampleBuildInfo = z.infer<typeof buildInfo.cells.buildInfo.schema>;

/** App-specific live server state — pushed by the server every second (the
 *  clock) and on every connect/disconnect (the client count). See server/main.ts. */
export const ServerStatsSchema = z.object({
  startedAt: z.number(),
  now: z.number(),
  connections: z.number(),
});
export type ServerStats = z.infer<typeof ServerStatsSchema>;

export const EMPTY_STATS: ServerStats = {
  startedAt: 0,
  now: 0,
  connections: 0,
};

/** surface-app's standalone surface, extended with the example's `bootId` axis.
 *  Served as a sibling under the `surfaceApp` key — its `buildInfo` cell drives
 *  the rail and its `identity.info` probe drives the connection lifecycle. */
export const surfaceAppSurface = surfaceAppSurfaceWith(buildInfo);

/** The app's OWN surface — just the live `serverStats` cell. A complete surface
 *  in its own right, served as a sibling under the `app` key. */
export const appSurface = defineSurface({
  cells: {
    serverStats: { schema: ServerStatsSchema, default: EMPTY_STATS },
  },
});

/** The two siblings, keyed. Both server (`implementSurfaces`) and client
 *  (`surfaceClients`) iterate this same map, so the keys can't drift. */
export const surfaces = {
  surfaceApp: surfaceAppSurface,
  app: appSurface,
} as const;

/** The combined wire contract — `{ surface: { surfaceApp, app } }`. The server
 *  wraps `implementSurfaces`' router with `implement(contract).router(...)`; the
 *  client types its `websocketLink` off `typeof contract`. */
export const contract = composeSurfaceContracts(surfaces);
