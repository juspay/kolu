/**
 * oRPC router assembly: composes the surface router (kolu + surfaceApp +
 * RE-SERVED padi) with the two hand-listed raw oRPC handlers that stay
 * kolu-server's own — `server.info` (synchronous per-host branding) and
 * `daemon.restart`.
 *
 * Because the `padi` sibling is now RE-SERVED off an `await`ed binding (see
 * `padiBinding.ts` + `index.ts`'s async boot), the surface router can only be
 * assembled after boot — so this file exports a `buildAppRouter(...)` the async
 * boot calls with the spliced surface router, rather than a module-eval
 * `appRouter`. The typed reactive layer goes through that surface router; this
 * file is the glue between it and the two remaining raw RPCs.
 *
 * `daemon.restart` was re-targeted at the cutover: kolu-server no longer holds a
 * kaval endpoint (kaval lives inside the padi PROCESS). "Restart" now DRAINS the
 * bound padi (persist + exit; the PTYs survive in kaval) through the frozen
 * control core, and the binder's reconnect loop re-spawns padi onto its surviving
 * kaval. The UI label may still read "Restart kaval" — the mechanism restarts the
 * padi that OWNS kaval.
 */

import type { HostKey } from "kolu-common/hostKey";
import { serverHostname } from "./hostname.ts";
import { log } from "./log.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { t } from "./surface.ts";

export interface BuildAppRouterDeps {
  /** The assembled surface router — `{ surface: { kolu, surfaceApp, padi } }`,
   *  the kolu+surfaceApp fragment spliced with the re-served padi sibling. */
  surfaceRouter: { surface: Record<string, unknown> };
  /** Drain the bound padi — the re-targeted "restart" (persist + exit; kaval + its
   *  PTYs survive; the reconnect loop re-spawns padi). */
  drainBoundPadi: () => Promise<void>;
  /** Add a padi host to the warm pool at runtime (the strip's "+ add host"). Re-adding
   *  an existing member rejects loudly (`host already exists`), never a silent no-op
   *  (surfaced to the strip as a rejected call — see the `hosts.add` handler below). */
  addHost: (host: HostKey) => Promise<void>;
  /** Remove a guest host from the pool (its map subs end typed, its session is
   *  destroyed). Throws `UnremovableHostError` for the unremovable default. */
  removeHost: (host: HostKey) => Promise<void>;
  /** Force a held host to RE-DIAL now (the host-down card's [Reconnect]). Forwards
   *  to the host's `session.recheck()` (force-cycle the held connection through the
   *  reconnect loop) — the recovery verb a STANDING refuse needs once its cause is
   *  cleared, since a refuse holds degraded without auto-reconnecting. Throws for an
   *  unknown host. */
  reconnectHost: (host: HostKey) => void;
}

/** Assemble the full host router from the surface router + the two raw RPCs.
 *  Called from `index.ts`'s async boot once the padi binding is up. */
export function buildAppRouter(deps: BuildAppRouterDeps) {
  return t.router({
    // The surface router is assembled DYNAMICALLY — the kolu+surfaceApp fragment
    // spliced with the re-served padi sub-router — a shape oRPC's typed builder
    // can't verify statically, though the runtime shape matches `servedContract`.
    // biome-ignore lint/suspicious/noExplicitAny: dynamic surface-router splice; runtime shape is a valid router (proved by the padiBinding integration test dialing /surface/padi/*).
    ...(deps.surfaceRouter as any),
    server: {
      // Per-host BRANDING the shell needs synchronously at boot (document title,
      // watermark, PWA theme color). The restart axis (`processId`) and the build
      // identity (`commit`) moved to the surface, owned by @kolu/surface-app — see
      // `surface.ts`. The kaval identities ride padi's `status` cell + `daemonStatus`
      // collection (re-served off the bound padi).
      info: t.server.info.handler(async () => ({
        // The browser tab title + About dialog read `Kolu [<serverHost>]` — this
        // kolu-server's OWN host. Under always-map which host a tab views is a
        // client-side strip selection, not a server fact, so the identity no longer
        // folds a remote host into the name.
        identity: pwaIdentityForHostname(serverHostname),
      })),
    },
    daemon: {
      restart: t.daemon.restart.handler(async () => {
        log.info({}, "padi restart requested — draining the bound padi");
        // Drain the bound padi through the frozen control core: it persists its
        // layout and exits, its kaval + PTYs survive, and the binder's reconnect
        // loop re-spawns padi onto the surviving kaval. NEVER a kill-9.
        await deps.drainBoundPadi();
      }),
    },
    hosts: {
      // Runtime pool membership — the selector strip's add/remove. The handler
      // forwards to the pool; `index.ts` owns the fail-loud unremovable-default guard
      // (a `remove` of LOCAL_HOST / the boot default throws `UnremovableHostError`,
      // which surfaces to the strip as a rejected call, never a silent no-op).
      add: t.hosts.add.handler(async ({ input }) => {
        log.info({ host: input.host }, "host add requested");
        await deps.addHost(input.host);
      }),
      remove: t.hosts.remove.handler(async ({ input }) => {
        log.info({ host: input.host }, "host remove requested");
        await deps.removeHost(input.host);
      }),
      reconnect: t.hosts.reconnect.handler(async ({ input }) => {
        log.info({ host: input.host }, "host reconnect requested");
        deps.reconnectHost(input.host);
      }),
    },
  });
}
