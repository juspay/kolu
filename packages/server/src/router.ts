/**
 * The ROOT procedures' handlers — the five-plus-two raw RPCs that stay
 * kolu-server's own (`server/info`, `daemon/restart`, `hosts/*`), bound as one
 * {@link ServedFragment} the boot merges with the two surface fragments (kolu's
 * own siblings and the re-served padi host map) in `surface.ts`.
 *
 * Under Effect RPC the wire namespace is FLAT, so this file no longer "assembles a
 * router": there is nothing to nest and nothing to re-adapt. Each handler is bound
 * at its own tag (`koluRootGroup`'s seven), and a tag carries its own route. The
 * `implement(servedContract)` builder this file used to bind against is retired —
 * the widening it existed for is `surface.ts`'s `servedGroup` merge, and the
 * silent-drop it protected against is now an import-time tag-count assertion plus
 * `assembleServedHandlers`'s route-set identity check.
 *
 * `daemon/restart` was re-targeted at the cutover: kolu-server no longer holds a
 * kaval endpoint (kaval lives inside the padi PROCESS). "Restart" now DRAINS the
 * bound padi (persist + exit; the PTYs survive in kaval) through the frozen
 * control core, and the binder's reconnect loop re-spawns padi onto its surviving
 * kaval. The UI label may still read "Restart kaval" — the mechanism restarts the
 * padi that OWNS kaval.
 */

import type { SurfaceHandlers } from "@kolu/surface/server";
import { Context, Effect } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { koluRootGroup } from "kolu-common/contract";
import type { HostRef, ViewerHost } from "kolu-common/contract";
import type { HostKey } from "kolu-common/hostKey";
import { serverHostname } from "./hostname.ts";
import { log } from "./log.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import type { ServedFragment } from "./surface.ts";

/** The per-CALLER connection facts `hosts/viewer` answers from — the one place in
 *  kolu-server where a handler needs to know WHICH connection it is serving.
 *
 *  It is a service, not an argument, because Effect RPC has no per-request context
 *  bag: the transport mount provides it per CONNECTION. `index.ts` builds a
 *  `Layer.succeed(CurrentViewer)({…})` from the upgrade request's peer address and
 *  `x-forwarded-for` header, and hands that layer to `serveSurfaceSocket` — so each
 *  websocket's RPC serving stack carries its own viewer facts and a broadcast
 *  surface cell (which could not differ per viewer) is not needed.
 *
 *  BOTH facts, deliberately: behind a reverse proxy the TCP peer is the PROXY and
 *  the viewer's own address is in the header. Reading only the peer is why this
 *  feature never fired once on the real deployment. Which of the two to BELIEVE is
 *  a judgment with a security gate on it, so it lives in
 *  `portForward/resolveViewerHost.ts`, never here. */
export class CurrentViewer extends Context.Service<
  CurrentViewer,
  {
    /** The direct TCP peer of this connection, or `undefined` when the adapter
     *  cannot tell. Never a guess — an absent address answers `null`. */
    readonly viewerAddress: string | undefined;
    /** This connection's `x-forwarded-for` header, or `undefined` when unproxied.
     *  `undefined` and `""` are different facts downstream, so the mount must not
     *  flatten them. */
    readonly forwardedFor: string | undefined;
  }
>()("kolu-server/CurrentViewer") {}

export interface BuildAppRouterDeps {
  /** Drain the bound padi — the re-targeted "restart" (persist + exit; kaval + its
   *  PTYs survive; the reconnect loop re-spawns padi). */
  drainBoundPadi: () => Promise<void>;
  /** Add a padi host to the warm pool at runtime (the strip's "+ add host"). Re-adding
   *  an existing member rejects loudly (`host already exists`), never a silent no-op
   *  (surfaced to the strip as a rejected call — see the `hosts/add` handler below). */
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
  /** Update & restart a host's daemon stack (the contract-skew recovery, SK5):
   *  forwards to that host's `padiSession.renew()` — the binder-owned drain →
   *  re-dial → re-realise pipeline. Throws for an unknown host. */
  renewHostDaemon: (host: HostKey) => Promise<void>;
  /** WHICH pool host this connection is sitting at, or `null` when none is or
   *  kolu cannot tell. `null` is the answer for every uncertain case — it leaves
   *  the port chip's forward exactly as it was.
   *
   *  Takes BOTH the direct peer and the forwarded header because behind a
   *  reverse proxy they name different machines, and only the implementation
   *  (which knows this host's own addresses) can decide which to believe. */
  viewerHost: (connection: {
    peerAddress: string | undefined;
    forwardedFor: string | undefined;
  }) => Promise<HostKey | null>;
}

