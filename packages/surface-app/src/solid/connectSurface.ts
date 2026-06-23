/**
 * `connectSurface` — the turnkey client seam for a SINGLE surface over one
 * reconnecting socket, with the liveness watchdog wired in BY DEFAULT.
 *
 * This is the no-lifecycle counterpart to `createServerLifecycle`: an app with
 * no shared connection-status UI driven off the socket — pulam-web's per-host
 * fleet sockets, drishti's per-host sockets — builds its reactive client AND its
 * half-open watchdog in one call, instead of hand-rolling `createSurfaceSocket`
 * → `websocketLink` → `surfaceClient` and (the step every such app FORGOT) a
 * `createHeartbeat`. The heartbeat is default-on and probes the framework-
 * reserved `system.live` round-trip (`@kolu/surface/liveness`), so it needs no
 * app-supplied probe — there is no probe left for an app to forget.
 *
 * An app that DOES drive shared connection-status UI off the socket (kolu's
 * header dot) derives a `createServerLifecycle` instead — which folds the SAME
 * watchdog in — and builds its own (possibly multi-sibling) clients over the
 * combined link. So between the two seams, no surface socket can be built
 * without a liveness watchdog.
 */

import type {
  Surface,
  SurfaceContractFor,
  SurfaceSpec,
} from "@kolu/surface/define";
import { websocketLink } from "@kolu/surface/links/websocket";
import {
  probeSurfaceLive,
  type SurfaceLiveProbeable,
} from "@kolu/surface/liveness";
import { type SurfaceClient, surfaceClient } from "@kolu/surface/solid";
import type { WebSocket as PartySocket } from "partysocket";
import {
  createHeartbeat,
  createSurfaceSocket,
  type ProcessIdEcho,
  type SurfaceSocketOptions,
} from "../connect";

export interface ConnectSurfaceOptions<S extends SurfaceSpec>
  extends SurfaceSocketOptions {
  /** The surface to build a reactive client for. */
  surface: Surface<S>;
  /** Disable or tune the default-on liveness heartbeat. Default ON, probing the
   *  framework-reserved `system.live` round-trip — so an app needn't (and can't
   *  forget to) supply a probe. Pass `false` only if a different layer owns this
   *  socket's liveness; pass an object to tune `intervalMs`/`timeoutMs`/`onStale`
   *  or to override the probe with a domain-specific liveness verb. */
  heartbeat?:
    | false
    | {
        intervalMs?: number;
        timeoutMs?: number;
        onStale?: () => void;
        probe?: () => Promise<unknown>;
      };
}

/** A live single-surface connection: the socket, its `pid` echo, the reactive
 *  client, and a `dispose` that stops the liveness heartbeat. */
export interface SurfaceConnection<S extends SurfaceSpec> {
  ws: PartySocket;
  echo: ProcessIdEcho;
  client: SurfaceClient<S>;
  /** Stop the liveness heartbeat. A per-app-lifetime socket (cached for the
   *  page's life, like pulam-web's per-host clients) needn't call this. */
  dispose: () => void;
}

export function connectSurface<const S extends SurfaceSpec>(
  opts: ConnectSurfaceOptions<S>,
): SurfaceConnection<S> {
  const { surface, heartbeat: hb, ...socketOptions } = opts;
  const { ws, echo } = createSurfaceSocket(socketOptions);
  const client = surfaceClient(
    surface,
    websocketLink<SurfaceContractFor<S>>(ws as unknown as WebSocket),
  );
  const heartbeat =
    hb === false
      ? undefined
      : createHeartbeat({
          ws,
          // Default to the framework-reserved liveness round-trip — every surface
          // answers `system.live`, so this needs no per-app probe. An app may
          // still override with its own verb.
          probe:
            (typeof hb === "object" ? hb.probe : undefined) ??
            (() =>
              probeSurfaceLive(client.rpc as unknown as SurfaceLiveProbeable)),
          intervalMs: typeof hb === "object" ? hb.intervalMs : undefined,
          timeoutMs: typeof hb === "object" ? hb.timeoutMs : undefined,
          onStale: typeof hb === "object" ? hb.onStale : undefined,
        });
  return { ws, echo, client, dispose: () => heartbeat?.dispose() };
}
