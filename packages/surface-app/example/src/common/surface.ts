/**
 * The app's reactive surface — surface-app's build-identity cell composed with
 * the app's OWN live cell. `...buildInfo.cells` is surface-app-specific (the
 * shell's build identity); `serverStats` is app-specific (live server state).
 * One `defineSurface`, both kinds of state, one wire — this is the composition
 * the example exists to show.
 */

import { defineSurface } from "@kolu/surface/define";
import {
  composeSurfaces,
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

// One surface, composed in a single call: surface-app's fragment (the shell's
// build identity `buildInfo` cell — extended here with `bootId` — plus the
// `surface.surfaceApp.info` restart probe) merged with the app's OWN spec
// (`serverStats`). No separate `...buildInfo.cells` + `...serverIdentity.procedures`
// spreads — `surfaceAppSurfaceWith(buildInfo)` carries both halves.
export const surface = defineSurface(
  composeSurfaces(surfaceAppSurfaceWith(buildInfo), {
    cells: {
      serverStats: {
        // app-specific — live server stats
        schema: ServerStatsSchema,
        default: EMPTY_STATS,
      },
    },
  }),
);
