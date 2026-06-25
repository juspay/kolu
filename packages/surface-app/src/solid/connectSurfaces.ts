/**
 * `connectSurfaces` — the turnkey client seam for MULTIPLE sibling surfaces over
 * ONE reconnecting socket, with the liveness watchdog wired in by default.
 *
 * The multi-surface counterpart to `connectSurface`: where that builds one
 * `surfaceClient` over one socket, this builds a `surfaceClients` BUNDLE (drishti's
 * control plane multiplexes `admin` + `surfaceApp` over a single transport) and
 * wires the SAME default-on heartbeat — one socket, one `createSocketStatus`, one
 * `createHeartbeat` probing the framework-reserved `system.live` round-trip on the
 * first sibling. So a multi-surface app gets half-open detection BY CONSTRUCTION,
 * exactly like a single-surface one — instead of hand-rolling `createSurfaceSocket`
 * → `websocketLink` → `surfaceClients` and (the step the hand-built path forgot) a
 * `createHeartbeat`. The combined fact folds via {@link surfaceClientsHealth}, and
 * the per-sibling `{ live }` is threaded from the one socket's status so the
 * AND-reduce flips on a dead transport.
 *
 * `heartbeat: false` is the explicit opt-out for a socket whose liveness another
 * layer already owns (drishti's admin socket is watched by `<SurfaceAppProvider>`'s
 * `createServerLifecycle`, which runs its OWN heartbeat — a second one here would
 * double the probe). The seam still threads `{ live }` and removes the hand-built
 * path; it just doesn't add a duplicate watchdog.
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { websocketLink } from "@kolu/surface/links/websocket";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import {
  type SurfaceClients,
  surfaceClients,
  type SurfaceHealth,
  surfaceClientsHealth,
} from "@kolu/surface/solid";
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

export interface ConnectSurfacesOptions<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, each pinning its own spec.
  E extends Record<string, Surface<any>>,
> extends SurfaceSocketOptions {
  /** The sibling surfaces to build a client bundle for — the same map
   *  `surfaceClients` takes (`{ admin: adminSurface, surfaceApp: appSurface }`).
   *  Each becomes a scoped client at `/surface/<key>/<prim>/<verb>`. */
  surfaces: E;
  /** Disable or tune the default-on liveness heartbeat — the same knob
   *  `connectSurface` accepts. Pass `false` when another layer already owns this
   *  socket's liveness (e.g. `<SurfaceAppProvider>`'s `createServerLifecycle`),
   *  so the seam threads `{ live }` and drops the hand-built path WITHOUT adding a
   *  second probe. */
  heartbeat?: HeartbeatConfig;
}

/** A live multi-surface connection: the shared socket, its `pid` echo, the per-key
 *  client bundle, the reactive transport `status`, the COMBINED health fact across
 *  every sibling, and a `dispose` that stops the heartbeat and tears down every
 *  client's standing subscriptions. */
export interface SurfacesConnection<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  E extends Record<string, Surface<any>>,
> {
  ws: PartySocket;
  echo: ProcessIdEcho;
  /** One scoped `surfaceClient` per sibling surface (the `surfaceClients` shape).
   *  Reach a sibling's primitives through `clients.<key>` and its procedures
   *  through `clients.<key>.rpc` (the scoped slice). */
  clients: SurfaceClients<E>;
  /** Reactive transport status (`connecting`/`live`/`reconnecting`/`down`) from
   *  the one shared socket's open/close. */
  status: Accessor<SurfaceConnectionStatus>;
  /** The COMBINED health fact — `surfaceClientsHealth(clients)` — folding every
   *  sibling's subs + the shared transport `live` (AND-reduced). Pass it straight
   *  to `<SurfaceGate health={conn.health}>` / `<HostStatusPip health={conn.health}>`. */
  health: () => SurfaceHealth;
  /** Stop the heartbeat (if any) and dispose every sibling client's standing
   *  subscriptions. A page-lifetime cached bundle needn't call it. */
  dispose: () => void;
}

export function connectSurfaces<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  const E extends Record<string, Surface<any>>,
>(opts: ConnectSurfacesOptions<E>): SurfacesConnection<E> {
  const { surfaces, heartbeat: hb, ...socketOptions } = opts;
  const { ws, echo } = createSurfaceSocket(socketOptions);
  // Derive transport `status` BEFORE the clients so the one socket's liveness
  // feeds every sibling's `health().live` — the leg `surfaceClientsHealth`
  // AND-reduces, so a dead combined socket flips the merged fact not-live.
  const status = createSocketStatus(ws, {
    retireOnStaleClose: socketOptions.retireOnStaleClose,
    restartCloseCode: socketOptions.restartCloseCode,
  });
  const clients = surfaceClients(
    // biome-ignore lint/suspicious/noExplicitAny: the combined link's `.rpc` is too complex to represent generically (TS2590); the scoped per-sibling specs carry call-site safety.
    websocketLink(ws as unknown as WebSocket) as any,
    surfaces,
    { live: () => status() === "live" },
  );
  // The base probe is the framework-reserved `system.live` round-trip on the
  // FIRST sibling's scoped link (`clients.<key>.rpc.surface.system.live`) — every
  // surface answers it, so this needs no per-app probe.
  const firstClient = Object.values(clients)[0] as { rpc: unknown } | undefined;
  const heartbeatOptions = normalizeHeartbeat(hb, {
    ws,
    probe: () => probeSurfaceLive(firstClient?.rpc),
  });
  const heartbeat = heartbeatOptions && createHeartbeat(heartbeatOptions);
  return {
    ws,
    echo,
    clients,
    status,
    health: () => surfaceClientsHealth(clients),
    dispose: () => {
      heartbeat?.dispose();
      for (const client of Object.values(clients)) {
        (client as { dispose: () => void }).dispose();
      }
    },
  };
}
