/**
 * The app's reactive surfaces — surface-app's build-identity surface served as a
 * SIBLING of the app's OWN live surface, multiplexed over one transport. They
 * are NOT merged: surface-app is already a complete surface (its `buildInfo`
 * cell + `identity.info` restart probe), so the app serves it under the
 * `surfaceApp` key alongside its own `demo` surface (the live `serverStats`
 * cell). One transport, two independent surfaces, each namespaced by its key —
 * this is the composition the example exists to show.
 */

import { composeSurfaceContracts, defineSurface } from "@kolu/surface/define";
import {
  defineBuildInfo,
  surfaceAppSurfaceWith,
} from "@kolu/surface-app/surface";
import { Schema } from "effect";

/** The example EXTENDS the default `{ commit }` build identity with a `bootId`
 *  axis that the server only learns *asynchronously at boot* — standing in for
 *  kolu's pty-host `system.version`, which settles over an in-process link after
 *  the cell is already seeded. This is the interface in action: drishti takes
 *  the default `{ commit }`, the example (like kolu) adds an axis, both ride the
 *  same fragment. isStale omitted: the library default IS the clean-ref commit
 *  comparison, which is exactly what we want; bootId is informational (rendered
 *  in the rail), not a staleness axis. */
export const buildInfo = defineBuildInfo({
  schema: Schema.Struct({ commit: Schema.String, bootId: Schema.String }),
  default: { commit: "", bootId: "" },
});
export type ExampleBuildInfo = typeof buildInfo.cells.buildInfo.schema.Type;

/** App-specific live server state — pushed by the server every second (the
 *  clock) and on every connect/disconnect (the client count). See server/main.ts. */
export const ServerStatsSchema = Schema.Struct({
  startedAt: Schema.Number,
  now: Schema.Number,
  connections: Schema.Number,
});
export type ServerStats = typeof ServerStatsSchema.Type;

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
 *  in its own right, served as a sibling under the `demo` key. */
export const demoSurface = defineSurface({
  cells: {
    serverStats: { schema: ServerStatsSchema, default: EMPTY_STATS },
  },
});

/** The two siblings, keyed: `surfaceApp` (the @kolu/surface-app surface) and
 *  `demo` (this example's own). Both server (`implementSurfaces`) and client
 *  (`surfaceClients`) iterate this same map, so the keys can't drift. */
export const surfaces = {
  surfaceApp: surfaceAppSurface,
  demo: demoSurface,
} as const;

/** The two siblings composed into ONE flat wire group. Every member is minted at
 *  `surface/<key>/<member>/<verb>`, so the two surfaces cannot collide — not
 *  even on the three framework-reserved `system/*` members every surface
 *  carries. The server serves `implementSurfaces`' `{ group, handlers }`; the
 *  client's `websocketLink` is built over `composed.group`, and `surfaceClients`
 *  slices the one dispatch per key. */
export const composed = composeSurfaceContracts(surfaces);
