/**
 * oRPC router: composes the surface router fragment (`./surface.ts`) with the
 * two hand-listed raw oRPC handlers that stay kolu-server's own — `server.info`
 * (synchronous per-host branding) and `daemon.restart`.
 *
 * The typed reactive layer goes through `surfaceRouter` (from `./surface.ts`)
 * and `surfaceCtx` (from `@kolu/padi/assembly`). The terminal domain's raw
 * procedures relocated onto `@kolu/padi`'s `padiSurface` across W1.R; the root
 * `terminal.*` / `git.*` handlers this file once carried were DELETED at W1.R7
 * (the package-boundary seal). This file is now just the glue between the surface
 * fragment and the two remaining raw RPCs.
 */

import { serverHostname } from "./hostname.ts";
import { log } from "./log.ts";
import { restartLocalDaemon } from "@kolu/padi/assembly";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { surfaceRouter, t } from "./surface.ts";

export const appRouter = t.router({
  ...surfaceRouter,
  server: {
    // Per-host BRANDING the shell needs synchronously at boot (document title,
    // watermark, PWA theme color). The restart axis (`processId`) and the build
    // identity (`commit`) moved to the surface, owned by @kolu/surface-app — see
    // `surface.ts`. The kaval identities ride padi's `status` cell + `daemonStatus`
    // collection.
    info: t.server.info.handler(async () => ({
      identity: pwaIdentityForHostname(serverHostname),
    })),
  },
  daemon: {
    restart: t.daemon.restart.handler(async () => {
      log.info({}, "kaval restart requested");
      await restartLocalDaemon();
    }),
  },
});
