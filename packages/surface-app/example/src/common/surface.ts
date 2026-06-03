/**
 * The app's reactive surface — surface-app's build-identity cell composed with
 * the app's OWN live cell. `...buildInfo.cells` is surface-app-specific (the
 * shell's build identity); `serverStats` is app-specific (live server state).
 * One `defineSurface`, both kinds of state, one wire — this is the composition
 * the example exists to show.
 */

import { defineSurface } from "@kolu/surface/define";
import { buildInfo } from "@kolu/surface-app/surface";
import { z } from "zod";

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

export const surface = defineSurface({
  cells: {
    ...buildInfo.cells, // surface-app-specific — the shell's build identity
    serverStats: {
      // app-specific — live server stats
      schema: ServerStatsSchema,
      default: EMPTY_STATS,
    },
  },
});
