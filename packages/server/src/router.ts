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

import { LOCAL_HOST } from "kolu-common/contract";
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
  /** The host a tab binds when it names none (`KOLU_PADI_HOST` ?? local) — served
   *  on `server.info` so a tab picks its initial binding at boot (W4). */
  defaultHost: string;
  /** THIS router's host (A2). `server.info`'s identity is labelled from it — so a
   *  tab on host A titles itself `Kolu [<srv> → A]`, not the boot default's name.
   *  Local → no arrow (`Kolu [<srv>]`). Each per-host router carries its own. */
  host: string;
  /** The warm-pool control plane (W4). `add`/`remove` operate on the SHARED pool
   *  — every per-host handler serves the same two verbs, so a tab on any host can
   *  add another before switching to it. */
  hosts: {
    add: (host: string) => Promise<void>;
    remove: (host: string) => Promise<void>;
  };
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
        // A2 — label the identity from THIS router's host, not the boot default's
        // `remotePadiHost()`: a tab on host A reads `Kolu [<serverHost> → A]`, a tab
        // on local reads the byte-identical `Kolu [<serverHost>]` (no arrow). Passing
        // the host explicitly overrides `pwaIdentityForHostname`'s `remotePadiHost()`
        // default, which would otherwise stamp every host's tab with the boot default.
        identity: pwaIdentityForHostname(
          serverHostname,
          deps.host === LOCAL_HOST ? undefined : deps.host,
        ),
        defaultHost: deps.defaultHost,
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
    // W4 "the switch": the warm-pool control plane. The (Debug-only) picker calls
    // `add` BEFORE opening a `?host=<host>` socket — a deliberate two-step so a
    // stray query param never provisions ssh as a side-effect of a GET.
    hosts: {
      add: t.hosts.add.handler(async ({ input }) => {
        log.info({ host: input.host }, "pool: add host");
        await deps.hosts.add(input.host);
      }),
      remove: t.hosts.remove.handler(async ({ input }) => {
        log.info({ host: input.host }, "pool: remove host");
        await deps.hosts.remove(input.host);
      }),
    },
  });
}