/** Bind the root procedures. Called from `index.ts`'s async boot (and from the
 *  tests, which dispatch the returned handlers directly).
 *
 *  Every handler returns an `Effect`; an undeclared rejection is a DEFECT (D4) —
 *  none of these seven procedures declares an `error` on the contract, and the
 *  loud throws they DO make (an unknown host, the unremovable default) are exactly
 *  the shape the strip surfaces as a rejected call, as before. */
export function buildAppRouter(deps: BuildAppRouterDeps): ServedFragment {
  const handlers = {
    // Per-host BRANDING the shell needs synchronously at boot (document title,
    // watermark, PWA theme color). The restart axis (`processId`) and the build
    // identity (`commit`) moved to the surface, owned by @kolu/surface-app — see
    // `surface.ts`. The kaval identities ride padi's `status` cell + `daemonStatus`
    // collection (re-served off the bound padi).
    //
    // The browser tab title + About dialog read `Kolu [<serverHost>]` — this
    // kolu-server's OWN host. Under always-map which host a tab views is a
    // client-side strip selection, not a server fact, so the identity no longer
    // folds a remote host into the name.
    "server/info": () =>
      Effect.sync(() => ({ identity: pwaIdentityForHostname(serverHostname) })),
    "daemon/restart": () =>
      Effect.promise(async () => {
        log.info({}, "padi restart requested — draining the bound padi");
        // Drain the bound padi through the frozen control core: it persists its
        // layout and exits, its kaval + PTYs survive, and the binder's reconnect
        // loop re-spawns padi onto the surviving kaval. NEVER a kill-9.
        await deps.drainBoundPadi();
      }),
    // WHICH host the caller is sitting at, if any. Reads THIS connection's
    // {@link CurrentViewer} service (the mount provides one per websocket), so the
    // answer is genuinely per-viewer — which a surface cell, being broadcast,
    // could not be. This handler stays a pass-through: the judgment about which of
    // the two facts to believe lives in `portForward/resolveViewerHost.ts`.
    "hosts/viewer": () =>
      CurrentViewer.use((viewer) =>
        Effect.promise(
          async (): Promise<ViewerHost> => ({
            host: await deps.viewerHost({
              peerAddress: viewer.viewerAddress,
              forwardedFor: viewer.forwardedFor,
            }),
          }),
        ),
      ),
    // Runtime pool membership — the selector strip's add/remove. The handler
    // forwards to the pool; `index.ts` owns the fail-loud unremovable-default guard
    // (a `remove` of LOCAL_HOST / the boot default throws `UnremovableHostError`,
    // which surfaces to the strip as a rejected call, never a silent no-op).
    "hosts/add": (input: HostRef) =>
      Effect.promise(async () => {
        log.info({ host: input.host }, "host add requested");
        await deps.addHost(input.host);
      }),
    "hosts/remove": (input: HostRef) =>
      Effect.promise(async () => {
        log.info({ host: input.host }, "host remove requested");
        await deps.removeHost(input.host);
      }),
    "hosts/reconnect": (input: HostRef) =>
      Effect.sync(() => {
        log.info({ host: input.host }, "host reconnect requested");
        deps.reconnectHost(input.host);
      }),
    "hosts/renewDaemon": (input: HostRef) =>
      Effect.promise(async () => {
        log.info(
          { host: input.host },
          "host daemon renew requested — draining that host's padi to re-realise the current closure",
        );
        await deps.renewHostDaemon(input.host);
      }),
  };

  return {
    // `RpcGroup` is invariant in its element union, so the precisely-typed root
    // group is not assignable to the erased `RpcGroup<Rpc.Any>` a served fragment
    // carries — see the same cast, with the same reason, on `servedGroup`.
    group: koluRootGroup as unknown as RpcGroup.RpcGroup<Rpc.Any>,
    // `SurfaceHandlers` erases the handler's REQUIREMENTS (`Effect<A, E>` is
    // `Effect<A, E, never>`), and `hosts/viewer` genuinely requires
    // {@link CurrentViewer}. The requirement is satisfied per CONNECTION, by the
    // layer the transport mount hands `serveSurfaceSocket` — which is the only
    // place that fact exists — so it cannot appear in a process-lifetime handler
    // record's type. Same structural reason the retired `appRouter as any` carried:
    // the served record is assembled from independently-typed halves. The tag→handler
    // pairing itself is checked, by `assembleServedHandlers`.
    handlers: handlers as unknown as SurfaceHandlers,
  };
}
