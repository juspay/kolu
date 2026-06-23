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
import { probeSurfaceLive } from "@kolu/surface/liveness";
import { type SurfaceClient, surfaceClient } from "@kolu/surface/solid";
import type { Accessor } from "solid-js";
import type { WebSocket as PartySocket } from "partysocket";
import {
  createHeartbeat,
  createSurfaceSocket,
  type HeartbeatConfig,
  normalizeHeartbeat,
  type ProcessIdEcho,
  type SurfaceSocketOptions,
} from "../connect";
import {
  createSocketStatus,
  type SurfaceConnectionStatus,
} from "./socketStatus";

export interface ConnectSurfaceOptions<S extends SurfaceSpec>
  extends SurfaceSocketOptions {
  /** The surface to build a reactive client for. */
  surface: Surface<S>;
  /** Disable or tune the default-on liveness heartbeat. Default ON, probing the
   *  framework-reserved `system.live` round-trip — so an app needn't (and can't
   *  forget to) supply a probe. Pass `false` only if a different layer owns this
   *  socket's liveness; pass an object to tune `intervalMs`/`timeoutMs`/`onStale`.
   *  The same {@link HeartbeatConfig} knob `createServerLifecycle` accepts. */
  heartbeat?: HeartbeatConfig;
}

/** A live single-surface connection: the socket, its `pid` echo, the reactive
 *  client, a reactive transport `status` (for a per-connection indicator), and a
 *  `dispose` that stops the liveness heartbeat. */
export interface SurfaceConnection<S extends SurfaceSpec> {
  ws: PartySocket;
  echo: ProcessIdEcho;
  /** The reactive surface client. `.cells` / `.collections` / `.streams` are
   *  fully typed off `S`; `.rpc` (the raw link, for imperative procedures) is
   *  `unknown` — the same deliberate choice kolu's own combined client makes,
   *  because the fully-expanded oRPC link type is too complex to represent
   *  generically (TS2590). A consumer that calls procedures on it casts `.rpc`
   *  to its CONCRETE contract once at the wire boundary:
   *  `client.rpc as ContractRouterClient<typeof mySurface.contract>` — sound,
   *  since the runtime `.rpc` IS that link. */
  client: SurfaceClient<S>;
  /** Reactive transport status — `connecting` / `live` / `reconnecting` / `down`
   *  — derived from the socket's own open/close (no identity probe). Render it so
   *  the watchdog's recovery is VISIBLE rather than silent. */
  status: Accessor<SurfaceConnectionStatus>;
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
  // One normalizer, not four `typeof hb === "object" ? hb.x : undefined` ternaries.
  // The base `probe` is the framework-reserved `system.live` round-trip — every
  // surface answers it, so this needs no per-app probe.
  const heartbeatOptions = normalizeHeartbeat(hb, {
    ws,
    probe: () => probeSurfaceLive(client.rpc),
  });
  const heartbeat = heartbeatOptions && createHeartbeat(heartbeatOptions);
  const status = createSocketStatus(ws, {
    retireOnStaleClose: socketOptions.retireOnStaleClose,
    restartCloseCode: socketOptions.restartCloseCode,
  });
  return { ws, echo, client, status, dispose: () => heartbeat?.dispose() };
}
